"""OpenRouter is the backup tier behind OpenAI (owner decision 2026-10-14) — offline contract.

Groq and Together died on unpaid bills (Groq 400 overdue, Together 402) and
Cerebras is archived, so OpenAI was the only live provider. OpenRouter is one
prepaid account in front of many hosts. These pin:

* the ORDER — second, right after OpenAI, and key-gated so an unset
  OPENROUTER_API_KEY leaves the cascade exactly as before;
* the MODELS — non-reasoning Llama 3.3 70B for text and Qwen3-VL for images, so
  image turns have a live provider besides OpenAI;
* the NO-CLAUDE GUARD — OpenRouter can serve Anthropic models (also through
  `~anthropic/...` aliases and the `openrouter/...` auto-routers). Anthropic is
  banned from this cascade (PR #610), so such a configured model drops the
  provider instead of silently serving Claude;
* the DATA POLICY — every request asks OpenRouter to route only to hosts that
  neither train on nor retain prompts (verified live 2026-10-14: both default
  models have such hosts).

Run: cd mira-bots && python -m pytest tests/test_openrouter_backup.py -q
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from shared.inference.router import InferenceRouter, _Provider, _build_providers, _request_payload

KEYS = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TOGETHERAI_API_KEY",
)
MODELS = (
    "OPENAI_MODEL",
    "OPENAI_VISION_MODEL",
    "OPENAI_TIMEOUT",
    "OPENROUTER_MODEL",
    "OPENROUTER_VISION_MODEL",
    "OPENROUTER_TIMEOUT",
)
MSGS = [{"role": "user", "content": "hi"}]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in KEYS + MODELS:
        monkeypatch.delenv(var, raising=False)


def _openrouter(providers: list[_Provider]) -> _Provider:
    (p,) = [p for p in providers if p.name == "openrouter"]
    return p


def test_openrouter_is_second_right_after_openai(monkeypatch):
    for var in KEYS:
        monkeypatch.setenv(var, "k")
    names = [p.name for p in _build_providers()]
    assert names == ["openai", "openrouter", "groq", "cerebras", "together"]


def test_openrouter_leads_when_openai_has_no_key(monkeypatch):
    for var in ("OPENROUTER_API_KEY", "GROQ_API_KEY"):
        monkeypatch.setenv(var, "k")
    assert [p.name for p in _build_providers()] == ["openrouter", "groq"]


def test_unset_openrouter_key_leaves_the_cascade_exactly_as_before(monkeypatch):
    for var in ("OPENAI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY"):
        monkeypatch.setenv(var, "k")
    names = [p.name for p in _build_providers()]
    assert names == ["openai", "groq", "cerebras", "together"]


def test_openrouter_provider_shape(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    p = _openrouter(_build_providers())
    assert p.api_url == "https://openrouter.ai/api/v1/chat/completions"
    assert p.model == "meta-llama/llama-3.3-70b-instruct"
    assert p.vision_model == "qwen/qwen3-vl-30b-a3b-instruct"
    # Non-reasoning models: the compat dialect (max_tokens + temperature).
    assert p.request_style == "openai_compat"
    assert p.cap_key == "max_tokens"
    assert p.timeout == 60.0


def test_empty_string_env_does_not_win(monkeypatch):
    # compose maps ${VAR:-} to "" in-container; the code defaults must hold.
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    for var in ("OPENROUTER_MODEL", "OPENROUTER_VISION_MODEL", "OPENROUTER_TIMEOUT"):
        monkeypatch.setenv(var, "")
    p = _openrouter(_build_providers())
    assert p.model == "meta-llama/llama-3.3-70b-instruct"
    assert p.vision_model == "qwen/qwen3-vl-30b-a3b-instruct"
    assert p.timeout == 60.0


def test_env_can_choose_other_allowed_models(monkeypatch):
    # Control for the guard below: a non-Anthropic model is honoured.
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setenv("OPENROUTER_VISION_MODEL", "mistralai/mistral-small-2603")
    p = _openrouter(_build_providers())
    assert p.model == "openai/gpt-oss-120b"
    assert p.vision_model == "mistralai/mistral-small-2603"


@pytest.mark.parametrize(
    "var,model",
    [
        ("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5"),
        ("OPENROUTER_MODEL", "Anthropic/Claude-Opus-4.1"),
        ("OPENROUTER_MODEL", "~anthropic/claude-sonnet-latest"),
        ("OPENROUTER_MODEL", "openrouter/auto"),
        ("OPENROUTER_MODEL", "openrouter/free"),
        ("OPENROUTER_VISION_MODEL", "anthropic/claude-haiku-4.5"),
        ("OPENROUTER_VISION_MODEL", "openrouter/auto-beta"),
        # Presets (Codex r1 F1 on #4436): a preset picks its model remotely and
        # can be changed to Claude without any local change, so no preset
        # reference is accepted, alone or combined with a model id.
        ("OPENROUTER_MODEL", "@preset/backup"),
        ("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct@preset/backup"),
        ("OPENROUTER_VISION_MODEL", "@preset/vision"),
        ("OPENROUTER_VISION_MODEL", "qwen/qwen3-vl-30b-a3b-instruct@preset/vision"),
    ],
)
def test_a_claude_or_auto_routed_model_drops_the_provider(monkeypatch, caplog, var, model):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv(var, model)
    with caplog.at_level("ERROR", logger="mira-gsd"):
        names = [p.name for p in _build_providers()]
    assert names == ["groq"]
    assert any("OPENROUTER_MODEL_REFUSED" in r.getMessage() for r in caplog.records)


def test_request_payload_asks_for_no_training_and_no_retention():
    p = _Provider(
        "openrouter",
        "u",
        "k",
        "meta-llama/llama-3.3-70b-instruct",
        extra_body={"provider": {"data_collection": "deny", "zdr": True}},
    )
    body = _request_payload(p, p.model, MSGS, 321)
    assert body == {
        "model": "meta-llama/llama-3.3-70b-instruct",
        "max_tokens": 321,
        "messages": MSGS,
        "temperature": 0.1,
        "provider": {"data_collection": "deny", "zdr": True},
    }


def test_built_openrouter_provider_carries_the_data_policy(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    p = _openrouter(_build_providers())
    body = _request_payload(p, p.vision_model, MSGS, 50)
    assert body["provider"] == {"data_collection": "deny", "zdr": True}
    assert body["model"] == "qwen/qwen3-vl-30b-a3b-instruct"


def test_other_providers_send_no_routing_block(monkeypatch):
    # Control: the policy is OpenRouter's request field; Groq/Together bodies
    # stay byte-identical to before.
    for var in ("GROQ_API_KEY", "TOGETHERAI_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setenv(var, "k")
    for p in _build_providers():
        assert "provider" not in _request_payload(p, p.model, MSGS, 10)


def test_usage_log_marks_openrouter_metered(caplog):
    """OpenRouter is pay-per-token; its usage line must not read as free."""
    from shared.inference.router import InferenceRouter

    with caplog.at_level("INFO", logger="mira-gsd"):
        InferenceRouter.log_usage(
            {"provider": "openrouter", "input_tokens": 10, "output_tokens": 5}
        )
    line = next(r.getMessage() for r in caplog.records if "LLM_USAGE" in r.getMessage())
    assert "provider=openrouter" in line
    assert "metered=1" in line
    assert "$0.00000" not in line


# ---------------------------------------------------------------------------
# Through the REAL InferenceRouter.complete() with a fake HTTP client (no
# network): OpenAI fails, OpenRouter serves — and the body it receives is the
# one the live probe proved works.
# ---------------------------------------------------------------------------


def _ok(content: str):
    fake = MagicMock()
    fake.raise_for_status = MagicMock()
    fake.json = MagicMock(
        return_value={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
        }
    )
    return fake


def _http_error(status: int):
    fake = MagicMock()
    req = httpx.Request("POST", "https://example.invalid")
    fake.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            "boom", request=req, response=httpx.Response(status, request=req)
        )
    )
    return fake


class _FakeAsyncClient:
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


def _router(monkeypatch) -> InferenceRouter:
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    r = InferenceRouter()
    r.write_api_usage = MagicMock()
    assert [p.name for p in r.providers] == ["openai", "openrouter"]
    return r


async def test_openrouter_answers_when_openai_fails(monkeypatch):
    r = _router(monkeypatch)
    _FakeAsyncClient.queue = [_http_error(500), _ok("OPENROUTER ANSWER")]
    _FakeAsyncClient.posts = []
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        content, usage = await r.complete(MSGS, max_tokens=50)
    assert content == "OPENROUTER ANSWER"
    assert usage.get("provider") == "openrouter"
    first, second = _FakeAsyncClient.posts
    assert first["url"].startswith("https://api.openai.com/")
    assert second["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert second["json"]["model"] == "meta-llama/llama-3.3-70b-instruct"
    assert second["json"]["provider"] == {"data_collection": "deny", "zdr": True}


async def test_an_image_turn_reaches_openrouter_vision(monkeypatch):
    # OpenAI carries no vision model unless OPENAI_VISION_MODEL opts it in, so
    # an image turn skips it and OpenRouter's vision model serves.
    r = _router(monkeypatch)
    image_msgs = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "read this nameplate"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            ],
        }
    ]
    _FakeAsyncClient.queue = [_ok("Siemens 1LA7")]
    _FakeAsyncClient.posts = []
    with patch("shared.inference.router.httpx.AsyncClient", _FakeAsyncClient):
        content, _usage = await r.complete(image_msgs, max_tokens=50)
    assert content == "Siemens 1LA7"
    (only,) = _FakeAsyncClient.posts
    assert only["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert only["json"]["model"] == "qwen/qwen3-vl-30b-a3b-instruct"
