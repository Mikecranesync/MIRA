"""Incomplete judge runs are infrastructure failures, never quality passes."""

import json
import sys
from types import SimpleNamespace

import httpx
import pytest

from benchmarks import deepeval_suite as suite


def result(passed=19, error=None, known=False):
    cases = [suite.CaseResult(f"case-{i}", "safety", True) for i in range(passed)]
    cases.extend(
        suite.CaseResult(
            f"case-{i}",
            "safety",
            False,
            error=error if i == 19 else None,
            expected_fail="Known score gap" if known and i == 19 else "",
        )
        for i in range(passed, 20)
    )
    return suite.SuiteResult(
        "offline", "2026-10-09T00:00:00Z", "fake judge", total=20, passed=passed, case_results=cases
    )


def run_cli(tmp_path, monkeypatch, outcome):
    async def run():
        return outcome

    monkeypatch.setattr(suite, "_DEEPEVAL_AVAILABLE", True)
    monkeypatch.setenv("GROQ_API_KEY", "dummy-not-a-real-key")
    monkeypatch.setattr(suite, "DeepEvalRunner", lambda **_: SimpleNamespace(run=run))
    monkeypatch.setattr(sys, "argv", ["deepeval", "--mode", "offline", "--output", str(tmp_path)])
    return suite.main()


@pytest.mark.parametrize("error", ["judge HTTP 400", ""])
@pytest.mark.parametrize("known", [False, True])
def test_one_unscored_case_cannot_hide_beneath_aggregate_threshold(
    tmp_path, monkeypatch, capsys, error, known
):
    assert run_cli(tmp_path, monkeypatch, result(error=error, known=known)) == 4
    text = capsys.readouterr().out
    assert "INFRA_FAILURE" in text
    assert "Overall quality: NOT QUALIFIED" in text
    assert "Infrastructure failures (1)" in text
    assert "regression signal" not in text
    assert "gate ignores" not in text
    payload = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert payload["verdict"] == "INFRA_FAILURE"
    assert payload["infra_failures"] == 1
    assert payload["scored"] == 19
    assert payload["total"] == 20
    assert payload["passed"] == 19
    assert payload["case_results"][-1]["error"] == error


@pytest.mark.parametrize(
    "passed,exit_code,verdict", [(19, 0, "PASS"), (17, 0, "PASS"), (16, 1, "FAIL")]
)
def test_fully_scored_runs_keep_original_threshold(
    tmp_path, monkeypatch, passed, exit_code, verdict
):
    assert run_cli(tmp_path, monkeypatch, result(passed=passed)) == exit_code
    payload = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert payload["verdict"] == verdict
    assert payload["infra_failures"] == 0
    assert payload["scored"] == 20


@pytest.mark.parametrize("condition", ["missing_key", "missing_deepeval"])
def test_setup_failure_is_infrastructure(monkeypatch, tmp_path, capsys, condition):
    monkeypatch.setattr(sys, "argv", ["deepeval", "--output", str(tmp_path)])
    monkeypatch.setattr(suite, "_DEEPEVAL_AVAILABLE", condition != "missing_deepeval")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert suite.main() == 4
    assert "INFRA_FAILURE" in capsys.readouterr().out
    assert not list(tmp_path.glob("*.json"))


@pytest.mark.asyncio
async def test_real_case_capture_keeps_exception_without_inventing_a_score(monkeypatch):
    runner = suite.DeepEvalRunner.__new__(suite.DeepEvalRunner)
    runner.mode = "offline"
    runner.judge = object()
    request = httpx.Request("POST", "https://example.invalid/judge")
    response = httpx.Response(400, request=request)

    def fail(*_):
        raise httpx.HTTPStatusError("judge unavailable", request=request, response=response)

    monkeypatch.setattr(suite, "_make_metrics", fail)
    captured = await runner._run_case(suite.ALL_CASES[0])
    assert captured.passed is False
    assert captured.error == "judge unavailable"
    assert captured.metric_scores == {}


@pytest.mark.asyncio
async def test_live_transport_failure_is_not_fed_to_judge_or_later_turns(monkeypatch):
    requests = []
    real_client = httpx.AsyncClient

    def unavailable(request):
        requests.append(request)
        return httpx.Response(400, json={"error": "unavailable"}, request=request)

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(unavailable), **kwargs),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await suite._call_mira(
            [{"user": "first"}, {"user": "follow-up"}], "https://example.invalid"
        )
    assert len(requests) == 1


@pytest.mark.parametrize("known", [False, True])
def test_infrastructure_verdict_wins_over_other_quality_failures(tmp_path, monkeypatch, known):
    assert (
        run_cli(tmp_path, monkeypatch, result(passed=16, error="judge HTTP 400", known=known)) == 4
    )


def test_all_judge_failures_have_no_quality_percentage(tmp_path, monkeypatch, capsys):
    outcome = result(passed=0)
    for case in outcome.case_results:
        case.error = "judge HTTP 400"
    assert run_cli(tmp_path, monkeypatch, outcome) == 4
    text = capsys.readouterr().out
    assert "20 unscored" in text
    assert "Overall quality: NOT QUALIFIED" in text
    assert "regression signal" not in text
    payload = json.loads(next(tmp_path.glob("*.json")).read_text())
    assert payload["scored"] == 0
    assert payload["evidence_basis"] == "reference_responses"
