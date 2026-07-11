"""Tests for the scientific (weighted 0-100 / A-F) grading rubric.

Unit tests drive ``scientific.grade_scientifically`` with synthetic
``LayerResult``s + minimal pack/gold dicts (fast, no PDF), covering the band
boundaries, the weighted-average-over-gradeable math, N/A handling (no gold / no
manual), the hard gates, critical failures, the relationship-leak floor, and the
promotion recommendation per band. One integration test grades the committed
PowerFlex 40 candidate against its committed gold with NO manual — proving the
end-to-end pipeline and the manual-absent INCOMPLETE path on real repo data.
"""

from __future__ import annotations

import json
from pathlib import Path

import scientific
from report import LayerResult

_TOOL_DIR = Path(__file__).resolve().parent.parent.parent


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------
def _schema(status="pass", faults=2, params=1):
    return LayerResult(
        name="schema",
        status=status,
        summary="ok" if status == "pass" else "schema FAILED",
        metrics={"fault_count": faults, "param_count": params, "schema_version": 2},
    )


def _cite(status="pass", verified=3, unverifiable=0, dropped=None):
    return LayerResult(
        name="cite_integrity",
        status=status,
        summary="cite",
        metrics={
            "verified_count": verified,
            "unverifiable_count": unverifiable,
            "dropped_diagnostic_critical": dropped or [],
        },
    )


def _gold_res(fabrication=False, dc_fault_recall=1.0, **extra):
    metrics = {
        "fabrication_detected": fabrication,
        "diagnostic_critical_fault_recall": dc_fault_recall,
        "overall_fault_recall": 1.0,
        "overall_recall": 1.0,
        "overall_precision": 1.0,
        "diagnostic_critical_precision": 1.0,
    }
    metrics.update(extra)
    return LayerResult(name="gold_score", status="pass", summary="gold", metrics=metrics)


def _domain(violations=None):
    v = violations or []
    return LayerResult(
        name="domain_rules",
        status="fail" if v else "pass",
        summary=f"{len(v)} violation(s)" if v else "clean",
        details=v,
    )


def _perfect_pack():
    return {
        "pack_id": "test_drive",
        "schema_version": 2,
        "family": {"manufacturer": "Acme", "series": "Test Drive"},
        "live_decode": {"fault_codes": {1: "Fault One", 2: "Fault Two"}},
        "parameters": [
            {
                "parameter_id": "P10",
                "name": "Comm Loss Action",
                "range": None,
                "default": "5",
                "unit": None,
                "related_faults": ["F1"],
                "related_parameters": ["P11"],
                "source_citation": {"doc": "m", "page": "10", "excerpt": "P10 [Comm Loss Action]"},
                "provenance_tier": "manual_cited",
            }
        ],
        "keypad_navigation": [],
        "provenance": {
            "items": {"parameters": "manual_cited"},
            "sources": [{"doc": "m", "page": "5", "excerpt": "F1 Fault One 2"}],
        },
    }


def _perfect_gold():
    return {
        "faults": [
            {"fault_id": "F1", "code": 1, "name": "Fault One", "references_parameters": ["P10"],
             "diagnostic_critical": True},
            {"fault_id": "F2", "code": 2, "name": "Fault Two", "references_parameters": [],
             "diagnostic_critical": False},
        ],
        "parameters": [
            {"parameter_id": "P10", "name": "Comm Loss Action", "range": None, "default": "5",
             "related_parameters": ["P11"], "related_faults": ["F1"], "diagnostic_critical": True},
        ],
    }


_UNSET = object()


def _grade(pack=None, gold=_UNSET, schema=None, cite=None, gold_res=None, domain=None):
    return scientific.grade_scientifically(
        pack_id="test_drive",
        pack_dict=pack if pack is not None else _perfect_pack(),
        gold_dict=_perfect_gold() if gold is _UNSET else gold,
        schema_result=schema or _schema(),
        cite_result=cite or _cite(),
        gold_result=gold_res or _gold_res(),
        domain_result=domain or _domain(),
    )


# ---------------------------------------------------------------------------
# Bands
# ---------------------------------------------------------------------------
def test_band_boundaries():
    assert scientific.band_for(100)[0] == "A"
    assert scientific.band_for(92)[0] == "A"
    assert scientific.band_for(91.9)[0] == "B"
    assert scientific.band_for(82)[0] == "B"
    assert scientific.band_for(70)[0] == "C"
    assert scientific.band_for(50)[0] == "D"
    assert scientific.band_for(49.9)[0] == "F"
    assert scientific.band_for(0)[0] == "F"


# ---------------------------------------------------------------------------
# Perfect pack
# ---------------------------------------------------------------------------
def test_perfect_pack_scores_A_and_is_promotable():
    r = _grade()
    assert r["grade"] == "A"
    assert r["overall_score"] == 100.0
    assert r["promotable"] is True
    assert r["incomplete"] is False
    assert r["critical_failures"] == []
    assert all(c["score"] == 100.0 for c in r["categories"])
    assert "sign-off" in r["promotion_recommendation"]


def test_weights_sum_to_120_but_overall_is_a_weighted_average():
    assert sum(scientific.WEIGHTS.values()) == 120
    r = _grade()  # all categories 100 -> average is 100, not >100
    assert r["overall_score"] == 100.0


# ---------------------------------------------------------------------------
# N/A handling
# ---------------------------------------------------------------------------
def test_no_gold_marks_coverage_categories_na_and_incomplete():
    r = _grade(gold=None, gold_res=LayerResult("gold_score", "skipped", "no gold"))
    na = set(r["not_applicable_categories"])
    assert scientific._GOLD_CATEGORIES <= na
    assert r["incomplete"] is True
    assert r["promotable"] is False
    assert any("gold set" in m for m in r["missing_evidence"])
    assert "INCOMPLETE" in r["promotion_recommendation"]
    # gradeable categories (provenance, citation, safety) still scored
    scored = [c for c in r["categories"] if c["score"] is not None]
    assert {c["key"] for c in scored} == {
        "provenance_traceability", "citation_fidelity", "safety_usability"
    }


def test_no_manual_marks_citation_na_and_incomplete():
    r = _grade(cite=_cite(status="skipped", verified=0))
    cite_cat = next(c for c in r["categories"] if c["key"] == "citation_fidelity")
    assert cite_cat["score"] is None
    assert r["incomplete"] is True
    assert r["promotable"] is False
    assert r["citation_accuracy"] is None
    assert any("manual" in m for m in r["missing_evidence"])


def test_na_categories_excluded_from_weighted_average():
    # citation N/A -> its weight (15) drops out of the denominator; a 100 pack
    # stays 100 rather than being dragged down by a zero.
    r = _grade(cite=_cite(status="skipped", verified=0))
    assert r["overall_score"] == 100.0


# ---------------------------------------------------------------------------
# Hard gates + critical failures
# ---------------------------------------------------------------------------
def test_schema_hard_gate_failure_forces_F_and_blocks():
    r = _grade(schema=_schema(status="fail"))
    assert r["grade"] == "F"
    assert r["promotable"] is False
    gates = {g["key"]: g["passed"] for g in r["hard_gates"]}
    assert gates["schema_validity"] is False
    assert gates["runtime_compatibility"] is False
    assert any("schema_validity" in cf for cf in r["critical_failures"])


def test_missing_provenance_fails_hard_gate():
    pack = _perfect_pack()
    pack["provenance"] = {"items": {}, "sources": []}
    r = _grade(pack=pack)
    gates = {g["key"]: g["passed"] for g in r["hard_gates"]}
    assert gates["provenance_present"] is False
    assert r["grade"] == "F"


def test_fabrication_is_a_critical_failure():
    r = _grade(gold_res=_gold_res(fabrication=True))
    assert any("fabrication" in cf.lower() for cf in r["critical_failures"])
    assert r["promotable"] is False


def test_dropped_diagnostic_critical_citation_caps_and_blocks():
    r = _grade(cite=_cite(verified=2, unverifiable=1, dropped=["F1"]))
    cite_cat = next(c for c in r["categories"] if c["key"] == "citation_fidelity")
    assert cite_cat["score"] <= 30.0
    assert any("diagnostic-critical citation" in cf for cf in r["critical_failures"])
    assert r["promotable"] is False


def test_dc_fault_recall_below_100_is_critical():
    r = _grade(gold_res=_gold_res(dc_fault_recall=0.8))
    assert any("diagnostic-critical fault recall" in cf for cf in r["critical_failures"])


def test_domain_violation_is_a_critical_failure():
    r = _grade(domain=_domain(["parameter_id 'X': junk name"]))
    assert any("domain hard violation" in cf for cf in r["critical_failures"])


# ---------------------------------------------------------------------------
# Relationship leak floor
# ---------------------------------------------------------------------------
def test_param_id_leaked_into_related_faults_floors_relationship_score():
    pack = _perfect_pack()
    # P11 is a parameter id; leaking it into related_faults is the fabrication
    pack["parameters"].append(
        {
            "parameter_id": "P11",
            "name": "Other",
            "range": None,
            "default": None,
            "unit": None,
            "related_faults": ["P10"],  # a PARAM id leaked in
            "related_parameters": [],
            "source_citation": {"doc": "m", "page": "11", "excerpt": "P11 [Other]"},
            "provenance_tier": "manual_cited",
        }
    )
    gold = _perfect_gold()
    gold["parameters"].append(
        {"parameter_id": "P11", "name": "Other", "range": None, "default": None,
         "related_parameters": [], "related_faults": [], "diagnostic_critical": False}
    )
    r = scientific.grade_scientifically(
        pack_id="t", pack_dict=pack, gold_dict=gold,
        schema_result=_schema(), cite_result=_cite(), gold_result=_gold_res(), domain_result=_domain(),
    )
    rel = next(c for c in r["categories"] if c["key"] == "relationship_accuracy")
    assert rel["score"] == 0.0


# ---------------------------------------------------------------------------
# Promotion recommendation per band
# ---------------------------------------------------------------------------
def test_promotion_recommendation_bands():
    assert scientific._promotion("A", [], False, [])[1] is True
    assert scientific._promotion("B", [], False, [])[1] is True
    assert scientific._promotion("C", [], False, [])[1] is False
    assert scientific._promotion("D", [], False, [])[1] is False
    assert scientific._promotion("F", [], False, [])[1] is False
    # a critical failure blocks regardless of band
    rec, promotable = scientific._promotion("A", ["boom"], False, [])
    assert promotable is False and "critical" in rec.lower()


# ---------------------------------------------------------------------------
# Integration — the committed PF40 candidate against committed gold, NO manual
# ---------------------------------------------------------------------------
def test_integration_pf40_candidate_no_manual_is_incomplete_but_scores_gold_categories():
    pack = json.loads(
        (_TOOL_DIR / "candidates" / "powerflex_40" / "pack.json").read_text(encoding="utf-8")
    )
    gold = json.loads(
        (_TOOL_DIR / "gold" / "powerflex_40" / "gold.json").read_text(encoding="utf-8")
    )
    from domain_rules import check_domain
    from gold_score import score_against_gold

    r = scientific.grade_scientifically(
        pack_id="powerflex_40",
        pack_dict=pack,
        gold_dict=gold,
        schema_result=_schema(faults=len(pack["live_decode"]["fault_codes"]),
                              params=len(pack["parameters"])),
        cite_result=_cite(status="skipped", verified=0),  # no manual in CI
        gold_result=score_against_gold(pack, gold),
        domain_result=check_domain(pack),
    )
    # citation N/A -> INCOMPLETE, but the gold-scored categories are perfect
    assert r["incomplete"] is True
    assert r["promotable"] is False
    fault_cov = next(c for c in r["categories"] if c["key"] == "fault_coverage_precision")
    assert fault_cov["score"] == 100.0
    assert r["critical_failures"] == []  # domain clean, no fabrication


# ---------------------------------------------------------------------------
# CLI: auto-discovery of gold/<pack>/gold.json when --gold is omitted, so a
# reviewer can't accidentally grade a pack that HAS a gold set on
# gold-independent categories only and get a misleadingly low "no gold" verdict.
# ---------------------------------------------------------------------------
def test_grade_scientific_cli_auto_discovers_gold(tmp_path):
    import grade_scientific

    # powerflex_40 has BOTH a committed candidate and gold/powerflex_40/gold.json.
    # Invoke WITHOUT --gold (and without --manual): the gold must be auto-found so
    # the coverage/accuracy categories are scored, not marked N/A.
    grade_scientific.main(["--pack", "powerflex_40", "--out", str(tmp_path)])
    report = json.loads((tmp_path / "scientific_report.json").read_text(encoding="utf-8"))
    na = set(report["not_applicable_categories"])
    assert "fault_coverage_precision" not in na  # gold was auto-discovered + scored
    assert scientific._GOLD_CATEGORIES.isdisjoint(na)
    # only citation_fidelity is N/A here (no --manual)
    assert na == {"citation_fidelity"}
