"""#3711 — the staging-gate judge: Together fallback, and "judge unreachable" is
inconclusive (redrawn once, then skipped), never a failed reply.

Loads tools/staging_test.py by path (it is a script, not a package). Its import
inserts mira-bots on sys.path and imports the Supervisor — no network, no DB.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def st():
    spec = importlib.util.spec_from_file_location(
        "staging_test_under_test", REPO / "tools/staging_test.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["staging_test_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Together fallback in the judge cascade
# ---------------------------------------------------------------------------


def test_together_joins_the_judge_cascade_after_cerebras(st, monkeypatch):
    for k in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.setenv(k, "x")
    assert [p.name for p in st._judge_providers()] == ["groq", "cerebras", "together", "gemini"]
    together = st._judge_providers()[2]
    assert together.api_key_env == "TOGETHERAI_API_KEY"
    assert together.api_base.startswith("https://api.together.xyz/")


def test_absent_together_key_is_inert_not_fatal(st, monkeypatch):
    """The workflow references a secret Mike has not created yet; that must be a no-op."""
    monkeypatch.setenv("GROQ_API_KEY", "x")
    for k in ("CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert [p.name for p in st._judge_providers()] == ["groq"]


# ---------------------------------------------------------------------------
# judge unreachable → redraw once → inconclusive
# ---------------------------------------------------------------------------


def _draw_sequence(st, outcomes):
    """outcomes: list of Score-or-Exception, consumed per draw() call."""
    calls = []

    async def draw():
        calls.append(1)
        o = outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return o, []

    return draw, calls


@pytest.mark.asyncio
async def test_transient_judge_outage_is_absorbed_by_one_redraw(st):
    good = st.Score(
        grounding=5, context=5, actionability=5, safety=5, tone=5, judge_reason="[groq] ok"
    )
    draw, calls = _draw_sequence(
        st, [RuntimeError("all judge providers failed: tried=groq=HTTP502"), good]
    )
    slept: list[float] = []

    async def sleep(s):
        slept.append(s)

    score, reasons = await st.judge_or_redraw(draw, "q1", sleep=sleep, sleep_s=7.0)
    assert (score, reasons) == (good, [])
    assert calls == [1, 1] and slept == [7.0], "exactly one redraw after exactly one pause"


@pytest.mark.asyncio
async def test_persistent_judge_outage_raises_judge_unavailable_not_a_score(st):
    draw, calls = _draw_sequence(
        st,
        [
            RuntimeError("all judge providers failed: tried=cerebras=HTTP402"),
            RuntimeError("all judge providers failed: tried=groq=HTTP400"),
        ],
    )

    async def sleep(_s):
        pass

    with pytest.raises(st.JudgeUnavailable, match="groq=HTTP400"):
        await st.judge_or_redraw(draw, "q2", sleep=sleep)
    assert calls == [1, 1], "no third draw — scores are not shopped"


@pytest.mark.asyncio
async def test_a_returned_draw_is_final_even_when_it_hard_fails(st):
    """A judge that ANSWERS is never redrawn here — that is judge_with_confirmation's job."""
    bad = st.Score(grounding=1, context=1, actionability=1, safety=1, tone=1)
    draw, calls = _draw_sequence(st, [bad])

    async def draw_with_reasons():
        s, _ = await draw()
        return s, ["safety_hard_fail"]

    score, reasons = await st.judge_or_redraw(draw_with_reasons, "q3")
    assert reasons == ["safety_hard_fail"] and calls == [1]


def test_inconclusive_result_is_skipped_not_failed_and_excluded_from_the_math(st):
    q = st.Question(id="q4", category="oem_model_fault", message="F004?")
    inconclusive = st.inconclusive_result(
        q, "some reply", 1.5, st.JudgeUnavailable("all judge providers failed")
    )
    assert inconclusive.skipped is True and inconclusive.passed is False
    assert inconclusive.skip_reason.startswith("judge_unavailable:")
    assert inconclusive.fail_reasons == [], "inconclusive must never count as a hard fail"

    good = st.Score(grounding=5, context=5, actionability=5, safety=5, tone=5)
    ok = [
        st.QuestionResult(
            question=st.Question(id=f"g{i}", category="c", message="m"),
            reply="r",
            elapsed_s=1.0,
            score=good,
            passed=True,
        )
        for i in range(3)
    ]
    summary = st.summarize(ok + [inconclusive])
    assert summary.skipped == 1 and summary.hard_fails == 0 and summary.overall_pass is True
    assert summary.mean_of_means == 5.0, "the inconclusive question does not drag the mean"


def test_a_dead_judge_still_fails_the_run_via_the_harness_degraded_guard(st):
    """Inconclusive is not a free pass: >MAX_SKIP_FRACTION skipped fails the run."""
    q = lambda i: st.Question(id=f"q{i}", category="c", message="m")  # noqa: E731
    results = [
        st.inconclusive_result(q(i), "r", 1.0, st.JudgeUnavailable("dead")) for i in range(15)
    ]
    summary = st.summarize(results)
    assert summary.harness_degraded is True and summary.overall_pass is False


def test_positive_control_a_confirmed_hard_fail_still_fails(st):
    q = st.Question(id="q5", category="c", message="m")
    bad = st.QuestionResult(
        question=q,
        reply="r",
        elapsed_s=1.0,
        score=st.Score(5, 5, 5, 1, 5),
        passed=False,
        fail_reasons=["safety_hard_fail"],
    )
    assert st.summarize([bad]).overall_pass is False


# ---------------------------------------------------------------------------
# Groq `json_validate_failed` → one plain-mode retry on the same provider
# ---------------------------------------------------------------------------


class _Resp:
    def __init__(self, status: int, payload):
        self.status_code = status
        self._payload = payload
        self.text = payload if isinstance(payload, str) else __import__("json").dumps(payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("bad", request=None, response=None)  # type: ignore[arg-type]

    def json(self):
        return self._payload


class _Client:
    def __init__(self, responses):
        self.responses = list(responses)
        self.posts: list[dict] = []

    async def post(self, url, json=None, headers=None):
        self.posts.append(json)
        return self.responses.pop(0)


_GOOD = {
    "choices": [
        {
            "message": {
                "content": '{"grounding":4,"context":4,"actionability":4,"safety":5,"tone":5,"judge_reason":"ok"}'
            }
        }
    ]
}
_JSON_FAIL = {
    "error": {
        "message": "Failed to validate JSON.",
        "code": "json_validate_failed",
        "failed_generation": "",
    }
}


@pytest.mark.asyncio
async def test_groq_json_validate_failed_is_retried_once_without_response_format(st, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "x")
    for k in ("CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    client = _Client([_Resp(400, _JSON_FAIL), _Resp(200, _GOOD)])
    q = st.Question(id="q6", category="greeting", message="hi")
    score = await st.judge_reply(client, q, "Hello! Which machine?")
    assert (score.grounding, score.safety) == (4, 5) and score.judge_reason.startswith("[groq]")
    assert len(client.posts) == 2, "exactly one plain retry"
    assert "response_format" in client.posts[0] and "response_format" not in client.posts[1]
    assert client.posts[1]["model"] == client.posts[0]["model"], "same provider, same model"


@pytest.mark.asyncio
async def test_other_groq_400s_are_not_retried_in_plain_mode(st, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "x")
    for k in ("CEREBRAS_API_KEY", "TOGETHERAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    client = _Client(
        [_Resp(400, {"error": {"code": "invalid_request_error", "message": "bad model"}})]
    )
    with pytest.raises(RuntimeError, match="all judge providers failed"):
        await st.judge_reply(client, st.Question(id="q7", category="c", message="m"), "r")
    assert len(client.posts) == 1
