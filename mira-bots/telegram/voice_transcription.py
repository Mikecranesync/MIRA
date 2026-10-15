"""OpenAI speech-to-text for incoming Telegram voice messages.

Uses OpenAI's /v1/audio/transcriptions endpoint (default model
gpt-4o-mini-transcribe, override with OPENAI_TRANSCRIBE_MODEL). This was Groq
Whisper until Groq was deprecated (owner decision 2026-10-14, #4438); a
leftover GROQ_API_KEY no longer enables anything here.

Falls back to None on any failure — never raises to the caller.

The call does not pass through InferenceRouter, which is text and vision only,
so the per-run OpenAI spend stop (#4355) does not cover it. Cost is per minute
of audio.

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

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"
DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
_TIMEOUT = 30  # seconds — longer messages take a moment


async def transcribe_voice(
    audio_bytes: bytes | bytearray,
    language: str | None = None,
    filename: str = "voice.ogg",
) -> str | None:
    """Transcribe audio bytes using OpenAI speech-to-text.

    Args:
        audio_bytes: Raw audio data (Telegram sends .ogg/Opus).
        language: ISO 639-1 code hint (e.g. 'en'). Leave None for auto-detect.
        filename: Filename passed to the multipart form (determines MIME detection).

    Returns:
        Transcribed text string, or None if transcription failed.
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        logger.warning("OPENAI_API_KEY not set — voice transcription disabled")
        return None

    # `or` form: compose delivers an unset ${VAR:-} as an empty string.
    model = os.getenv("OPENAI_TRANSCRIBE_MODEL") or DEFAULT_TRANSCRIBE_MODEL
    data: dict[str, str] = {"model": model}
    if language:
        data["language"] = language

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                OPENAI_TRANSCRIPTION_URL,
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
            "Voice transcription HTTP %d (model=%s): %s",
            exc.response.status_code,
            model,
            exc.response.text[:200],
        )
        return None
    except Exception as exc:
        logger.error("Voice transcription failed: %s", exc)
        return None
