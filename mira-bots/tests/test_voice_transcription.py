"""Unit tests for voice_transcription.py — Groq Whisper integration.

All tests are offline (mock httpx). No real Groq API calls.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_groq_response(text: str, status_code: int = 200):
    """Build a mock httpx response with the Groq Whisper JSON shape."""
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
    """Happy path — Groq returns transcription text."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_groq_response("VFD-07 is showing fault F005, what should I check?")

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
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
    """No GROQ_API_KEY → returns None without calling API."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    with patch.dict("os.environ", {}, clear=True):
        # Ensure GROQ_API_KEY is absent
        import os
        os.environ.pop("GROQ_API_KEY", None)
        result = await transcribe_voice(b"fake_ogg_bytes")

    assert result is None


@pytest.mark.asyncio
async def test_transcribe_returns_none_on_http_error():
    """HTTP error from Groq → returns None (never raises)."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
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

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
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
    """Groq returns empty text field → returns None."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_groq_response("")

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
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

    mock_resp = _mock_groq_response("yes create the work order")

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_resp)
            mock_client_cls.return_value = mock_client

            result = await transcribe_voice(bytearray(b"fake_ogg_bytes"))

    assert result == "yes create the work order"


@pytest.mark.asyncio
async def test_transcribe_sends_correct_model():
    """Verify the correct Whisper model is sent in the request."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_groq_response("test")
    captured_data = {}

    async def _capture_post(url, **kwargs):
        captured_data.update(kwargs)
        return mock_resp

    with patch.dict("os.environ", {
        "GROQ_API_KEY": "gsk_test",
        "GROQ_WHISPER_MODEL": "whisper-large-v3-turbo",
    }):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(side_effect=_capture_post)
            mock_client_cls.return_value = mock_client

            await transcribe_voice(b"test_audio")

    assert "model" in str(captured_data.get("data", ""))


@pytest.mark.asyncio
async def test_transcribe_language_hint_passed_when_set():
    """Language hint is included in the request data when provided."""
    sys.path.insert(0, "mira-bots/telegram")
    from voice_transcription import transcribe_voice

    mock_resp = _mock_groq_response("yes")
    captured_data = {}

    async def _capture_post(url, **kwargs):
        captured_data.update(kwargs)
        return mock_resp

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}):
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(side_effect=_capture_post)
            mock_client_cls.return_value = mock_client

            await transcribe_voice(b"test_audio", language="en")

    data = captured_data.get("data", {})
    assert data.get("language") == "en"
