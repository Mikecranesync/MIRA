"""Groq Whisper transcription for incoming Telegram voice messages.

Uses Groq's /openai/v1/audio/transcriptions endpoint (whisper-large-v3-turbo).
Falls back to a safe error string on any failure — never raises to the caller.

Typical flow:
    ogg_bytes = await context.bot.get_file(voice.file_id) → download_as_bytearray()
    text = await transcribe_voice(ogg_bytes)
    # then route text through normal handle_message()
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("mira-bot")

GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")
_TIMEOUT = 30  # seconds — Whisper can take a moment on longer messages


async def transcribe_voice(
    audio_bytes: bytes | bytearray,
    language: str | None = None,
    filename: str = "voice.ogg",
) -> str | None:
    """Transcribe audio bytes using Groq Whisper.

    Args:
        audio_bytes: Raw audio data (Telegram sends .ogg/Opus).
        language: ISO 639-1 code hint (e.g. 'en'). Leave None for auto-detect.
        filename: Filename passed to the multipart form (determines MIME detection).

    Returns:
        Transcribed text string, or None if transcription failed.
    """
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        logger.warning("GROQ_API_KEY not set — voice transcription disabled")
        return None

    data: dict[str, str] = {"model": GROQ_WHISPER_MODEL}
    if language:
        data["language"] = language

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                GROQ_TRANSCRIPTION_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, bytes(audio_bytes), "audio/ogg")},
                data=data,
            )
            resp.raise_for_status()
            result = resp.json()
            text = result.get("text", "").strip()
            if text:
                logger.info("Voice transcribed (%d chars): %r", len(text), text[:80])
            return text or None
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Groq Whisper HTTP %d: %s",
            exc.response.status_code,
            exc.response.text[:200],
        )
        return None
    except Exception as exc:
        logger.error("Voice transcription failed: %s", exc)
        return None
