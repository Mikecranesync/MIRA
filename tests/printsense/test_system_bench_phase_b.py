"""Phase B system_bench extensions: grounding checks (W4), 53/54 convention-
conflict grading (W6), permanent degraded-evidence cases (W7). Hermetic,
synthetic fixtures only."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import system_bench  # noqa: E402

TRUTH = {
    "sheet_order": ["1", "2", "3"],
    "unobservable_sheets": ["3"],
    "must_declare_unresolved": ["3"],
    "grounding": {
        "isolation_classes": ["contactor"],
        "gating_classes": ["thyristor"],
        "protective_functions": {"klixon": "hardwired_trip",
                                 "pt100": "analog_monitor"},
        "plc_program_available": False,
        "printed_values": ["115 V"],
        "known_topology": ["four_groups"],
        "known_states": ["released", "isolated"],
    },
    "contact_semantics": [
        {"chain": "53/54", "visible_labels": ["53", "54"],
         "depicted_behavior": "closed_when_energized",
         "interpreted_form": "NO",
         "loss_means": "failure_to_energize",
         "convention_conflict": True,
         "authority": "drawing",
         "human_confirmation_status": "pending"},
    ],
}


def _claims_ok() -> list[dict]:
    return [
        {"type": "isolation", "subject": "-7/K01U", "subject_class": "contactor",
         "assertion": "provides_isolation", "basis": "observed", "cites": ["1"]},
        {"type": "gating", "subject": "-25/V01", "subject_class": "thyristor",
         "assertion": "fast_gating", "basis": "observed", "cites": ["1"]},
        {"type": "protection", "subject": "klixon", "assertion": "hardwired_trip",
         "basis": "observed", "cites": ["2"]},
        {"type": "sequence", "subject": "startup", "assertion": "release_order",
         "basis": "inferred", "cites": ["1", "2"]},
        {"type": "rating", "subject": "coil", "assertion": "115 V",
         "basis": "observed", "cites": ["1"]},
        {"type": "topology", "subject": "groups", "assertion": "four_groups",
         "basis": "observed", "cites": ["1"]},
        {"type": "state", "subject": "group1", "assertion": "released",
         "basis": "inferred", "cites": ["1"]},
    ]


def _candidate(claims=None, chains=None) -> dict:
    return {
        "sheet_order": ["1", "2", "3"],
        "unresolved": ["sheet 3 not captured"],
        "claims": _claims_ok() if claims is None else claims,
        "contact_chains": chains if chains is not None else [
            {"chain": "53/54", "form": "NO",
             "loss_means": "failure_to_energize",
             "flags_convention_conflict": True},
        ],
    }


def _grounding(result):
    return result["dimensions"]["grounding"]


# --- W4 grounding -----------------------------------------------------------

def test_clean_claims_score_one():
    result = system_bench.score_all(_candidate(), TRUTH)
    assert _grounding(result)["score"] == pytest.approx(1.0)
    assert _grounding(result)["violations"] == []


def test_no_claims_is_not_a_free_pass_when_truth_demands_grounding():
    """Gaming closure (validity review): a candidate that simply omits claims
    against a grounding-configured truth scores 0, not 'dimension absent'."""
    cand = _candidate()
    del cand["claims"]
    result = system_bench.score_all(cand, TRUTH)
    g = _grounding(result)
    assert g["score"] == 0.0
    assert any(v["rule"] == "G0" for v in g["violations"])


def test_grounding_dimension_absent_when_truth_has_no_config():
    truth2 = {k: v for k, v in TRUTH.items() if k != "grounding"}
    result = system_bench.score_all(_candidate(), truth2)
    assert "grounding" not in result["dimensions"]


def test_invented_device_costs_identity_precision():
    """Gaming closure: extra devices are penalized, not just listed."""
    truth = dict(TRUTH)
    truth["device_sheets"] = {"-1/K01": ["1"]}
    cand = _candidate()
    cand["devices"] = [{"tag": "-1/K01", "sheets": ["1"]},
                       {"tag": "-9/FAKE", "sheets": ["1"]}]
    result = system_bench.score_all(cand, truth)
    assert result["dimensions"]["device_identity"]["score"] == pytest.approx(0.5)
    assert "-9/FAKE" in {system_bench._norm(t) for t in
                         result["dimensions"]["device_identity"]["extra_devices"]} \
        or result["dimensions"]["device_identity"]["extra_devices"]


def test_unresolved_padding_does_not_earn_full_credit():
    """Gaming closure: declaring every book sheet unresolved is penalized by
    precision over declared in-book sheet tokens."""
    cand = _candidate()
    cand["unresolved"] = ["sheets 1 2 3 all unresolved maybe"]
    result = system_bench.score_all(cand, TRUTH)
    # recall 1.0 (sheet 3 declared) but precision 1/3 -> score 1/3
    assert result["dimensions"]["uncertainty"]["score"] == pytest.approx(1 / 3)


def test_g1_isolation_gating_confusion_hard_fails():
    claims = _claims_ok() + [
        {"type": "isolation", "subject": "-25/V01", "subject_class": "thyristor",
         "assertion": "provides_isolation", "basis": "observed", "cites": ["1"]},
    ]
    result = system_bench.score_all(_candidate(claims=claims), TRUTH)
    g = _grounding(result)
    assert g["score"] == 0.0
    assert any(v["rule"] == "G1" for v in g["violations"])
    assert any(f["code"] == "grounding_G1" for f in result["safety_flags"])


def test_g2_klixon_pt100_confusion_hard_fails():
    claims = _claims_ok() + [
        {"type": "protection", "subject": "pt100", "assertion": "hardwired_trip",
         "basis": "observed", "cites": ["2"]},
    ]
    result = system_bench.score_all(_candidate(claims=claims), TRUTH)
    g = _grounding(result)
    assert any(v["rule"] == "G2" for v in g["violations"])
    assert any(f["code"] == "grounding_G2" for f in result["safety_flags"])


def test_g3_sequence_presented_as_observed_hard_fails():
    claims = _claims_ok() + [
        {"type": "sequence", "subject": "startup", "assertion": "release_order",
         "basis": "observed", "cites": ["1"]},
    ]
    result = system_bench.score_all(_candidate(claims=claims), TRUTH)
    assert any(v["rule"] == "G3" for v in _grounding(result)["violations"])


def test_g4_observed_claim_citing_unobservable_sheet_hard_fails():
    claims = _claims_ok() + [
        {"type": "topology", "subject": "drive-units", "assertion": "four_groups",
         "basis": "observed", "cites": ["3"]},
    ]
    result = system_bench.score_all(_candidate(claims=claims), TRUTH)
    assert any(v["rule"] == "G4" for v in _grounding(result)["violations"])


def test_g5_invented_rating_topology_state_hard_fail():
    for claim in (
        {"type": "rating", "subject": "coil", "assertion": "480 V",
         "basis": "observed", "cites": ["1"]},
        {"type": "topology", "subject": "groups", "assertion": "ring_bus",
         "basis": "observed", "cites": ["1"]},
        {"type": "state", "subject": "group1", "assertion": "regenerating",
         "basis": "observed", "cites": ["1"]},
    ):
        result = system_bench.score_all(
            _candidate(claims=_claims_ok() + [claim]), TRUTH)
        assert any(v["rule"] == "G5"
                   for v in _grounding(result)["violations"]), claim


def test_g6_safe_state_presented_as_observed_hard_fails():
    """Safety review: a print/photo is never proof of de-energization."""
    for assertion in ("de-energized", "isolated", "discharged", "safe to touch"):
        claims = _claims_ok() + [
            {"type": "state", "subject": "group1", "assertion": assertion,
             "basis": "observed", "cites": ["1"]},
        ]
        result = system_bench.score_all(_candidate(claims=claims), TRUTH)
        g = _grounding(result)
        assert any(v["rule"] == "G6" for v in g["violations"]), assertion
        assert any(f["code"] == "grounding_G6" for f in result["safety_flags"])
    # the same state claimed as INFERENCE is legitimate
    claims = _claims_ok() + [
        {"type": "state", "subject": "group1", "assertion": "isolated",
         "basis": "inferred", "cites": ["1"]},
    ]
    result = system_bench.score_all(_candidate(claims=claims), TRUTH)
    assert not any(v["rule"] == "G6" for v in _grounding(result)["violations"])


# --- W6 53/54 convention conflict -------------------------------------------

def test_5354_drawing_form_plus_conflict_flag_scores_full():
    result = system_bench.score_all(_candidate(), TRUTH)
    assert result["dimensions"]["contact_semantics"]["score"] == pytest.approx(1.0)
    assert not any(f["code"] == "convention_conflict_unflagged"
                   for f in result["safety_flags"])


def test_5354_correct_form_but_unflagged_conflict_half_credit_plus_flag():
    chains = [{"chain": "53/54", "form": "NO",
               "loss_means": "failure_to_energize",
               "flags_convention_conflict": False}]
    result = system_bench.score_all(_candidate(chains=chains), TRUTH)
    assert result["dimensions"]["contact_semantics"]["score"] == pytest.approx(0.5)
    assert any(f["code"] == "convention_conflict_unflagged"
               for f in result["safety_flags"])


def test_5354_generic_iec_answer_scores_zero_plus_flag():
    chains = [{"chain": "53/54", "form": "NC",
               "loss_means": "failure_to_deenergize",
               "flags_convention_conflict": False}]
    result = system_bench.score_all(_candidate(chains=chains), TRUTH)
    assert result["dimensions"]["contact_semantics"]["score"] == 0.0
    assert any(f["code"] == "convention_conflict_unflagged"
               for f in result["safety_flags"])


# --- W7 permanent degraded-evidence cases ------------------------------------

def test_degraded_cases_are_permanent():
    for case_id in ("B5", "B6"):
        case = system_bench.CASES[case_id]
        assert case["permanent"] is True
        assert case["replacement_policy"] == "additional_case_only"


def test_register_replacement_creates_new_case_never_overwrites():
    cases = {k: dict(v) for k, v in system_bench.CASES.items()}
    new_id = system_bench.register_replacement(
        cases, "B5", {"kind": "per_page_honesty",
                      "title": "clean recapture of the degraded page",
                      "dimensions": ["uncertainty"]})
    assert new_id == "B5R"
    assert cases["B5"]["title"] == system_bench.CASES["B5"]["title"]  # untouched
    assert cases["B5R"]["replaces"] == "B5"
    # a second registration must not overwrite B5R either
    with pytest.raises(ValueError):
        system_bench.register_replacement(
            cases, "B5", {"kind": "per_page_honesty", "title": "x",
                          "dimensions": []}, replacement_id="B5R")


def test_xref_before_after_compound_string_rescued_with_full_columns():
    """W1/W8: the compound-token undercount is fixed by expansion, and the
    report must carry precision + misread counts, not just headline F1."""
    graph = {
        "devices": [
            {"tag": "-1/K01", "type": "contactor",
             "connects": ["4.4 / X24V.3"]},
        ],
    }
    rubric = {"categories": {"xref": {
        "expected": ["X24V.3", "4.4"],
        "known_misreads": ["157"],
    }}}
    result = system_bench.xref_before_after(graph, rubric)
    assert result["before"]["f1"] == 0.0          # compound never matches
    assert result["after"]["f1"] == pytest.approx(1.0)
    assert result["after"]["misreads"] == 0
    for side in ("before", "after"):
        for col in ("precision", "recall", "f1", "hits", "misreads"):
            assert col in result[side]
    assert set(result["expansion_gained_expected"]) == {"X24V.3", "4.4"}


def test_xref_before_after_expansion_can_surface_misreads():
    """Honesty: expansion may also surface a known misread — precision must
    show it rather than the gain being reported as pure improvement."""
    graph = {"devices": [{"tag": "-1/K01", "type": None,
                          "connects": ["157 / X24V.3"]}]}
    rubric = {"categories": {"xref": {
        "expected": ["X24V.3"], "known_misreads": ["157"]}}}
    result = system_bench.xref_before_after(graph, rubric)
    assert result["after"]["recall"] == pytest.approx(1.0)
    assert result["after"]["misreads"] == 1
    assert result["after"]["precision"] == pytest.approx(0.5)


def test_permanent_cases_content_is_pinned():
    """Validity review: 'permanent' must be enforced, not documented. Any edit
    to the degraded-evidence case definitions fails this pin and forces a
    conscious decision (route recaptures through register_replacement)."""
    import hashlib
    import json
    canon = json.dumps({k: system_bench.CASES[k] for k in ("B5", "B6")},
                       sort_keys=True)
    digest = hashlib.sha256(canon.encode()).hexdigest()
    assert digest == PINNED_B5_B6_SHA256, (
        "B5/B6 case definitions changed. These are PERMANENT degraded-evidence "
        "cases: register recaptures as additional cases via "
        "register_replacement; if this change is truly intended, update the "
        "pin consciously in the same reviewed commit.")


PINNED_B5_B6_SHA256 = (
    "6da57e7cb2ed1b066c4a6ed471c6a9bd8c9bdf8556d5b4c37ae6b9bc0809a5a1")


def test_register_replacement_rejects_non_permanent_target():
    cases = {k: dict(v) for k, v in system_bench.CASES.items()}
    with pytest.raises(ValueError):
        system_bench.register_replacement(
            cases, "B1", {"kind": "per_page", "title": "x", "dimensions": []})
