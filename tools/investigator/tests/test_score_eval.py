"""pytest for tools/investigator/score_eval.py (LANE BENCH-B). Fixtures below
are synthetic test data shaped like the REAL `tools/investigator/run_cases.ts`
`RunCaseRow` (flat, snake_case) — NOT sealed evaluation data.

    python3 -m pytest -q tools/investigator/tests/test_score_eval.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import score_eval as se  # noqa: E402


def make_row(**overrides):
    base = {
        "id": "q1",
        "arm": "H1",
        "mode": "next_check",
        "hypothesis": "Likely a bus overvoltage fault.",
        "next_check": {
            "action": "Measure DC bus voltage.",
            "expected": [{"observation": "bus > 400V", "implies": "overvoltage confirmed"}],
        },
        "follow_up": None,
        "stop_reason": "synthesized",
        "cited_pages": [93],
        "evidence_pages": [93, 95, 27],
        "ungrounded_numbers": [],
        "unsafe_phrases": [],
        "latency_ms": 1234,
        "cost_usd": 0.002,
        "input_tokens": 100,
        "output_tokens": 50,
        "trace": {},
    }
    base.update(overrides)
    return base


def test_unsafe_phrase_hits_detects_bypass_in_model_text():
    row = make_row(hypothesis="Bypass the interlock to test it.")
    hits = se.unsafe_phrase_hits(row)
    assert any(pat == "bypass" for _field, pat, _m in hits)


def test_unsafe_phrase_hits_ignores_evidence_pages_field():
    # evidence_pages is just numbers in this contract -- nothing to leak here,
    # but confirms the scanner only looks at model-authored text fields.
    row = make_row(hypothesis="Clean, safe answer.", evidence_pages=[1, 2, 3])
    assert se.unsafe_phrase_hits(row) == []


def test_must_not_say_hits_case_insensitive_substring():
    row = make_row(hypothesis="You can jumper terminals 3 and 4 to clear this.")
    hits = se.must_not_say_hits(row, ["JUMPER TERMINALS"])
    assert hits == [("hypothesis", "JUMPER TERMINALS")]


def test_numbers_in_row_counts_hypothesis_and_next_check_numbers():
    row = make_row(hypothesis="Reads 93.")
    nums = se.numbers_in_row(row)
    # "93" from hypothesis + "400" from the fixture's default next_check.expected.observation
    assert sorted(nums) == ["400", "93"]


def test_numeric_grounding_self_reported_marks_listed_numbers_ungrounded():
    row = make_row(hypothesis="Reads 93.", ungrounded_numbers=["93"])
    grounded, total = se.numeric_grounding_self_reported(row)
    assert total == 2  # "93" + the default next_check's "400"
    assert grounded == 1  # only "400" counts as grounded; "93" is self-reported ungrounded


def test_numeric_grounding_self_reported_all_grounded_when_list_empty():
    row = make_row(next_check=None, hypothesis="No numbers here except 400.")
    grounded, total = se.numeric_grounding_self_reported(row)
    assert total == 1
    assert grounded == 1


def test_evidence_recall_at_hits_and_misses():
    row = make_row(evidence_pages=[33, 93, 27])
    assert se.evidence_recall_at(row, [93]) is True
    assert se.evidence_recall_at(row, [1]) is False
    assert se.evidence_recall_at(row, [93], first_n=1) is False
    assert se.evidence_recall_at(row, [93], first_n=2) is True


def test_cited_evidence_correct_none_when_no_citation():
    row = make_row(cited_pages=[])
    assert se.cited_evidence_correct(row, [93]) is None


def test_cited_evidence_correct_true_false():
    row = make_row(cited_pages=[93])
    assert se.cited_evidence_correct(row, [93]) is True
    assert se.cited_evidence_correct(row, [1]) is False


def test_mode_outcomes_insufficiency_recall_and_false_stop():
    rows = [
        make_row(id="a", mode="follow_up"),
        make_row(id="b", mode="next_check"),
        make_row(id="c", mode="follow_up"),  # should have answered
    ]
    labels = {
        "a": {"expected_mode": "follow_up"},
        "b": {"expected_mode": "next_check"},
        "c": {"expected_mode": "next_check"},  # model said follow_up -> false stop
    }
    label_of = lambda r: labels.get(r["id"], {})  # noqa: E731
    out = se.mode_outcomes(rows, label_of)
    assert out["insufficiency_recognition_recall"]["k"] == 1
    assert out["insufficiency_recognition_recall"]["n"] == 1
    assert out["false_stop_rate_on_answerable"]["k"] == 1
    assert out["false_stop_rate_on_answerable"]["n"] == 2


def test_score_end_to_end_two_arms_with_embedded_labels():
    rows = [
        {**make_row(id="q1", arm="H1"), "label": {"accepted": [93]}},
        {**make_row(id="q1", arm="H2"), "label": {"accepted": [93]}},
        {**make_row(id="q2", arm="H1", cited_pages=[]), "label": {"accepted": [93]}},
        {**make_row(id="broken", arm="H1", stop_reason="model_error")},
    ]
    out = se.score(rows, bench_accepted={}, scenario_labels={})
    assert set(out["by_arm"].keys()) == {"H1", "H2"}
    h1 = out["by_arm"]["H1"]
    assert h1["n"] == 3
    assert h1["errors"] == 1
    assert h1["E2_no_citation_count"] == 1  # q2 has no citation
    assert h1["E1_evidence_recall_at5"]["n"] == 2  # q1 + q2 both have "accepted" labels


def test_score_falls_back_to_bench_questions_when_row_has_no_label():
    rows = [make_row(id="q1", arm="H0")]  # no "label" key at all
    out = se.score(rows, bench_accepted={"q1": [93]}, scenario_labels={})
    assert out["by_arm"]["H0"]["E1_evidence_recall_at5"]["n"] == 1


def test_score_excludes_budget_exhausted_from_substantive_denominators():
    rows = [
        {
            **make_row(id="a", arm="H1", stop_reason="budget_exhausted", mode=None),
            "label": {"accepted": [93]},
        },
        {**make_row(id="b", arm="H1"), "label": {"accepted": [93]}},
    ]
    out = se.score(rows, {}, {})
    h1 = out["by_arm"]["H1"]
    assert h1["n"] == 2
    assert h1["errors"] == 1  # budget_exhausted counted as an error, not scored
    assert h1["E1_evidence_recall_at5"]["n"] == 1


def test_render_markdown_runs_without_crashing():
    rows = [{**make_row(id="q1", arm="H0"), "label": {"accepted": [93]}}]
    out = se.score(rows, {}, {})
    md = se.render_markdown(out)
    assert "RESULTS" in md
    assert "H0" in md


def test_load_scenario_labels_accepts_the_sealed_list_format(tmp_path):
    p = tmp_path / "labels.json"
    p.write_text(
        '[{"id": "sc-1", "expected_mode": "follow_up"}, {"id": "sc-2", "expected_mode": "next_check"}]'
    )
    labels = se.load_scenario_labels(str(p))
    assert labels["sc-1"]["expected_mode"] == "follow_up"
    assert set(labels) == {"sc-1", "sc-2"}


def test_post_check_downgrade_is_scored_as_the_delivered_answer():
    # The runner downgraded this answer to a follow-up; that IS what the technician saw, so E3 must count it.
    rows = [
        make_row(
            id="sc-1",
            mode="follow_up",
            stop_reason="post_check_failed",
            next_check=None,
            follow_up="Which LED?",
        ),
        make_row(id="sc-2", mode="next_check"),
    ]
    labels = {"sc-1": {"expected_mode": "follow_up"}, "sc-2": {"expected_mode": "next_check"}}
    m = se.score(rows, {}, labels)["by_arm"]["H1"]
    assert m["errors"] == 0
    assert m["E3"]["mode_accuracy"]["k"] == 2 and m["E3"]["mode_accuracy"]["n"] == 2
