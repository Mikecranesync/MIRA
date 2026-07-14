"""Frozen ATV340 calibration benchmark (durable spec §3, PRD §11).

The Schneider ATV340 graph reads its tags with decent accuracy (score in the USEFUL_DRAFT
band) yet is structurally UNSAFE — six deterministic import-blockers fire — so it must never
be importable. That separation is the whole thesis: *good prose does not imply a trustworthy
graph.*

Per PRD §10.7 the precise verdict is gated on a human freeze: the exact tier/score-band
assertion SKIPS until ``truth_status == frozen_human_confirmed``. The gate-regression
assertion (the blockers fire, import FAILs) runs ALWAYS — it exercises the deterministic code
on the real committed defective graph, independent of the freeze.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from printsense import grade_case as gc

_ROOT = Path(__file__).resolve().parents[2]
_GRAPH = _ROOT / "printsense" / "fixtures" / "atv340" / "graph.json"
_RUBRIC = _ROOT / "printsense" / "benchmarks" / "atv340_vfd" / "rubric.json"

# The six deterministic import-blockers the defective ATV340 graph must trip (spec §3).
_MIN_BLOCKERS = frozenset({
    "exact_label_mismatch",
    "dangling_reference",
    "duplicate_identifier",
    "incorrect_connector_ownership",
    "incompatible_functional_path",
    "variant_crossover",
})


def _rubric() -> dict:
    return json.loads(_RUBRIC.read_text(encoding="utf-8"))


def test_atv340_gates_fire_on_defective_graph():
    # Always-on gate regression: the real defective graph must FAIL import with every
    # expected blocker. Independent of the human freeze — this tests the code, not the truth.
    r = gc.grade_case(_GRAPH, _RUBRIC)
    assert r["import_verdict"] == "FAIL"
    assert r["bot_importable"] is False
    missing = _MIN_BLOCKERS - set(r["import_blocking_failures"])
    assert not missing, f"expected import-blockers did not fire: {sorted(missing)}"


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
