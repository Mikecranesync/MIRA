"""Time-boxed Anthropic cascade slot + MIRA_CASCADE_ORDER hot-swap — offline contract.

Owner decision 2026-11-15: PR #610 banned Anthropic because it billed real money
on auto-charge; a prepaid promotional credit reopens it, fenced so it can never
outlive that credit. These pin the three fail-closed fences and the order knob.

Run: cd mira-bots && python -m pytest tests/test_anthropic_cascade_slot.py -q
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from shared.inference.router import _anthropic_provider, _build_providers, _request_payload

ALL_ENV = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TOGETHERAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_CASCADE_ENABLED",
    "ANTHROPIC_CASCADE_NOT_AFTER",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_VISION_MODEL",
    "ANTHROPIC_MIN_OUTPUT_TOKENS",
    "MIRA_CASCADE_ORDER",
)
FUTURE = (datetime.now(UTC) + timedelta(days=1)).isoformat()
PAST = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ALL_ENV:
        monkeypatch.delenv(k, raising=False)


def _open(monkeypatch, not_after=FUTURE):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_CASCADE_ENABLED", "1")
    if not_after is not None:
        monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", not_after)


def _names():
    return [p.name for p in _build_providers()]


def test_control_slot_present_when_all_three_fences_open(monkeypatch):
    _open(monkeypatch)
    p = _anthropic_provider()
    assert p is not None
    assert p.api_url == "https://api.anthropic.com/v1/chat/completions"
    assert p.model == "claude-sonnet-4-6"
    assert p.vision_model == ""  # text-only unless opted in
    assert _names() == ["anthropic"]


def test_key_alone_never_adds_the_slot(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", FUTURE)
    assert _anthropic_provider() is None
    assert "anthropic" not in _names()


def test_flag_without_key_is_off(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_CASCADE_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", FUTURE)
    assert _anthropic_provider() is None


@pytest.mark.parametrize("bad", [None, "", "tomorrow", "2026-11-17T19:00:00"])
def test_missing_unparseable_or_naive_expiry_fails_closed(monkeypatch, bad):
    _open(monkeypatch, not_after=bad)
    assert _anthropic_provider() is None


def test_expired_slot_is_off(monkeypatch):
    _open(monkeypatch, not_after=PAST)
    assert _anthropic_provider() is None


def test_expiry_boundary_is_exclusive(monkeypatch):
    t = datetime(2026, 11, 17, 19, 0, tzinfo=UTC)
    _open(monkeypatch, not_after=t.isoformat())
    assert _anthropic_provider(now=t - timedelta(seconds=1)) is not None
    assert _anthropic_provider(now=t) is None


def test_default_order_puts_anthropic_last(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    _open(monkeypatch)
    assert _names() == ["openai", "groq", "anthropic"]


def test_cascade_order_hot_swaps_without_dropping_providers(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "k")
    _open(monkeypatch)
    monkeypatch.setenv("MIRA_CASCADE_ORDER", " Anthropic , together, nosuch, anthropic")
    assert _names() == ["anthropic", "together", "openai", "groq"]


def test_empty_cascade_order_is_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("MIRA_CASCADE_ORDER", "")
    assert _names() == ["openai", "groq"]


def test_anthropic_payload_uses_compat_fields(monkeypatch):
    _open(monkeypatch)
    p = _anthropic_provider()
    body = _request_payload(p, p.model, [{"role": "user", "content": "hi"}], 4096)
    assert body["max_tokens"] == 4096
    assert "max_completion_tokens" not in body
    assert body["model"] == "claude-sonnet-4-6"


def test_anthropic_payload_omits_temperature(monkeypatch):
    # Claude 5.5-family models 400 on `temperature` ("deprecated for this model").
    _open(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-haiku-5-5")
    p = _anthropic_provider()
    body = _request_payload(p, p.model, [{"role": "user", "content": "hi"}], 4096)
    assert "temperature" not in body
    assert body == {
        "model": "claude-haiku-5-5",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": "hi"}],
    }


def test_compat_providers_still_send_temperature():
    # Control: the omission is scoped to the anthropic slot, not every compat provider.
    from shared.inference.router import _Provider

    p = _Provider(name="groq", api_url="https://x", api_key="k", model="m")
    body = _request_payload(p, p.model, [{"role": "user", "content": "hi"}], 512)
    assert body["temperature"] == 0.1


def test_anthropic_payload_floors_short_caps(monkeypatch):
    # The conversation router asks for 300; thinking would spend it and return "".
    _open(monkeypatch)
    p = _anthropic_provider()
    msgs = [{"role": "user", "content": "hi"}]
    assert _request_payload(p, p.model, msgs, 300)["max_tokens"] == 2048
    assert _request_payload(p, p.model, msgs, 4096)["max_tokens"] == 4096  # larger caps kept
    monkeypatch.setenv("ANTHROPIC_MIN_OUTPUT_TOKENS", "1024")
    assert _request_payload(p, p.model, msgs, 300)["max_tokens"] == 1024


def test_compat_providers_keep_short_caps():
    # Control: the floor is scoped to the anthropic slot.
    from shared.inference.router import _Provider

    p = _Provider(name="groq", api_url="https://x", api_key="k", model="m")
    body = _request_payload(p, p.model, [{"role": "user", "content": "hi"}], 300)
    assert body["max_tokens"] == 300


async def test_floor_reaches_the_wire(monkeypatch):
    # The send loop rewrites the cap per attempt; the floor must survive it.
    from unittest.mock import MagicMock, patch

    from shared.inference.router import InferenceRouter

    _open(monkeypatch)
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    posts = []

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            posts.append(dict(json))
            ok = MagicMock()
            ok.raise_for_status = MagicMock()
            ok.json = MagicMock(
                return_value={
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 2},
                }
            )
            return ok

    r = InferenceRouter()
    r.write_api_usage = MagicMock()
    assert [p.name for p in r.providers] == ["anthropic"]
    with patch("shared.inference.router.httpx.AsyncClient", _Client):
        content, _ = await r.complete(
            [{"role": "user", "content": "hi"}], max_tokens=300, reasoning_retry=False
        )
    assert content == "ok"
    assert posts[0]["max_tokens"] == 2048

    # Control: on the same send path a non-anthropic provider keeps the caller's 300.
    monkeypatch.setenv("ANTHROPIC_CASCADE_ENABLED", "0")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    posts.clear()
    r = InferenceRouter()
    r.write_api_usage = MagicMock()
    assert [p.name for p in r.providers] == ["groq"]
    with patch("shared.inference.router.httpx.AsyncClient", _Client):
        await r.complete([{"role": "user", "content": "hi"}], max_tokens=300, reasoning_retry=False)
    assert posts[0]["max_tokens"] == 300


# --- Deadline is re-checked before every send (Codex r1 F1 on #5568) ----------
# A router is built once and cached for the process, so a check at construction
# alone let a long-running service keep calling Anthropic past the deadline.

DEADLINE = datetime(2026, 11, 17, 19, 0, tzinfo=UTC)


def _wire(responses, posts):
    from unittest.mock import MagicMock

    import httpx

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            posts.append(url)
            status, body = responses.get(url, (200, "fallback answer"))
            resp = MagicMock()
            if status != 200:
                req = httpx.Request("POST", url)
                err = httpx.Response(status, request=req, headers={"retry-after": "1"})
                resp.raise_for_status = MagicMock(
                    side_effect=httpx.HTTPStatusError("x", request=req, response=err)
                )
            else:
                resp.raise_for_status = MagicMock()
            resp.json = MagicMock(
                return_value={
                    "choices": [{"message": {"content": body}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 2},
                }
            )
            return resp

    return _Client


def _router_before_deadline(monkeypatch):
    from unittest.mock import MagicMock

    from shared.inference import router as rmod

    _open(monkeypatch, DEADLINE.isoformat())
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("MIRA_CASCADE_ORDER", "anthropic,groq")
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setattr(rmod, "_now", lambda: DEADLINE - timedelta(minutes=1))
    r = rmod.InferenceRouter()
    r.write_api_usage = MagicMock()
    assert [p.name for p in r.providers] == ["anthropic", "groq"]
    return rmod, r


async def test_cached_router_stops_calling_anthropic_at_the_deadline(monkeypatch):
    from unittest.mock import patch

    rmod, r = _router_before_deadline(monkeypatch)
    posts: list[str] = []
    anth = "https://api.anthropic.com/v1/chat/completions"
    with patch.object(rmod.httpx, "AsyncClient", _wire({anth: (200, "claude")}, posts)):
        content, _ = await r.complete([{"role": "user", "content": "hi"}], reasoning_retry=False)
        assert content == "claude"  # control: before the deadline the slot answers

        monkeypatch.setattr(rmod, "_now", lambda: DEADLINE)
        posts.clear()
        content, usage = await r.complete(
            [{"role": "user", "content": "hi"}], reasoning_retry=False
        )
    assert anth not in posts
    assert content == "fallback answer"
    assert usage["provider"] == "groq"


async def test_deadline_passing_during_a_rate_limit_wait_blocks_the_retry(monkeypatch):
    from unittest.mock import patch

    rmod, r = _router_before_deadline(monkeypatch)
    posts: list[str] = []
    anth = "https://api.anthropic.com/v1/chat/completions"

    async def _sleep_past_deadline(_s):
        monkeypatch.setattr(rmod, "_now", lambda: DEADLINE + timedelta(seconds=1))

    with (
        patch.object(rmod.httpx, "AsyncClient", _wire({anth: (429, "")}, posts)),
        patch.object(rmod.asyncio, "sleep", _sleep_past_deadline),
    ):
        content, usage = await r.complete(
            [{"role": "user", "content": "hi"}], reasoning_retry=False
        )
    assert posts.count(anth) == 1  # the 429'd attempt, and no retry after the deadline
    assert content == "fallback answer"
    assert usage["provider"] == "groq"


def test_anthropic_usage_logs_as_metered_not_free(caplog):
    # Codex r2 F4 on #5568: the credit is finite, so a $0 line would hide its spend.
    import logging

    from shared.inference.router import InferenceRouter

    with caplog.at_level(logging.INFO):
        InferenceRouter.log_usage({"provider": "anthropic", "input_tokens": 5, "output_tokens": 2})
        InferenceRouter.log_usage({"provider": "groq", "input_tokens": 5, "output_tokens": 2})
    lines = [r.getMessage() for r in caplog.records if "LLM_USAGE" in r.getMessage()]
    assert "metered=1" in lines[0] and "anthropic" in lines[0]
    assert "est_cost=$0.00000" in lines[1]  # control: a free provider keeps the zero line
