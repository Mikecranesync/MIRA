"""Coverage tests for shared.inference.router — sanitization, cascade, helpers."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.inference.router import InferenceRouter, _build_providers, _is_gibberish

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
                "GROQ_API_KEY": "gsk_test",
            },
        ):
            with patch("shared.inference.router._build_providers") as mock_build:
                mock_provider = MagicMock()
                mock_provider.name = "groq"
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
        router._call_openai_compat = AsyncMock(
            return_value=("diagnosis result", {"provider": "groq", "input_tokens": 50})
        )
        content, usage = await router.complete([{"role": "user", "content": "VFD fault F-201"}])
        assert content == "diagnosis result"
        assert usage["provider"] == "groq"

    async def test_complete_sanitizes_by_default(self, router_with_providers):
        """complete() must scrub IPs/MACs/serials before reaching the provider —
        opt-in sanitization is the wrong default; one forgetful caller leaks PII."""
        router = router_with_providers
        captured: dict = {}

        async def fake_call_provider(provider, messages, *_args, **_kwargs):
            captured["messages"] = messages
            return ("ok", {"provider": "groq"})

        router._call_openai_compat = fake_call_provider
        await router.complete(
            [{"role": "user", "content": "PLC at 10.0.0.5 (MAC AA:BB:CC:DD:EE:FF) S/N ABC123"}]
        )
        sent = captured["messages"][0]["content"]
        assert "10.0.0.5" not in sent
        assert "AA:BB:CC:DD:EE:FF" not in sent
        assert "ABC123" not in sent
        assert "[IP]" in sent and "[MAC]" in sent and "[SN]" in sent

    async def test_complete_sanitize_false_passes_raw(self, router_with_providers):
        """sanitize=False is the bypass for offline evals that test the sanitizer itself."""
        router = router_with_providers
        captured: dict = {}

        async def fake_call_provider(provider, messages, *_args, **_kwargs):
            captured["messages"] = messages
            return ("ok", {"provider": "groq"})

        router._call_openai_compat = fake_call_provider
        await router.complete(
            [{"role": "user", "content": "raw 10.0.0.5"}],
            sanitize=False,
        )
        sent = captured["messages"][0]["content"]
        assert "10.0.0.5" in sent
        assert "[IP]" not in sent


# ---------------------------------------------------------------------------
# Vision-model wiring — the 2026-07-18 Groq vision deprecation fix
# ---------------------------------------------------------------------------


class TestVisionModelConfig:
    """Pin the cascade's vision wiring after Groq delisted every vision model.

    Groq must default to NO vision model (a dead default id = a guaranteed 404
    + latency tax on every photo turn before the cascade recovers); Together
    must default to the one model this account can actually reach serverless.
    The empty-string cases pin the compose ``${VAR:-}`` trap: enumerated env
    blocks deliver "" in-container, so a plain getenv default would silently
    disable vision on staging.
    """

    _ENV_CLOUD = {
        "INFERENCE_BACKEND": "cloud",
        "GROQ_API_KEY": "gsk_test",
        "CEREBRAS_API_KEY": "csk_test",
        "TOGETHERAI_API_KEY": "tk_test",
    }

    def test_groq_vision_defaults_empty(self):
        with patch.dict("os.environ", self._ENV_CLOUD, clear=True):
            groq = next(p for p in _build_providers() if p.name == "groq")
            assert groq.vision_model == ""

    def test_groq_vision_empty_env_stays_empty(self):
        with patch.dict("os.environ", {**self._ENV_CLOUD, "GROQ_VISION_MODEL": ""}, clear=True):
            groq = next(p for p in _build_providers() if p.name == "groq")
            assert groq.vision_model == ""

    def test_groq_vision_env_reenables(self):
        with patch.dict(
            "os.environ",
            {**self._ENV_CLOUD, "GROQ_VISION_MODEL": "some/future-vision"},
            clear=True,
        ):
            groq = next(p for p in _build_providers() if p.name == "groq")
            assert groq.vision_model == "some/future-vision"

    def test_together_vision_defaults_to_gemma(self):
        with patch.dict("os.environ", self._ENV_CLOUD, clear=True):
            together = next(p for p in _build_providers() if p.name == "together")
            assert together.vision_model == "google/gemma-3n-E4B-it"

    def test_together_vision_empty_env_gets_default(self):
        """Compose maps ``${TOGETHERAI_VISION_MODEL:-}`` → "" in-container; the
        ``or`` form must absorb it or staging vision dies silently."""
        with patch.dict(
            "os.environ", {**self._ENV_CLOUD, "TOGETHERAI_VISION_MODEL": ""}, clear=True
        ):
            together = next(p for p in _build_providers() if p.name == "together")
            assert together.vision_model == "google/gemma-3n-E4B-it"

    def test_together_vision_env_override(self):
        with patch.dict(
            "os.environ",
            {**self._ENV_CLOUD, "TOGETHERAI_VISION_MODEL": "vendor/other-vl"},
            clear=True,
        ):
            together = next(p for p in _build_providers() if p.name == "together")
            assert together.vision_model == "vendor/other-vl"

    async def test_image_request_skips_groq_lands_on_together(self):
        """Cascade shape with defaults: a photo turn must skip Groq and
        Cerebras (no vision model) and be served by Together."""
        with patch.dict("os.environ", self._ENV_CLOUD, clear=True):
            router = InferenceRouter()
            called: list[str] = []

            async def fake_call(provider, messages, *_args, **_kwargs):
                called.append(provider.name)
                return ("a schematic", {"provider": provider.name, "model": provider.name})

            router._call_openai_compat = fake_call
            content, _usage = await router.complete(
                [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "classify this"},
                            {
                                "type": "image_url",
                                "image_url": {"url": "data:image/png;base64,x"},
                            },
                        ],
                    }
                ]
            )
            assert content == "a schematic"
            assert called == ["together"]
