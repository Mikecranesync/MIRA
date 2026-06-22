"""SimLab grader CI gate — Phase P0 of the platform-oracle plan.

Makes the deterministic, no-LLM rubric grader a merge-blocking gate. If a
diagnostic / UNS / citation regression breaks evidence assembly or rubric
scoring on any of the six juice-bottling scenarios, this suite goes red.

Fully offline: no Doppler, no DB, no MQTT broker, no LLM. The engine is seeded
at 42 everywhere for byte-identical replay.

What this asserts, per scenario (A–F):
1. assemble_evidence surfaces the right asset, >0 abnormal tags, >0 candidate docs.
2. A synthetic CORRECT reply — built ONLY from the scenario's own ground-truth
   fields — passes grade() (root_cause_hit, asset_hit, evidence_recall >= 0.5).

Plus one determinism assertion: advancing 60 ticks in a single call yields the
same snapshot_dict() as 60 single-tick advances (replay-identity).
"""

from __future__ import annotations

import pytest

from simlab.diagnostic import assemble_evidence, grade
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import SCENARIOS, get_scenario

# Per-scenario tick at which the fault is fully manifested. These mirror the
# already-verified ticks in test_juice_bottling.py::test_juice_evidence (where
# assemble_evidence is proven to surface every expected_evidence_tag) and were
# re-confirmed locally: at each tick the primary asset shows >0 abnormal tags
# AND a synthetic correct reply passes the rubric. Each is the END of the
# fault_active phase for that scenario's timeline, so the fault is decisive
# (well past onset ripple) and the alarms_at_tick thresholds have fired.
_MANIFEST_TICK: dict[str, int] = {
    "filler_underfill_low_bowl_pressure": 120,  # F-LOW-BOWL @75, F-UNDERFILL @110 both latched
    "capper_torque_fault": 60,                  # CA-TORQUE @52 latched; torque floored at 5.5
    "labeler_registration_drift": 60,           # L-REG-DRIFT @53 latched; reg error ~2.8mm
    "casepacker_jam_upstream_block": 15,        # CP-JAM @10 latched; jam_detected True
    "palletizer_unavailable_backup": 10,        # robot_ready False @5; casepacker backs up
    "low_plant_air_multi_machine": 40,          # AS-LOW-PRESS @30; header at 55 psi
}


def _engine_at(scenario_id: str, ticks: int) -> SimEngine:
    """Build line → seeded engine → load scenario → advance to ``ticks``."""
    eng = SimEngine(build_line(), seed=42)
    eng.load_scenario(get_scenario(scenario_id))
    eng.advance(ticks)
    return eng


def _synthetic_correct_reply(scenario) -> str:
    """Build a CORRECT free-text reply using ONLY the scenario's ground truth.

    Pulls the expected root cause, expected asset, a couple of expected evidence
    tags, and an expected citation filename. This is the positive control: if the
    grader can't pass a reply assembled from its own answer key, the rubric or
    evidence wiring has regressed.
    """
    evidence_snippet = " ".join(scenario.expected_evidence_tags[:2])
    citation = scenario.expected_citations[0] if scenario.expected_citations else ""
    return (
        f"Root cause: {scenario.expected_root_cause}. "
        f"Affected asset: {scenario.expected_asset}. "
        f"Evidence tags: {evidence_snippet}. "
        f"See {citation}."
    )


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS.keys()))
def test_grader_gate_evidence_and_rubric(scenario_id: str) -> None:
    """Each juice scenario: evidence assembles + a correct reply passes the rubric."""
    scenario = get_scenario(scenario_id)
    ticks = _MANIFEST_TICK[scenario_id]
    eng = _engine_at(scenario_id, ticks)

    # --- Evidence assembly ---
    ev = assemble_evidence(eng, scenario)
    assert ev.asset_id == scenario.asset_id, (
        f"{scenario_id}: evidence asset_id {ev.asset_id!r} != scenario.asset_id "
        f"{scenario.asset_id!r}"
    )
    assert len(ev.abnormal_tags) > 0, (
        f"{scenario_id} @ tick {ticks}: no abnormal tags — fault not manifested"
    )
    assert len(ev.candidate_docs) > 0, (
        f"{scenario_id}: no candidate docs surfaced for asset {scenario.asset_id!r}"
    )

    # --- Rubric grading of a synthetic correct reply ---
    result = grade(_synthetic_correct_reply(scenario), scenario)
    assert result.root_cause_hit, (
        f"{scenario_id}: root_cause not hit. detail: {result.detail}"
    )
    assert result.asset_hit, (
        f"{scenario_id}: asset not hit. detail: {result.detail}"
    )
    assert result.evidence_recall >= 0.5, (
        f"{scenario_id}: evidence_recall {result.evidence_recall:.2f} < 0.5. "
        f"detail: {result.detail}"
    )
    assert result.passed, (
        f"{scenario_id}: correct reply failed the rubric. detail: {result.detail}"
    )


def test_grader_gate_replay_identity() -> None:
    """Replay-identity: 60 ticks in one call == 60 single-tick advances (seed 42).

    Lightweight determinism guard reusing the engine. If the tick engine ever
    becomes draw-order-dependent (rather than tick-indexed), this catches it.
    """
    one_shot = SimEngine(build_line(), seed=42)
    one_shot.advance(60)

    stepwise = SimEngine(build_line(), seed=42)
    for _ in range(60):
        stepwise.advance(1)

    assert one_shot.snapshot_dict() == stepwise.snapshot_dict(), (
        "Engine must be replay-identical: advance(60) != 60 × advance(1)"
    )
