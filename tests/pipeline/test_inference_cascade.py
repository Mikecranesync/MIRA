"""Offline tests for the cloud provider cascade (Groq → Cerebras → Together).

httpx.AsyncClient is replaced with a canned-response fake — no network, no keys
leave the process. Covers fallback order, exhaustion, enablement, and the PII
sanitization seam every pipeline turn flows through (security-boundaries rule).
"""

from __future__ import annotations

import httpx
import pytest

from shared.inference import router as router_mod
from shared.inference.router import InferenceRouter

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
TOGETHER_URL = "https://api.together.xyz/v1/chat/completions"


def _ok_body(content: str) -> dict:
    return {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


class FakeAsyncClient:
    """Drop-in for httpx.AsyncClient: replays canned responses per provider URL."""

    #: {url: (status_code, json_body)} — configured per test
    responses: dict = {}
    #: chronological record of (url, payload) posts
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        FakeAsyncClient.calls.append((url, json))
        status, body = FakeAsyncClient.responses[url]
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


@pytest.fixture
def cascade(monkeypatch, tmp_path):
    """A cloud-enabled router with all three providers keyed + fake transport."""
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-cerebras")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "test-together")
    # write_api_usage early-returns when the DB file doesn't exist
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "missing" / "mira.db"))
    monkeypatch.setattr(router_mod.httpx, "AsyncClient", FakeAsyncClient)
    FakeAsyncClient.responses = {}
    FakeAsyncClient.calls = []
    return InferenceRouter()


def _msgs(text: str) -> list[dict]:
    return [{"role": "user", "content": text}]


async def test_groq_answers_first_no_fallback(cascade):
    FakeAsyncClient.responses = {
        GROQ_URL: (200, _ok_body("groq says hi")),
        CEREBRAS_URL: (200, _ok_body("never reached")),
        TOGETHER_URL: (200, _ok_body("never reached")),
    }
    content, usage = await cascade.complete(_msgs("hello"))
    assert content == "groq says hi"
    assert usage["provider"] == "groq"
    assert [url for url, _ in FakeAsyncClient.calls] == [GROQ_URL]


async def test_fallback_groq_error_to_cerebras(cascade):
    FakeAsyncClient.responses = {
        GROQ_URL: (500, {"error": "boom"}),
        CEREBRAS_URL: (200, _ok_body("cerebras catches it")),
        TOGETHER_URL: (200, _ok_body("never reached")),
    }
    content, usage = await cascade.complete(_msgs("hello"))
    assert content == "cerebras catches it"
    assert usage["provider"] == "cerebras"
    assert [url for url, _ in FakeAsyncClient.calls] == [GROQ_URL, CEREBRAS_URL]


async def test_cascade_exhausted_returns_empty(cascade):
    """All providers 5xx → ("", last_error); order is Groq → Cerebras → Together."""
    FakeAsyncClient.responses = {
        GROQ_URL: (503, {"error": "down"}),
        CEREBRAS_URL: (503, {"error": "down"}),
        TOGETHER_URL: (503, {"error": "down"}),
    }
    content, _usage = await cascade.complete(_msgs("hello"))
    assert content == ""
    assert [url for url, _ in FakeAsyncClient.calls] == [GROQ_URL, CEREBRAS_URL, TOGETHER_URL]


async def test_local_backend_disables_cascade(monkeypatch):
    monkeypatch.setenv("INFERENCE_BACKEND", "local")
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    router = InferenceRouter()
    assert router.enabled is False
    assert await router.complete(_msgs("hello")) == ("", {})


async def test_pii_sanitized_before_leaving_process(cascade):
    """complete() strips IP/MAC/serial by default — providers never see raw PII."""
    FakeAsyncClient.responses = {GROQ_URL: (200, _ok_body("ok"))}
    await cascade.complete(
        _msgs("PLC at 192.168.4.28 mac 00:1B:44:11:3A:B7 serial SN: ABC12345 is down")
    )
    sent = FakeAsyncClient.calls[0][1]["messages"][0]["content"]
    assert "192.168.4.28" not in sent
    assert "00:1B:44:11:3A:B7" not in sent
    assert "[IP]" in sent and "[MAC]" in sent


def test_sanitize_context_strips_pii_from_text_blocks():
    messages = [
        {"role": "user", "content": "gateway 10.0.0.1"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "switch at 192.168.1.11"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,xx"}},
            ],
        },
    ]
    out = InferenceRouter.sanitize_context(messages)
    assert out[0]["content"] == "gateway [IP]"
    assert out[1]["content"][0]["text"] == "switch at [IP]"
    # non-text blocks pass through untouched
    assert out[1]["content"][1]["type"] == "image_url"
