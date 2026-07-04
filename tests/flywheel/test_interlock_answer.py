"""Deterministic, offline tests for interlock answer assembly + live-state sim.

Proves flywheel steps 5-6 logic (consume approved context -> grounded answer)
WITHOUT a DB: the recalled edges are passed in as if read from the store, and
the live state comes from the faithful permissive model. The DB round-trip
(propose -> approve -> recall) is proven separately in the DATABASE_URL-gated
integration test. See `docs/north-star/interlock-flywheel-audit.md`.
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots" / "shared"))

from interlock_context import (  # noqa: E402
    RecalledEdge,
    build_interlock_answer,
    evaluate_permissive,
)

_ASSET = "enterprise.site.area.line.conveyor_b16"


def _approved_chain() -> list[RecalledEdge]:
    """The interlock edges as they would come back from recall_interlocks
    AFTER human approval (verified). Evidence is the plc_rung citation."""
    rung = [{"type": "plc_rung", "location": "Prog_init_ConvSimple_v2.1.st:214",
             "excerpt": "vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;"}]
    rung2 = [{"type": "plc_rung", "location": "Prog_init_ConvSimple_v2.1.st:236",
              "excerpt": "motor_running := vfd_run_permit AND (dir_fwd OR dir_rev);"}]
    return [
        RecalledEdge("e_stop_ok", "vfd_run_permit", "USED_IN_LOGIC", evidence=rung),
        RecalledEdge("_IO_EM_DO_02", "vfd_run_permit", "USED_IN_LOGIC", evidence=rung),
        RecalledEdge("vfd_run_permit", "motor_running", "USED_IN_LOGIC", evidence=rung2),
        RecalledEdge("pe_latched", "vfd_run_permit", "CAUSES", evidence=rung,
                     evidence_summary="NOT-ed permissive operand: TRUE inhibits run"),
    ]


# ── live-state sim ──────────────────────────────────────────────────────────
def test_evaluate_permissive_blocks_when_beam_blocked():
    s = evaluate_permissive(photoeye_blocked=True)
    assert s["pe_latched"] is True
    assert s["vfd_run_permit"] is False
    assert s["motor_running"] is False


def test_evaluate_permissive_runs_when_clear():
    s = evaluate_permissive(photoeye_blocked=False)
    assert s["pe_latched"] is False
    assert s["vfd_run_permit"] is True
    assert s["motor_running"] is True


# ── answer assembly ─────────────────────────────────────────────────────────
def test_blocked_conveyor_produces_grounded_answer():
    live = evaluate_permissive(photoeye_blocked=True)
    ans = build_interlock_answer(_approved_chain(), live, _ASSET)
    assert ans is not None
    # the blocking tag is the latched photoeye condition
    assert ans["blocking_tag"] == "pe_latched"
    assert ans["blocking_value"] is True
    assert ans["affected_signal"] == "motor_running"
    assert ans["permissive"] == "vfd_run_permit"
    # answer names the asset and the causal why
    assert _ASSET in ans["why"]
    assert "vfd_run_permit" in ans["why"]
    # grounded: at least one plc_rung citation is present
    assert ans["grounded"] is True
    kinds = {e["kind"] for e in ans["evidence"]}
    assert "plc_rung" in kinds
    locs = {e.get("location") for e in ans["evidence"]}
    assert any("Prog_init_ConvSimple" in (loc or "") for loc in locs)
    # actionable next checks reference the blocker
    assert ans["next_checks"]
    assert any("pe_latched" in c for c in ans["next_checks"])


def test_no_approved_context_means_no_answer():
    """The core trust guard: empty recall -> None, even with a live block."""
    live = evaluate_permissive(photoeye_blocked=True)
    assert build_interlock_answer([], live, _ASSET) is None


def test_recall_is_load_bearing_not_the_live_sim():
    """If the store has no edge into the motion signal, the chain can't be
    explained from live state alone -> the answer cannot name the permissive."""
    live = evaluate_permissive(photoeye_blocked=True)
    # only an unrelated approved edge -> motion signal not reachable from recall
    unrelated = [RecalledEdge("foo", "bar", "USED_IN_LOGIC", evidence=[])]
    ans = build_interlock_answer(unrelated, live, _ASSET)
    # motion (motor_running) is False in live state but NOT a recalled target,
    # so the assembler must not fabricate the conveyor explanation
    assert ans is None or ans.get("affected_signal") != "motor_running"
