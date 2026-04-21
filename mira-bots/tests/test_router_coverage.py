"""Coverage tests for shared.inference.router — sanitization, cascade, helpers."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.inference.router import InferenceRouter, _is_gibberish

# ---------------------------------------------------------------------------
# sanitize_context (static method, no mocking needed)
# ---------------------------------------------------------------------------


class TestSanitizeContext:
    def test_strips_ipv4(self):
        messages = [{"role": "user", "content": "Server at 192.168.1.100 is down"}]
        result = InferenceRouter.sanitize_context(messages)
        assert "[IP]" in result[0]["content"]
        assert "192.168.1.100" not in result[0]["content"]

    def test_strips_mac_address(self):
        messages = [{"role": "user", "content": "MAC is AA:BB:CC:DD:EE:FF"}]
        result = InferenceRouter.sanitize_context(messages)
        assert "[MAC]" in result[0]["content"]

    def test_strips_serial_number(self):
        messages = [{"role": "user", "content": "Serial: SN ABC123-DEF"}]
        result = InferenceRouter.sanitize_context(messages)
        assert "[SN]" in result[0]["content"]

    def test_multipart_content_sanitized(self):
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "IP is 10.0.0.1"},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
                ],
            }
        ]
        result = InferenceRouter.sanitize_context(messages)
        text_block = result[0]["content"][0]
        assert "[IP]" in text_block["text"]
        assert "10.0.0.1" not in text_block["text"]
        # Image block preserved
        assert result[0]["content"][1]["type"] == "image_url"

    def test_non_string_content_passthrough(self):
        messages = [{"role": "system", "content": 42}]
        result = InferenceRouter.sanitize_context(messages)
        assert result[0]["content"] == 42

    def test_multiple_pii_types(self):
        messages = [{"role": "user", "content": "IP 10.0.0.1 MAC AA:BB:CC:DD:EE:FF SN XYZ-12345"}]
        result = InferenceRouter.sanitize_context(messages)
        content = result[0]["content"]
        assert "[IP]" in content
        assert "[MAC]" in content
        assert "[SN]" in content

    def test_empty_messages(self):
        assert InferenceRouter.sanitize_context([]) == []


# ---------------------------------------------------------------------------
# _is_gibberish helper
# ---------------------------------------------------------------------------


class TestIsGibberish:
    def test_normal_text_not_gibberish(self):
        assert _is_gibberish("The motor is rated for 5HP at 460V.") is False

    def test_repeated_words_is_gibberish(self):
        # Needs >20 chars and >10 words to trigger repetition check
        assert _is_gibberish("the the the the the the the the the the the the") is True

    def test_short_text_not_gibberish(self):
        assert _is_gibberish("ok") is False

    def test_empty_not_gibberish(self):
        assert _is_gibberish("") is False


# ---------------------------------------------------------------------------
# InferenceRouter.complete — cascade behavior
# ---------------------------------------------------------------------------


class TestRouterComplete:
    @pytest.fixture
    def router_with_providers(self):
        """Router with mocked providers for cascade testing."""
        with patch.dict(
            "os.environ",
            {
                "INFERENCE_BACKEND": "cloud",
                "ANTHROPIC_API_KEY": "sk-ant-test",
            },
        ):
            with patch("shared.inference.router._build_providers") as mock_build:
                mock_provider = MagicMock()
                mock_provider.name = "claude"
                mock_provider.format = "anthropic"
                mock_provider.vision_model = ""
                mock_provider.enabled = True
                mock_build.return_value = [mock_provider]
                router = InferenceRouter()
                return router

    async def test_disabled_router_returns_empty(self):
        with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
            with patch("shared.inference.router._build_providers", return_value=[]):
                router = InferenceRouter()
                content, usage = await router.complete([{"role": "user", "content": "test"}])
                assert content == ""
                assert usage == {}

    async def test_complete_returns_first_success(self, router_with_providers):
        router = router_with_providers
        router._call_provider = AsyncMock(
            return_value=("diagnosis result", {"provider": "claude", "input_tokens": 50})
        )
        content, usage = await router.complete([{"role": "user", "content": "VFD fault F-201"}])
        assert content == "diagnosis result"
        assert usage["provider"] == "claude"
