"""Unit tests for voice_transcription.py — OpenAI speech-to-text (#4438).

Groq is deprecated (owner decision 2026-10-14), so transcription goes to
OpenAI. All tests are offline (mock httpx). No real API calls.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_transcription_response(text: str, status_code: int = 200):
    """Build a mock httpx response with the transcription JSON shape."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = {"text": text}
    resp.text = f'{{"text": "{text}"}}'
    return resp


def _mock_http_error(status_code: int, body: str = "error"):
    """Build a mock httpx.HTTPStatusError."""
    import httpx

    request = MagicMock()
    response = MagicMock()
    response.status_code = status_code
    response.text = body
    return httpx.HTTPStatusError(message=f"HTTP {status_code}", request=request, response=response)


# ---------------------------------------------------------------------------
# Test: transcribe_voice
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transcribe_returns_text_on_success():
    """Happy path — the provider returns transcription text."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_transcription_response("VFD-07 is showing fault F005, what should I check?")

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(b"fake_ogg_bytes")

    assert result == "VFD-07 is showing fault F005, what should I check?"


@pytest.mark.asyncio
async def test_transcribe_returns_none_without_api_key():
    """No OPENAI_API_KEY → returns None without calling API."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    with patch.dict("os.environ", {}, clear=True):
        # Ensure OPENAI_API_KEY is absent
        import os

        os.environ.pop("OPENAI_API_KEY", None)
        result = await transcribe_voice(b"fake_ogg_bytes")

    assert result is None


@pytest.mark.asyncio
async def test_transcribe_returns_none_on_http_error():
    """HTTP error from the provider → returns None (never raises)."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(side_effect=_mock_http_error(429, "rate limit"))
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(b"fake_ogg_bytes")

    assert result is None


@pytest.mark.asyncio
async def test_transcribe_returns_none_on_network_error():
    """Network exception → returns None (never raises)."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(side_effect=ConnectionError("timeout"))
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(b"fake_ogg_bytes")

    assert result is None


@pytest.mark.asyncio
async def test_transcribe_returns_none_on_empty_response():
    """Provider returns an empty text field → returns None."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_transcription_response("")

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(b"fake_ogg_bytes")

    assert result is None


@pytest.mark.asyncio
async def test_transcribe_accepts_bytearray():
    """Accepts bytearray as well as bytes."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_transcription_response("yes create the work order")

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(bytearray(b"fake_ogg_bytes"))

    assert result == "yes create the work order"


@pytest.mark.asyncio
async def test_transcribe_language_hint_passed_when_set():
    """Language hint is included in the request data when provided."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_transcription_response("yes")
    captured_data = {}

    async def _capture_post(url, **kwargs):
        captured_data.update(kwargs)
        return mock_resp

    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(side_effect=_capture_post)
            mock_client_cls.return_value = mock_client

            await transcribe_voice(b"test_audio", language="en")

    data = captured_data.get("data", {})
    assert data.get("language") == "en"


# ---------------------------------------------------------------------------
# #4438: OpenAI is the provider, Groq is never called
# ---------------------------------------------------------------------------


def _capturing_client(mock_client_cls, response, calls: list):
    async def _post(url, **kwargs):
        calls.append((url, kwargs))
        return response

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client_cls.return_value = mock_client
    return mock_client


@pytest.mark.asyncio
async def test_transcribe_posts_to_openai_with_default_model():
    """The request goes to OpenAI's transcription endpoint with the OpenAI key
    and the default model, as an ogg upload."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    calls: list = []
    with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test"}, clear=True):
        with patch("httpx.AsyncClient") as mock_client_cls:
            _capturing_client(
                mock_client_cls, _mock_transcription_response("check the fuse"), calls
            )
            result = await transcribe_voice(b"ogg")

    assert result == "check the fuse"
    assert len(calls) == 1
    url, kwargs = calls[0]
    assert url == "https://api.openai.com/v1/audio/transcriptions"
    assert kwargs["headers"] == {"Authorization": "Bearer sk-test"}
    assert kwargs["data"]["model"] == "gpt-4o-mini-transcribe"
    assert kwargs["files"]["file"] == ("voice.ogg", b"ogg", "audio/ogg")


@pytest.mark.asyncio
async def test_transcribe_never_calls_groq_even_when_its_key_is_set():
    """With both keys present, the only request is to OpenAI, carrying the
    OpenAI key — never api.groq.com, never the Groq key."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    calls: list = []
    env = {"OPENAI_API_KEY": "sk-test", "GROQ_API_KEY": "gsk_test"}
    with patch.dict("os.environ", env, clear=True):
        with patch("httpx.AsyncClient") as mock_client_cls:
            _capturing_client(mock_client_cls, _mock_transcription_response("ok"), calls)
            await transcribe_voice(b"ogg")

    assert [url for url, _ in calls] == ["https://api.openai.com/v1/audio/transcriptions"]
    assert all("gsk_test" not in str(kwargs) for _, kwargs in calls)


@pytest.mark.asyncio
async def test_transcribe_with_only_the_groq_key_sends_nothing():
    """A leftover GROQ_API_KEY alone does not enable transcription: no request,
    None returned. Control for the test above: Groq is not a fallback."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    calls: list = []
    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}, clear=True):
        with patch("httpx.AsyncClient") as mock_client_cls:
            _capturing_client(mock_client_cls, _mock_transcription_response("ok"), calls)
            result = await transcribe_voice(b"ogg")

    assert result is None
    assert calls == []


@pytest.mark.asyncio
async def test_transcribe_model_override_and_empty_value_fallback():
    """OPENAI_TRANSCRIBE_MODEL overrides the model; an empty value (what compose
    delivers for an unset ${VAR:-}) falls back to the default."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    for value, expected in (("whisper-1", "whisper-1"), ("", "gpt-4o-mini-transcribe")):
        calls: list = []
        env = {"OPENAI_API_KEY": "sk-test", "OPENAI_TRANSCRIBE_MODEL": value}
        with patch.dict("os.environ", env, clear=True):
            with patch("httpx.AsyncClient") as mock_client_cls:
                _capturing_client(mock_client_cls, _mock_transcription_response("ok"), calls)
                await transcribe_voice(b"ogg")
        assert calls[0][1]["data"]["model"] == expected, value
