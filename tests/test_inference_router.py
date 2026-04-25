"""Tests for multi-provider inference router cascade."""

import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-bots"))

from shared.inference.router import (
    InferenceRouter,
    _ProviderSkip,
    _build_providers,
    _has_image,
)


class TestBuildProviders:
    def test_no_keys_returns_empty(self):
        with patch.dict(os.environ, {}, clear=True):
            providers = _build_providers()
        assert providers == []

    def test_groq_only(self):
        env = {"GROQ_API_KEY": "gsk_test123"}
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert len(providers) == 1
        assert providers[0].name == "groq"

    def test_all_three_providers_in_order(self):
        env = {
            "GROQ_API_KEY": "gsk_test",
            "CEREBRAS_API_KEY": "csk_test",
            "GEMINI_API_KEY": "gem_test",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert len(providers) == 3
        assert [p.name for p in providers] == ["groq", "cerebras", "gemini"]

    def test_cerebras_and_gemini_no_groq(self):
        env = {
            "CEREBRAS_API_KEY": "csk_test",
            "GEMINI_API_KEY": "gem_test",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert len(providers) == 2
        assert [p.name for p in providers] == ["cerebras", "gemini"]

    def test_anthropic_key_is_ignored(self):
        """ANTHROPIC_API_KEY must NOT add a Claude provider — Anthropic was removed."""
        env = {
            "GROQ_API_KEY": "gsk_test",
            "ANTHROPIC_API_KEY": "sk-ant-should-be-ignored",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert [p.name for p in providers] == ["groq"]

    def test_custom_model_names(self):
        env = {
            "GROQ_API_KEY": "gsk_test",
            "GROQ_MODEL": "llama-3.1-8b-instant",
            "CEREBRAS_API_KEY": "csk_test",
            "CEREBRAS_MODEL": "llama-3.1-70b",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert providers[0].model == "llama-3.1-8b-instant"
        assert providers[1].model == "llama-3.1-70b"


class TestRouterEnabled:
    def test_enabled_with_cloud_backend_and_keys(self):
        env = {"INFERENCE_BACKEND": "cloud", "GROQ_API_KEY": "gsk_test"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        assert router.enabled is True

    def test_legacy_claude_backend_no_longer_enables(self):
        """INFERENCE_BACKEND=claude was a legacy alias; Anthropic removed → disabled."""
        env = {"INFERENCE_BACKEND": "claude", "GROQ_API_KEY": "gsk_test"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        assert router.enabled is False

    def test_disabled_with_local_backend(self):
        env = {"INFERENCE_BACKEND": "local", "GROQ_API_KEY": "gsk_test"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        assert router.enabled is False

    def test_disabled_with_no_keys(self):
        env = {"INFERENCE_BACKEND": "cloud"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        assert router.enabled is False


class TestSanitizeContext:
    def test_strips_ipv4(self):
        msgs = [{"role": "user", "content": "Server at 192.168.1.50 is down"}]
        result = InferenceRouter.sanitize_context(msgs)
        assert "[IP]" in result[0]["content"]
        assert "192.168.1.50" not in result[0]["content"]

    def test_strips_mac(self):
        msgs = [{"role": "user", "content": "MAC is AA:BB:CC:DD:EE:FF"}]
        result = InferenceRouter.sanitize_context(msgs)
        assert "[MAC]" in result[0]["content"]

    def test_strips_serial(self):
        msgs = [{"role": "user", "content": "S/N ABC123DEF"}]
        result = InferenceRouter.sanitize_context(msgs)
        assert "[SN]" in result[0]["content"]

    def test_handles_multipart_content(self):
        msgs = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "IP is 10.0.0.1"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                ],
            }
        ]
        result = InferenceRouter.sanitize_context(msgs)
        text_block = result[0]["content"][0]
        assert "[IP]" in text_block["text"]


class TestHasImage:
    def test_text_only(self):
        msgs = [{"role": "user", "content": "hello"}]
        assert _has_image(msgs) is False

    def test_with_image_url(self):
        msgs = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
                    {"type": "text", "text": "what is this"},
                ],
            }
        ]
        assert _has_image(msgs) is True


class TestProviderSkip:
    def test_skip_contains_info(self):
        skip = _ProviderSkip("groq", "rate_limit")
        assert skip.provider == "groq"
        assert skip.reason == "rate_limit"
        assert "groq" in str(skip)


@pytest.mark.asyncio
class TestCascadeComplete:
    async def test_returns_empty_when_disabled(self):
        env = {"INFERENCE_BACKEND": "local"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        content, _usage = await router.complete([{"role": "user", "content": "hi"}])
        assert content == ""

    async def test_image_request_uses_provider_with_vision_model(self):
        """Groq has a vision model; Cerebras does not — image request should hit Groq."""
        env = {
            "INFERENCE_BACKEND": "cloud",
            "GROQ_API_KEY": "gsk_test",
            "CEREBRAS_API_KEY": "csk_test",
        }
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
                    {"type": "text", "text": "what is this"},
                ],
            }
        ]

        with patch.object(router, "_call_openai_compat") as mock_call:
            mock_call.return_value = (
                "groq vision response",
                {"input_tokens": 10, "output_tokens": 5, "provider": "groq"},
            )
            content, _ = await router.complete(messages)

        assert content == "groq vision response"
        # Cerebras (no vision_model) must be skipped — only one call total
        assert mock_call.call_count == 1
        assert mock_call.call_args[0][0].name == "groq"

    async def test_cascade_falls_through_on_skip(self):
        env = {
            "INFERENCE_BACKEND": "cloud",
            "GROQ_API_KEY": "gsk_test",
            "CEREBRAS_API_KEY": "csk_test",
        }
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()

        with patch.object(router, "_call_openai_compat") as mock_openai:
            mock_openai.side_effect = [
                _ProviderSkip("groq", "rate_limit"),
                ("cerebras response", {"input_tokens": 10, "output_tokens": 5, "provider": "cerebras"}),
            ]
            content, _ = await router.complete([{"role": "user", "content": "test"}])

        assert content == "cerebras response"
        assert mock_openai.call_count == 2

    async def test_all_fail_returns_empty(self):
        env = {
            "INFERENCE_BACKEND": "cloud",
            "GROQ_API_KEY": "gsk_test",
        }
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()

        with patch.object(router, "_call_openai_compat") as mock_openai:
            mock_openai.side_effect = _ProviderSkip("groq", "timeout")
            content, _ = await router.complete([{"role": "user", "content": "test"}])

        assert content == ""
