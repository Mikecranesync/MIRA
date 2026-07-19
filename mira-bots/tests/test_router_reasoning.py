"""Reasoning-model handling in shared.inference.router (v3.176.5).

Tower OP round 4 (2026-07-19): with TOGETHERAI_VISION_MODEL=moonshotai/Kimi-K2.6
the production cascade produced 0/12 usable replies — Kimi burned the entire
max_tokens budget on chain-of-thought at BOTH call sites (1024 vision describe,
2000 theory) and returned HTTP 200 with empty visible content, which the router
treated as EMPTY_RESPONSE and fell through to the deterministic fallback.

These tests pin the fix:
- ``_strip_reasoning``: closed <think> blocks are removed; an unterminated
  <think> (cap-hit signature) yields no visible content.
- ``_call_openai_compat``: an empty-after-strip reply WITH burn evidence (cap
  hit, reasoning_content, or think markup) is retried exactly once with
  ``LLM_REASONING_RETRY_MAX_TOKENS`` headroom; a genuinely empty reply is not.
- Or-form env parse: compose ``${LLM_REASONING_RETRY_MAX_TOKENS:-}`` delivers
  an empty string in-container and must fall back to the default.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import MagicMock, patch

import pytest
from shared.inference.router import (
    InferenceRouter,
    _reasoning_retry_max_tokens,
    _strip_reasoning,
)

# ---------------------------------------------------------------------------
# _strip_reasoning
# ---------------------------------------------------------------------------


class TestStripReasoning:
    def test_closed_think_block_removed(self):
        assert _strip_reasoning("<think>step 1... step 2...</think>The answer is K5.1.") == (
            "The answer is K5.1."
        )

    def test_multiple_think_blocks_removed(self):
        text = "<think>a</think>Part one. <think>b</think>Part two."
        assert _strip_reasoning(text) == "Part one. Part two."

    def test_unterminated_think_yields_empty(self):
        # Cap-hit mid-reasoning: the reply is one giant open think block.
        assert _strip_reasoning("<think>hunting for pawl switches on sheet 6...") == ""

    def test_text_before_unterminated_think_kept(self):
        assert _strip_reasoning("Partial answer.<think>more reasoning that hit the cap") == (
            "Partial answer."
        )

    def test_plain_text_unchanged(self):
        assert _strip_reasoning("FF = Error: Runtime error occurred (X1.1).") == (
            "FF = Error: Runtime error occurred (X1.1)."
        )

    def test_empty_and_none_safe(self):
        assert _strip_reasoning("") == ""
        assert _strip_reasoning(None) == ""  # type: ignore[arg-type]

    def test_case_insensitive_marker(self):
        assert _strip_reasoning("<THINK>x</THINK>ok") == "ok"


# ---------------------------------------------------------------------------
# or-form env parse (compose empty-string trap)
# ---------------------------------------------------------------------------


class TestRetryCapKnob:
    def test_default_when_unset(self):
        with patch.dict("os.environ", {}, clear=True):
            assert _reasoning_retry_max_tokens() == 8192

    def test_default_when_empty_string(self):
        # docker compose ${LLM_REASONING_RETRY_MAX_TOKENS:-} → "" in-container.
        with patch.dict("os.environ", {"LLM_REASONING_RETRY_MAX_TOKENS": ""}):
            assert _reasoning_retry_max_tokens() == 8192

    def test_env_override(self):
        with patch.dict("os.environ", {"LLM_REASONING_RETRY_MAX_TOKENS": "4096"}):
            assert _reasoning_retry_max_tokens() == 4096

    def test_zero_disables(self):
        with patch.dict("os.environ", {"LLM_REASONING_RETRY_MAX_TOKENS": "0"}):
            assert _reasoning_retry_max_tokens() == 0


# ---------------------------------------------------------------------------
# _call_openai_compat burn-retry behavior (mocked httpx)
# ---------------------------------------------------------------------------


def _response(content, prompt_tokens=100, completion_tokens=50, extra_message=None):
    """Build a fake httpx response with an OpenAI-compatible chat payload."""
    message = {"content": content}
    if extra_message:
        message.update(extra_message)
    fake = MagicMock()
    fake.raise_for_status = MagicMock()
    fake.json = MagicMock(
        return_value={
            "choices": [{"message": message}],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }
    )
    return fake


class _FakeAsyncClient:
    """Async context manager whose .post pops queued responses."""

    queue: list = []
    posts: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        _FakeAsyncClient.posts.append({"url": url, "json": dict(json)})
        return _FakeAsyncClient.queue.pop(0)


@pytest.fixture
def router():
    with patch.dict(
        "os.environ",
        {"INFERENCE_BACKEND": "cloud", "TOGETHERAI_API_KEY": "tog_test"},
        clear=True,
    ):
        with patch("shared.inference.router._build_providers", return_value=[]):
            r = InferenceRouter()
    r.write_api_usage = MagicMock()
    return r


@pytest.fixture
def provider():
    p = MagicMock()
    p.name = "together"
    p.model = "moonshotai/Kimi-K2.6"
    p.vision_model = "moonshotai/Kimi-K2.6"
    p.api_url = "https://api.together.xyz/v1/chat/completions"
    p.api_key = "tog_test"
    p.timeout = 90
    return p


def _queue(*responses):
    _FakeAsyncClient.queue = list(responses)
    _FakeAsyncClient.posts = []


MESSAGES = [{"role": "user", "content": "what does the FF LED mean?"}]


class TestReasoningBurnRetry:
    async def test_cap_burn_retries_once_with_headroom(self, router, provider):
        # First call: cap hit (completion == max_tokens), empty content.
        # Second call: real answer under the boosted cap.
        _queue(
            _response("", completion_tokens=1024),
            _response("FF = Error: Runtime error occurred.", completion_tokens=60),
        )
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, usage = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=True
            )
        assert content == "FF = Error: Runtime error occurred."
        assert len(_FakeAsyncClient.posts) == 2
        assert _FakeAsyncClient.posts[0]["json"]["max_tokens"] == 1024
        assert _FakeAsyncClient.posts[1]["json"]["max_tokens"] == 8192

    async def test_unterminated_think_burn_retries(self, router, provider):
        _queue(
            _response("<think>searching the sheet for pawls", completion_tokens=900),
            _response(
                "<think>done</think>Not on this sheet — see doc 53-075-101-4.", completion_tokens=80
            ),
        )
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, _ = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=True
            )
        assert content == "Not on this sheet — see doc 53-075-101-4."
        assert len(_FakeAsyncClient.posts) == 2

    async def test_reasoning_content_field_burn_retries(self, router, provider):
        _queue(
            _response(
                "",
                completion_tokens=500,
                extra_message={"reasoning_content": "long chain of thought"},
            ),
            _response("K5.1-K5.4 switch the pretension magnets.", completion_tokens=40),
        )
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, _ = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=True
            )
        assert content == "K5.1-K5.4 switch the pretension magnets."
        assert len(_FakeAsyncClient.posts) == 2

    async def test_genuinely_empty_reply_not_retried(self, router, provider):
        # No cap hit, no reasoning markers — a plain empty reply cascades on.
        _queue(_response("", completion_tokens=3))
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, _ = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=True
            )
        assert content == ""
        assert len(_FakeAsyncClient.posts) == 1

    async def test_burn_retry_still_empty_returns_empty(self, router, provider):
        # Both attempts burn: returns empty so the cascade moves on (no loop).
        _queue(
            _response("", completion_tokens=1024),
            _response("", completion_tokens=8192),
        )
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, _ = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=True
            )
        assert content == ""
        assert len(_FakeAsyncClient.posts) == 2

    async def test_retry_disabled_by_zero_knob(self, router, provider):
        _queue(_response("", completion_tokens=1024))
        with patch.dict("os.environ", {"LLM_REASONING_RETRY_MAX_TOKENS": "0"}):
            with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
                content, _ = await router._call_openai_compat(
                    provider, MESSAGES, 1024, "s1", has_image=True
                )
        assert content == ""
        assert len(_FakeAsyncClient.posts) == 1

    async def test_success_reply_think_stripped(self, router, provider):
        # LFM2.5-style reply: closed think block + answer, no retry needed.
        _queue(_response("<think>reasoning</think>The relay is K4.1.", completion_tokens=200))
        with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
            content, _ = await router._call_openai_compat(
                provider, MESSAGES, 1024, "s1", has_image=False
            )
        assert content == "The relay is K4.1."
        assert len(_FakeAsyncClient.posts) == 1
