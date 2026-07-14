"""Frozen ATV340 calibration benchmark (durable spec §3, PRD §11; corrected 2026-07-14).

The Schneider ATV340 graph reads its tags with decent accuracy (score in the USEFUL_DRAFT
band) yet is structurally UNSAFE — FIVE deterministic import-blockers fire — so it must never
be importable. That separation is the whole thesis: *good prose does not imply a trustworthy
graph.*

Each of the five blockers is confirmed against the drawing (NVE97896-02) and/or the official
Schneider Installation Manual (NVE61069.06) — see ``fixtures/atv340/evidence_manifest.json``.
Three earlier blockers were REMOVED after primary-source review and must NOT fire:
``incorrect_connector_ownership`` (D1 contradicted — CN3 supports 5V RS422 A/B/I),
``variant_crossover`` (redundant), ``dangling_reference`` (CN3 is a real connector). The reduced
set independently preserves the FAIL verdict.

Per PRD §10.7 the precise verdict is gated on a human freeze: the exact tier/score-band
assertion SKIPS until ``truth_status == frozen_human_confirmed``. The gate-regression assertion
(exactly the five blockers fire, the three removed do not, import FAILs) runs ALWAYS.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from printsense import grade_case as gc

_ROOT = Path(__file__).resolve().parents[2]
_GRAPH = _ROOT / "printsense" / "fixtures" / "atv340" / "graph.json"
_RUBRIC = _ROOT / "printsense" / "benchmarks" / "atv340_vfd" / "rubric.json"

# The FIVE deterministic import-blockers the defective ATV340 graph must trip — each confirmed
# against the drawing and/or the official Installation Manual (fixtures/atv340/evidence_manifest.json).
_EXPECTED_BLOCKERS = frozenset({
    "exact_label_mismatch",
    "confident_misread",
    "duplicate_identifier",
    "off_page_from_pagination",
    "incompatible_functional_path",
})
# Removed 2026-07-14 after primary-source review — these must NOT fire.
_REMOVED_BLOCKERS = frozenset({
    "incorrect_connector_ownership",  # D1 contradicted: CN3 supports 5V RS422 A/B/I (NVE61069.06 p.132)
    "variant_crossover",              # redundant with incompatible_functional_path; CN9 is not frame-variable
    "dangling_reference",             # CN3 is a real connector, not a dangling defect
})


def _rubric() -> dict:
    return json.loads(_RUBRIC.read_text(encoding="utf-8"))


def test_atv340_gates_fire_on_defective_graph():
    # Always-on gate regression: the real defective graph must FAIL import on EXACTLY the five
    # confirmed blockers, and the three removed blockers must NOT fire. Independent of the freeze.
    r = gc.grade_case(_GRAPH, _RUBRIC)
    assert r["import_verdict"] == "FAIL"
    assert r["bot_importable"] is False
    fired = set(r["import_blocking_failures"])
    assert _EXPECTED_BLOCKERS <= fired, f"expected blockers missing: {sorted(_EXPECTED_BLOCKERS - fired)}"
    assert not (_REMOVED_BLOCKERS & fired), f"removed blockers fired: {sorted(_REMOVED_BLOCKERS & fired)}"
    assert fired == _EXPECTED_BLOCKERS, f"unexpected blocker set: {sorted(fired)}"


@pytest.mark.skipif(
    _rubric().get("truth_status") != "frozen_human_confirmed",
    reason="ATV340 truth-set is draft_llm_authored; awaiting Mike's review-and-freeze (PRD §10.7)",
)
def test_atv340_frozen_verdict():
    # Truth-gated: activates once Mike freezes the truth-set. Pins the full expected verdict.
    r = gc.grade_case(_GRAPH, _RUBRIC)
    ev = _rubric()["expected_verdict"]
    assert r["quality_tier"] == ev["quality_tier"] == "USEFUL_DRAFT"
    assert r["import_verdict"] == ev["import_verdict"] == "FAIL"
    assert r["bot_importable"] is ev["bot_importable"] is False
    assert r["safety_critical_misreads"] == []  # STO is read correctly on this print
    assert 60 <= r["score"] < 75, f"score {r['score']} outside the USEFUL_DRAFT band"
