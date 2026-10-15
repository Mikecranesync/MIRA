"""OpenAI speech-to-text for incoming Telegram voice messages.

Uses OpenAI's /v1/audio/transcriptions endpoint (default model
gpt-4o-mini-transcribe, override with OPENAI_TRANSCRIBE_MODEL). This was Groq
Whisper until Groq was deprecated (owner decision 2026-10-14, #4438); a
leftover GROQ_API_KEY no longer enables anything here.

Falls back to None on any failure — never raises to the caller.

Spend: transcription is metered on the same OpenAI account as the cascade, so
every call goes through the per-run OpenAI spend stop (#4355,
``shared/inference/run_budget.py``). The worst case is held BEFORE the request
and the request is never sent once the cap is reached. It is sized from the
bytes actually sent, never from caller metadata such as Telegram's
``voice.duration`` (the sender controls that): at the 6 kbps Opus floor the
file size is a guaranteed upper bound on the audio length, priced at
OPENAI_TRANSCRIBE_USD_PER_MIN. The default rate (0.006 USD/min) is OpenAI's
estimate for whisper-1 and gpt-4o-transcribe, twice the gpt-4o-mini-transcribe
default model's 0.003, so a model override cannot slip under the stop.

Typical flow:
    ogg_bytes = await context.bot.get_file(voice.file_id) → download_as_bytearray()
    text = await transcribe_voice(ogg_bytes)
    # then route text through normal handle_message()
"""

from __future__ import annotations

import logging
import math
import os

import httpx
from shared.inference.run_budget import BudgetExceeded, get_openai_run_budget

logger = logging.getLogger("mira-bot")

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"
DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
DEFAULT_USD_PER_MIN = 0.006
# Opus, the codec Telegram voice notes use, does not encode below 6 kbps, so
# bytes * 8 / 6000 seconds is an upper bound on how long the audio can be.
MIN_AUDIO_BITRATE_BPS = 6_000
_TIMEOUT = 30  # seconds — longer messages take a moment


def _usd_per_min() -> float:
    raw = os.getenv("OPENAI_TRANSCRIBE_USD_PER_MIN") or ""
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_USD_PER_MIN
    return value if math.isfinite(value) and value >= 0 else DEFAULT_USD_PER_MIN


def _worst_case_output_tokens(budget, audio_len: int) -> int:
    """The transcription's worst-case dollars, from the size bound on the audio,
    expressed in the budget's output tokens so the shared reserve/settle API can
    hold and book it."""
    seconds = audio_len * 8 / MIN_AUDIO_BITRATE_BPS
    worst_usd = (seconds / 60.0) * _usd_per_min()
    usd_per_token = budget.estimate_usd(0, 1_000_000) / 1_000_000
    return math.ceil(worst_usd / usd_per_token) if usd_per_token > 0 else 0


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
        Transcribed text string, or None if transcription failed or was refused.
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        logger.warning("OPENAI_API_KEY not set — voice transcription disabled")
        return None

    try:
        budget = get_openai_run_budget()
        worst_tokens = _worst_case_output_tokens(budget, len(audio_bytes))
        hold = budget.reserve(0, worst_tokens)
    except BudgetExceeded as exc:
        logger.warning("OPENAI_BUDGET_EXHAUSTED voice transcription refused: %s", exc)
        return None
    except Exception as exc:
        logger.error("Voice transcription budget check failed, nothing sent: %s", exc)
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
            # Book the size-bounded worst case: a runaway stop over-counts, never under.
            hold.settle(0, worst_tokens)
            result = resp.json()
            text = result.get("text", "").strip()
            if text:
                logger.info("Voice transcribed (%d chars): %r", len(text), text[:80])
            return text or None
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code < 500:
            # A 4xx is a rejection without billable work.
            hold.release()
        else:
            # A 5xx can follow billable work upstream: book the worst case.
            hold.settle_worst_case()
        logger.error(
            "Voice transcription HTTP %d (model=%s): %s",
            exc.response.status_code,
            model,
            exc.response.text[:200],
        )
        return None
    except Exception as exc:
        # The request may have been accepted and billed: book the worst case.
        hold.settle_worst_case()
        logger.error("Voice transcription failed: %s", exc)
        return None
