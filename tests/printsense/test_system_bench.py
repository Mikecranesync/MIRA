"""system_bench — deterministic multi-sheet rubric scorers. Hermetic.

All fixtures are SYNTHETIC (fictional 5-sheet mini-book; no real corpus
content). Scorers are pure set/sequence operations over a STRUCTURED
candidate reconstruction vs a truth rubric — no LLM, no network, no prose NLP.
"""

from __future__ import annotations

import copy
import importlib

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import system_bench  # noqa: E402


TRUTH = {
    "sheet_order": ["1", "2", "3", "4", "5"],
    "unobservable_sheets": ["3", "4"],
    "must_declare_unresolved": ["3", "4"],
    "xref_pairs": [{"src": "1", "dst": "2", "sig": "CTRL"}],
    "device_sheets": {"-1/K01": ["1", "5"], "-2/U01": ["2"], "-5/A01": ["5"]},
    "continuity": [{"sig": "CTRL", "path": ["1", "2"]}],
    "paths": {
        "fiber_loop": ["2", "3", "5"],
        "power_g1": ["EXT:PSU", "1"],
        "control_release": ["1", "5"],
    },
    "contact_semantics": [
        {"chain": "61/62", "form": "NC", "loss_means": "failure_to_deenergize",
         "inverted": "failure_to_energize"},
        {"chain": "83/84", "form": "NO", "loss_means": "failure_to_energize",
         "inverted": "failure_to_deenergize"},
    ],
    "printed_values": ["115 V", "24 VDC"],
}


def _perfect() -> dict:
    return {
        "sheet_order": ["1", "2", "3", "4", "5"],
        "xref_edges": [{"src": "1", "dst": "2", "sig": "CTRL"}],
        "devices": [
            {"tag": "-1/K01", "sheets": ["1", "5"]},
            {"tag": "-2/U01", "sheets": ["2"]},
            {"tag": "-5/A01", "sheets": ["5"]},
        ],
        "continuity": [{"sig": "CTRL", "path": ["1", "2"]}],
        "paths": {
            "fiber_loop": ["2", "3", "5"],
            "power_g1": ["EXT:PSU", "1"],
            "control_release": ["1", "5"],
        },
        "contact_chains": [
            {"chain": "61/62", "form": "NC", "loss_means": "failure_to_deenergize"},
            {"chain": "83/84", "form": "NO", "loss_means": "failure_to_energize"},
        ],
        "unresolved": ["sheet 3 not captured", "sheet 4 unreadable"],
        "ratings": [{"value": "115 V"}],
    }


def test_perfect_candidate_scores_one_everywhere_and_no_flags():
    result = system_bench.score_all(_perfect(), TRUTH)
    for dim, entry in result["dimensions"].items():
        assert entry["score"] == pytest.approx(1.0), (dim, entry)
    assert result["safety_flags"] == []
    assert result["invention_violations"] == []


def test_ordering_partial_credit_for_swapped_pages():
    cand = _perfect()
    cand["sheet_order"] = ["1", "3", "2", "4", "5"]  # one swap -> LCS 4/5
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["page_ordering"]["score"] == pytest.approx(0.8)


def test_xref_f1_penalizes_invented_edge():
    cand = _perfect()
    cand["xref_edges"].append({"src": "5", "dst": "1", "sig": "MADE_UP"})
    result = system_bench.score_all(cand, TRUTH)
    # recall 1.0, precision 0.5 -> F1 2/3
    assert result["dimensions"]["xref_resolution"]["score"] == pytest.approx(2 / 3)


def test_device_identity_consistency():
    cand = _perfect()
    cand["devices"][0]["sheets"] = ["1"]  # dropped a known appearance
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["device_identity"]["score"] < 1.0


def test_contact_inversion_is_a_safety_flag():
    cand = _perfect()
    cand["contact_chains"][0]["loss_means"] = "failure_to_energize"  # INVERTED
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["contact_semantics"]["score"] == pytest.approx(0.5)
    assert any(f["code"] == "contact_polarity_inversion" and f["chain"] == "61/62"
               for f in result["safety_flags"])


def test_uncertainty_recall_when_one_declaration_missing():
    cand = _perfect()
    cand["unresolved"] = ["sheet 3 not captured"]  # forgot the blurred sheet 4
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["uncertainty"]["score"] == pytest.approx(0.5)
    assert "4" in result["dimensions"]["uncertainty"]["missing"]


def test_invention_asserted_edge_into_unobservable_sheet():
    cand = _perfect()
    cand["xref_edges"].append({"src": "2", "dst": "3", "sig": "FIB"})  # observed claim
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["invention_resistance"]["score"] == 0.0
    assert result["invention_violations"]
    # the same edge marked as inference is honest -> no violation
    cand2 = _perfect()
    cand2["xref_edges"].append({"src": "2", "dst": "3", "sig": "FIB", "ev": "inf"})
    result2 = system_bench.score_all(cand2, TRUTH)
    assert result2["dimensions"]["invention_resistance"]["score"] == pytest.approx(1.0)


def test_invention_fabricated_rating():
    cand = _perfect()
    cand["ratings"].append({"value": "480 V"})  # never printed on any sheet
    result = system_bench.score_all(cand, TRUTH)
    assert any(v["code"] == "fabricated_rating" for v in result["invention_violations"])


def test_fiber_path_partial_credit():
    cand = _perfect()
    cand["paths"]["fiber_loop"] = ["2", "5"]  # skipped the middle hop -> LCS 2/3
    result = system_bench.score_all(cand, TRUTH)
    assert result["dimensions"]["fiber_loop"]["score"] == pytest.approx(2 / 3)


def test_cases_table_defines_all_seven():
    assert set(system_bench.CASES) == {"B1", "B2", "B3", "B4", "B5", "B6", "B7"}
    for case in system_bench.CASES.values():
        assert case["kind"] in {"per_page", "per_page_honesty", "system", "system_full"}


def test_report_and_dry_run_are_cp1252_safe():
    result = system_bench.score_all(_perfect(), TRUTH)
    system_bench.render_score_report("synthetic", result).encode("cp1252")
    system_bench.render_case_manifest().encode("cp1252")


def test_demo_report_over_index_is_cp1252_safe():
    index = {
        "sheets": [
            {"sheet": "1", "quality": "clear_upright",
             "devices": [{"tag": "-1/K01", "kind": "contactor", "ev": "obs"}],
             "xrefs": [{"sig": "CTRL", "dir": "out", "peer": "S2.1", "ev": "obs"}]},
            {"sheet": "2", "quality": "blurred", "devices": [], "xrefs": []},
        ]
    }
    report = system_bench.render_demo_report(index)
    report.encode("cp1252")
    assert "unverifiable" in report


def test_module_imports_without_anthropic_sdk():
    importlib.reload(system_bench)


def test_score_all_does_not_mutate_inputs():
    cand, truth = _perfect(), copy.deepcopy(TRUTH)
    before = copy.deepcopy(cand)
    system_bench.score_all(cand, truth)
    assert cand == before
    assert truth == TRUTH
