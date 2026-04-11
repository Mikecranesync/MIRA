"""Tests for multi-provider inference router cascade."""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-bots"))

from shared.inference.router import (
    InferenceRouter,
    _Provider,
    _ProviderSkip,
    _build_providers,
    _convert_images_for_claude,
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
        assert providers[0].format == "openai"

    def test_all_three_providers_in_order(self):
        env = {
            "GROQ_API_KEY": "gsk_test",
            "CEREBRAS_API_KEY": "csk_test",
            "ANTHROPIC_API_KEY": "sk-ant-test",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert len(providers) == 3
        assert [p.name for p in providers] == ["groq", "cerebras", "claude"]

    def test_cerebras_and_claude_no_groq(self):
        env = {
            "CEREBRAS_API_KEY": "csk_test",
            "ANTHROPIC_API_KEY": "sk-ant-test",
        }
        with patch.dict(os.environ, env, clear=True):
            providers = _build_providers()
        assert len(providers) == 2
        assert [p.name for p in providers] == ["cerebras", "claude"]

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

    def test_enabled_with_claude_backend_legacy(self):
        env = {"INFERENCE_BACKEND": "claude", "ANTHROPIC_API_KEY": "sk-ant-test"}
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()
        assert router.enabled is True

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


class TestConvertImagesForClaude:
    def test_converts_image_url_to_base64_source(self):
        msgs = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/jpeg;base64,AAAA"},
                    },
                ],
            }
        ]
        result = _convert_images_for_claude(msgs)
        block = result[0]["content"][0]
        assert block["type"] == "image"
        assert block["source"]["type"] == "base64"
        assert block["source"]["media_type"] == "image/jpeg"
        assert block["source"]["data"] == "AAAA"

    def test_passthrough_text_blocks(self):
        msgs = [{"role": "user", "content": "plain text"}]
        result = _convert_images_for_claude(msgs)
        assert result[0]["content"] == "plain text"


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
        content, usage = await router.complete([{"role": "user", "content": "hi"}])
        assert content == ""

    async def test_skips_openai_providers_for_image_requests(self):
        env = {
            "INFERENCE_BACKEND": "cloud",
            "GROQ_API_KEY": "gsk_test",
            "ANTHROPIC_API_KEY": "sk-ant-test",
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

        with patch.object(router, "_call_anthropic") as mock_claude:
            mock_claude.return_value = ("claude response", {"input_tokens": 10, "output_tokens": 5, "provider": "claude"})
            content, usage = await router.complete(messages)

        assert content == "claude response"
        mock_claude.assert_called_once()

    async def test_cascade_falls_through_on_skip(self):
        env = {
            "INFERENCE_BACKEND": "cloud",
            "GROQ_API_KEY": "gsk_test",
            "CEREBRAS_API_KEY": "csk_test",
        }
        with patch.dict(os.environ, env, clear=True):
            router = InferenceRouter()

        with (
            patch.object(router, "_call_openai_compat") as mock_openai,
        ):
            mock_openai.side_effect = [
                _ProviderSkip("groq", "rate_limit"),
                ("cerebras response", {"input_tokens": 10, "output_tokens": 5, "provider": "cerebras"}),
            ]
            content, usage = await router.complete([{"role": "user", "content": "test"}])

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
            content, usage = await router.complete([{"role": "user", "content": "test"}])

        assert content == ""
