"""Eval integrity checks: wrong keys, skipped questions and unreadable replies cannot pass."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from answer_radar.wrapper_eval import BASELINE, evaluate  # noqa: E402
from answer_radar.mcq_hub import EXAM  # noqa: E402


@pytest.fixture
def saved():
    questions = json.loads(EXAM.read_text())
    mira = [json.loads(line) for line in (BASELINE / "mira_hub_answers.jsonl").read_text().splitlines()]
    bare = json.loads((BASELINE / "bare-model/mcq_eval_results.json").read_text())["results"]
    return mira, bare, questions


def test_frozen_baseline_exposes_wrapper_regressions(saved):
    report = evaluate(*saved)
    assert (report["bare_correct"], report["mira_correct"]) == (94, 92)
    assert report["refusal_cases"] == [3, 6]
    assert report["false_warning_cases"] == [8, 12, 28, 31, 55]
    assert report["general_reasoning_count"] == 100
    assert report["missing_diagnostics_ids"] == list(range(1, 101))


def test_rereads_reply_instead_of_trusting_old_parser(saved):
    mira, bare, questions = saved
    mira[54]["model_answer"] = "UNPARSED"  # Q55 is zero-index 54
    report = evaluate(mira, bare, questions)
    assert report["paired"][54]["mira_letter"] == "D"
    assert report["mira_correct"] == 92


def test_missing_or_duplicate_question_fails_closed(saved):
    mira, bare, questions = saved
    with pytest.raises(ValueError, match="complete question IDs"):
        evaluate(mira[:-1], bare, questions)
    with pytest.raises(ValueError, match="duplicate question"):
        evaluate(mira + [mira[0]], bare, questions)


def test_answer_key_drift_fails_closed(saved):
    mira, bare, questions = saved
    questions[0]["key"] = "A" if questions[0]["key"] != "A" else "B"
    with pytest.raises(ValueError, match="answer key differs"):
        evaluate(mira, bare, questions)


def test_repaired_interventions_clear_gate_without_suppressing_other_warnings(saved):
    mira, bare, questions = saved
    for row in mira:
        if row["id"] in {3, 6, 8, 12, 28, 31, 55}:
            row["answer_text"] = row["correct_answer"] + " — explanation."
    report = evaluate(mira, bare, questions)
    assert report["regressions"] == []
    assert 62 in report["all_warning_ids"]  # a distinct hazardous step is not suppressed
    assert report["mira_correct"] == 94
