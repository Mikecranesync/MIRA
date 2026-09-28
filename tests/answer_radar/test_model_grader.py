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


def test_client_prices_usage_and_stops_at_budget():
    transport, calls = _transport(["x", "y"], usage=(100_000, 100_000))  # $0.50 + $3.00
    c = OpenAIDirect("gpt-5.5", 1.0, api_key="k")
    with httpx.Client(transport=transport) as http:
        c.complete(http, "s", "u")
        assert c.spent_usd == pytest.approx(3.5)
        with pytest.raises(BudgetExceeded):
            c.complete(http, "s", "u")
    assert len(calls) == 1
    assert calls[0]["max_completion_tokens"] > 0 and "temperature" not in calls[0]


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
