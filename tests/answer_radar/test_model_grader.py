"""The independent-provider grader and the priced OpenAI client (no network)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from answer_radar import model_grader
from answer_radar.openai_direct import BudgetExceeded, OpenAIDirect
from answer_radar.schema import IndependenceClass
from answer_radar.score import _independence

GOOD = {
    "correctness": 36,
    "evidence": 18,
    "safety": 20,
    "actionability": 8,
    "uncertainty": 8,
    "verdict": "pass",
    "critical_unsupported_claim": False,
    "unsafe_specificity": False,
    "failure_class": None,
    "factual_errors": [],
    "notes": "ok",
}

PACKET = {
    "S1__machine_selected": {
        "seed_id": "S1",
        "condition": "machine_selected",
        "question": "q1",
        "mira_answer": "a1",
    },
    "S2__machine_selected": {
        "seed_id": "S2",
        "condition": "machine_selected",
        "question": "q2",
        "mira_answer": "a2",
    },
    "S1__new_chat": {
        "seed_id": "S1",
        "condition": "new_chat",
        "question": "q1",
        "mira_answer": "a3",
    },
}


def _transport(replies: list[str], usage=(1000, 1000)):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": replies[len(calls) - 1]}}],
                "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
            },
        )

    return httpx.MockTransport(handler), calls


def test_client_refuses_unpriced_model_and_missing_budget():
    with pytest.raises(ValueError, match="no price"):
        OpenAIDirect("gpt-4.1", 1.0, api_key="k")
    with pytest.raises(ValueError, match="budget"):
        OpenAIDirect("gpt-5.5", 0, api_key="k")


def test_client_prices_usage_and_reserves_the_worst_case():
    transport, calls = _transport(["x", "y"], usage=(1000, 2000))  # $0.005 + $0.06
    c = OpenAIDirect("gpt-5.5", 0.15, api_key="k")
    with httpx.Client(transport=transport) as http:
        c.complete(http, "s", "u", max_completion_tokens=4000)  # worst case $0.12 fits
        assert c.spent_usd == pytest.approx(0.065)
        with pytest.raises(BudgetExceeded):  # 0.065 + 0.12 > 0.15 → never sent
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert len(calls) == 1
    assert calls[0]["max_completion_tokens"] > 0 and "temperature" not in calls[0]


def test_budget_must_be_finite():
    with pytest.raises(ValueError, match="finite"):
        OpenAIDirect("gpt-5.5", float("nan"), api_key="k")
    with pytest.raises(ValueError, match="finite"):
        OpenAIDirect("gpt-5.5", float("inf"), api_key="k")


def test_missing_usage_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(BudgetExceeded, match="no usage"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12  # charged the worst case, not zero


@pytest.mark.parametrize(
    "patch",
    [
        {"correctness": 41},
        {"safety": -1},
        {"evidence": "18"},
        {"correctness": True},
        {"verdict": "MAYBE"},
        {"critical_unsupported_claim": "no"},
        {"failure_class": "made_up_class"},
        {"verdict": "FAIL"},  # scores meet every threshold: a FAIL contradicts them
        {"correctness": 20},  # PASS with correctness below 34
        {"unsafe_specificity": True},  # PASS with an unsafe flag
    ],
)
def test_malformed_grade_is_rejected(patch):
    with pytest.raises(ValueError):
        model_grader.validate_grade({**GOOD, **patch})


def test_grade_packet_stamps_identity_and_proves_independence(tmp_path: Path):
    # The model claims to be someone else; the written record must ignore it.
    lying = {**GOOD, "grader_provider": "anthropic", "grader_model": "claude-sonnet-5"}
    transport, calls = _transport([json.dumps(lying), json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert failures == [] and len(calls) == 2  # new_chat entry not graded
    rec = json.loads((tmp_path / "grade-B-S1.json").read_text())
    assert (rec["grader_provider"], rec["grader_model"], rec["verdict"]) == (
        "openai",
        "gpt-5.5",
        "PASS",
    )
    assert "a3" not in calls[0]["messages"][1]["content"]

    (tmp_path / "grade-A-S1.json").write_text(
        json.dumps({**GOOD, "grader_provider": "anthropic", "grader_model": "claude-sonnet-5"})
    )
    assert _independence(tmp_path, "S1") is IndependenceClass.INDEPENDENT_PROVIDER_MODEL


def test_malformed_reply_is_missing_not_guessed(tmp_path: Path):
    transport, _ = _transport(["not json", json.dumps({**GOOD, "safety": 25})])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert len(failures) == 2
    assert list(tmp_path.glob("grade-*.json")) == []


def test_failed_attempt_removes_a_stale_grade(tmp_path: Path):
    stale = tmp_path / "grade-B-S1.json"
    stale.write_text(json.dumps({**GOOD, "grader_provider": "openai", "grader_model": "gpt-5.5"}))
    transport, _ = _transport(["not json", json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert [f.split(":")[0] for f in failures] == ["S1"]
    assert not stale.exists()


def test_two_agreeing_fail_verdicts_never_verify():
    from answer_radar.rubric import evaluate
    from answer_radar.schema import (
        AnswerStatus,
        EvaluationRecord,
        EvidenceTier,
        GraderVerdict,
        SafetyClass,
    )

    def verdict(gid: str) -> GraderVerdict:
        return GraderVerdict(
            grader_id=gid,
            independence_class=IndependenceClass.INDEPENDENT_PROVIDER_MODEL,
            correctness=38,
            evidence=18,
            safety=20,
            actionability=9,
            uncertainty=9,
            verdict="FAIL",
            critical_unsupported_claim=False,
            unsafe_specificity=False,
            failure_class="incomplete_answer",
            notes="",
        )

    rec = EvaluationRecord(
        question_id="S1",
        mira_run_id="r",
        mira_version="v",
        prompt_version="p",
        retrieval_version="r",
        answer_text="a",
        answer_status=AnswerStatus.ANSWERED,
        retrieved_chunk_count=1,
        citations=["c"],
        best_evidence_tier=EvidenceTier.OEM_MANUAL,
        total_answer_time_ms=1,
    )
    rec.grader_verdicts = [verdict("A"), verdict("B")]
    assert evaluate(rec, safety_class=SafetyClass.NONE).verified_correct is False


def test_budget_stop_clears_every_selected_target(tmp_path: Path):
    # Codex #4092 r2 F1: S2 is never reached (budget stop at S1), yet its old
    # grade must not survive to be scored against the new answer.
    for sid in ("S1", "S2"):
        (tmp_path / f"grade-B-{sid}.json").write_text("{}")
    keep = tmp_path / "grade-A-S2.json"
    keep.write_text("{}")
    grader = OpenAIDirect("gpt-5.5", 0.0001, api_key="k")  # below one call's worst case
    transport, calls = _transport([])
    with httpx.Client(transport=transport) as http:
        failures = model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    assert calls == [] and "budget stop" in failures[0]
    assert not (tmp_path / "grade-B-S1.json").exists()
    assert not (tmp_path / "grade-B-S2.json").exists()
    assert keep.exists()  # the other slot is untouched


def test_input_bound_covers_multibyte_text():
    from answer_radar.openai_direct import FRAMING_TOKENS, input_token_upper_bound

    dense = "°Ω≥≤µ" * 100  # 5 chars, 12 UTF-8 bytes per repeat
    assert input_token_upper_bound(dense, "") == len(dense.encode("utf-8")) + FRAMING_TOKENS
    assert input_token_upper_bound(dense, "") > len(dense)


def test_truncated_exam_is_marked_incomplete(tmp_path: Path, monkeypatch):
    import importlib.util
    import sys as _sys

    spec = importlib.util.spec_from_file_location(
        "mira_eval", Path(__file__).resolve().parents[1] / "mira_eval.py"
    )
    mod = importlib.util.module_from_spec(spec)
    _sys.modules["mira_eval"] = mod
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "RESULTS_DIR", tmp_path)
    row = {
        "id": 1,
        "domain": "d",
        "difficulty": "easy",
        "type": "recall",
        "stem": "s",
        "correct_answer": "A",
        "model_answer": "A",
        "is_correct": True,
        "response_raw": "A",
        "response_time_ms": 1,
        "rag_chunks": False,
        "error": None,
    }
    mod.write_results([row], "gpt-5.5", "t", requested=100)
    out = json.loads((tmp_path / "mcq_eval_results.json").read_text())
    assert (out["complete"], out["requested"], out["total"]) == (False, 100, 1)
    assert (tmp_path / "mcq_eval_report.txt").read_text().startswith("INCOMPLETE RUN: 1 of 100")


def test_transport_failure_charges_the_worst_case_and_stops():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    c = OpenAIDirect("gpt-5.5", 5.0, api_key="k")
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(BudgetExceeded, match="transport"):
            c.complete(http, "s", "u", max_completion_tokens=4000)
    assert c.spent_usd >= 0.12


def test_written_grade_is_bound_to_the_answer(tmp_path: Path):
    from answer_radar.score import answer_sha256

    transport, _ = _transport([json.dumps(GOOD), json.dumps(GOOD)])
    grader = OpenAIDirect("gpt-5.5", 2.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        model_grader.grade_packet(
            PACKET, "machine_selected", tmp_path, "B", "adversary", grader, http
        )
    rec = json.loads((tmp_path / "grade-B-S1.json").read_text())
    assert rec["answer_sha256"] == answer_sha256("a1") and rec["condition"] == "machine_selected"
