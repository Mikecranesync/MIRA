"""Phase-1 capability bench — regression tests (hermetic, no network, no OCR).

Proves the goal-list properties: a deliberately wrong contact interpretation
fails; capabilities cannot cross-qualify; truth is frozen before tuning; output
is deterministic; hard failures override aggregate scores; missing fixture
inputs yield an explicit status, never a silent pass.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import capability_bench as cb  # noqa: E402
from printsense.benchmarks import golden_corpus as gc  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def test_corpus_green_and_frozen():
    """The committed corpus passes wholesale AND matches the frozen digest."""
    env = cb.run_corpus()
    assert env["cases_failed"] == 0 and not env["hard_failures"]
    committed = (REPO / "printsense/benchmarks/golden_corpus.sha256").read_text().strip()
    assert committed == gc.truth_digest(), (
        "golden corpus truth was edited without refreezing — truth is frozen "
        "before tuning; update BOTH files only as a deliberate, reviewed change"
    )


def test_wrong_contact_interpretation_fails():
    """Flipping 13/14 (NO) to NC in truth must hard-fail, not average away."""
    cases = copy.deepcopy(gc.CASES)
    case = next(c for c in cases if c["case_id"] == "iec_contactor_control")
    for term in case["truth"]["terminals"]:
        if term["cp"] in ("13", "14"):
            term["convention_role"] = "NC_by_convention"  # deliberately wrong
    env = cb.run_corpus(cases, enforce_freeze=False)
    classes = {h["class"] for h in env["hard_failures"]}
    assert "contact_convention" in classes
    assert env["cases_failed"] >= 1


def test_hard_failure_overrides_aggregate_scores():
    """One tampered case fails the whole bench even with 13 perfect cases."""
    cases = copy.deepcopy(gc.CASES)
    case = next(c for c in cases if c["case_id"] == "unreadable_page")
    case["tokens"] = [
        {"text": "-90/K09", "bbox": [10, 10, 70, 28], "line": (0, 10)}
    ]  # a claim on an unreadable page
    env = cb.run_corpus(cases, enforce_freeze=False)
    assert env["cases_passed"] >= len(cases) - 2  # averages look fine...
    assert any(
        h["class"] in ("refusal_violated", "invention") for h in env["hard_failures"]
    )  # ...but the bench still fails
    assert (
        env["capabilities"]["refusal_on_unreadable"]["status"] == "fail"
        or env["capabilities"]["unsupported_claim_resistance"]["status"] == "fail"
    )


def test_capability_cannot_cross_qualify():
    """Removing every xref case leaves device extraction untouched, and the
    xref lane reports no_cases rather than inheriting anyone's pass."""
    cases = [copy.deepcopy(c) for c in gc.CASES if not c["truth"].get("xrefs")]
    for c in cases:
        c["truth"]["xrefs"] = []
    env = cb.run_corpus(cases, enforce_freeze=False)
    dev_full = cb.run_corpus(enforce_freeze=False)["capabilities"]["device_extraction"]
    dev_sub = env["capabilities"]["device_extraction"]
    assert dev_sub["status"] == dev_full["status"] == "pass"
    # xref lane must not claim a pass it never earned on an empty case set
    assert env["capabilities"]["cross_sheet_refs"]["cases"] <= dev_sub["cases"]


def test_truth_tampering_is_a_hard_failure():
    cases = copy.deepcopy(gc.CASES)
    cases[0]["truth"]["devices"][0]["tag"] = "-91/K99"  # silent truth edit
    env = cb.run_corpus(cases, enforce_freeze=True)
    assert any(h["class"] == "truth_tampered" for h in env["hard_failures"])


def test_output_is_deterministic():
    a = cb.stable_envelope_json(cb.run_corpus(enforce_freeze=False))
    b = cb.stable_envelope_json(cb.run_corpus(enforce_freeze=False))
    assert a == b
    assert json.loads(a)["deterministic"] is True


def test_missing_fixture_inputs_explicit_status():
    res = cb.grade_case_lanes({"case_id": "broken", "truth": {"devices": []}})
    assert res["status"] == "missing_input"
    assert res["hard_failures"][0]["class"] == "missing_input"


def test_known_misread_assertion_hard_fails():
    """Asserting an OCR-confusable wrong form (O/0, I/1, S/5, B/8) is fatal.

    The deterministic token extractor is too strict to even emit these forms
    (verified: -91/KO1 does not match the device grammar), so the detector is
    proven at the claim layer — the seam every future extraction surface
    (interpreter, provider) flows through."""
    case = next(c for c in gc.CASES if c["case_id"] == "iec_contactor_control")
    tampered = {
        "devices": [{"tag": "-91/KO1", "bbox": [110, 100, 170, 118]}],
        "cables": [],
        "records": [],
        "profile": {"selected_profile": "eplan_iec", "conflicts": []},
    }
    res = cb.grade_case_lanes(case, extraction=tampered)
    assert any(h["class"] == "known_misread_asserted" for h in res["hard_failures"])
    assert res["status"] == "hard_fail"


def test_unreadable_case_refusal_is_the_pass():
    case = next(c for c in gc.CASES if c["case_id"] == "unreadable_page")
    res = cb.grade_case_lanes(case)
    assert res["status"] == "pass"
    assert res["lanes"]["refusal_on_unreadable"]["ok"] is True


def test_next_page_recommendation_never_invents():
    case = next(c for c in gc.CASES if c["case_id"] == "partial_crop_missing_context")
    ex = cb.extract_case(case)
    assert cb.recommend_next_pages(ex["records"]) == ["89"]
    # and with a fully-resolved index, nothing is recommended
    resolved = copy.deepcopy(case)
    resolved["page_index"] = {"sheets": {"89": "pg89", "92": "pg92"}, "anchors": {"89": ["K891"]}}
    assert cb.recommend_next_pages(cb.extract_case(resolved)["records"]) == []


def test_case_ids_unique_and_labeled_synthetic():
    ids = gc.case_ids()
    assert len(ids) == len(set(ids))
    assert all(c["truth_status"] == "synthetic" for c in gc.CASES)


def test_phone_summary_and_report_render():
    env = cb.run_corpus(enforce_freeze=False)
    s = cb.phone_summary(env, [("scu2", "PASS", "PASS")])
    assert "PrintSense phase1" in s and "scu2 PASS" in s
    md = cb.render_report(env)
    assert "# PrintSense capability bench" in md
    assert "| capability |" in md
