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
audio actually sent, never from caller metadata such as Telegram's
``voice.duration`` (the sender controls that): the larger of the Ogg Opus
container's own duration (the final granule position; players must trim to it)
and a 6 kbps size bound, priced at OPENAI_TRANSCRIBE_USD_PER_MIN. Opus DTX can
encode silence far below 6 kbps, which is why the granule is read rather than
trusting size alone. Audio that is not well-formed Ogg Opus (every Telegram
voice note is) cannot be bounded and is refused with nothing sent. The default rate (0.006 USD/min) is OpenAI's
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
# A size floor on top of the container duration (see _bounded_seconds). Opus
# DTX can go lower during silence, so this alone is NOT a bound.
MIN_AUDIO_BITRATE_BPS = 6_000
_OPUS_GRANULE_RATE = 48_000  # Ogg Opus granule positions count 48 kHz samples


def _ogg_opus_seconds(data: bytes) -> float | None:
    """Playable seconds declared by an Ogg Opus stream's pages, or None when the
    bytes are not a well-formed Ogg Opus stream.

    Sums the highest granule position of each logical stream, so a chained file
    cannot hide audio behind a granule reset. Pre-skip is ignored, which only
    over-counts. CRCs are not checked: a corrupt page is still bounded by what it
    declares, and a decoder that rejects it sends nothing billable.
    """
    pos, n = 0, len(data)
    streams: dict[int, int] = {}
    saw_opus_head = False
    while pos < n:
        if data[pos : pos + 4] != b"OggS" or pos + 27 > n:
            return None
        granule = int.from_bytes(data[pos + 6 : pos + 14], "little", signed=True)
        serial = int.from_bytes(data[pos + 14 : pos + 18], "little")
        nseg = data[pos + 26]
        body_start = pos + 27 + nseg
        if body_start > n:
            return None
        body_end = body_start + sum(data[pos + 27 : body_start])
        if body_end > n:
            return None
        if data[body_start : body_start + 8] == b"OpusHead":
            saw_opus_head = True
        if granule < -1:
            return None
        if granule >= 0:
            streams[serial] = max(streams.get(serial, 0), granule)
        pos = body_end
    if not saw_opus_head or not streams:
        return None
    return sum(streams.values()) / _OPUS_GRANULE_RATE


def _bounded_seconds(data: bytes) -> float | None:
    """Upper bound on the audio's length, or None when it cannot be bounded."""
    declared = _ogg_opus_seconds(data)
    if declared is None:
        return None
    return max(declared, len(data) * 8 / MIN_AUDIO_BITRATE_BPS)


_TIMEOUT = 30  # seconds — longer messages take a moment


def _usd_per_min() -> float:
    raw = os.getenv("OPENAI_TRANSCRIBE_USD_PER_MIN") or ""
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_USD_PER_MIN
    return value if math.isfinite(value) and value >= 0 else DEFAULT_USD_PER_MIN


def _worst_case_output_tokens(budget, seconds: float) -> int:
    """The transcription's worst-case dollars for ``seconds`` of audio, expressed
    in the budget's output tokens so the shared reserve/settle API can hold and
    book it."""
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

    audio = bytes(audio_bytes)
    try:
        seconds = _bounded_seconds(audio)
        if seconds is None:
            logger.warning(
                "Voice transcription refused: not a well-formed Ogg Opus stream (%d bytes)",
                len(audio),
            )
            return None
        budget = get_openai_run_budget()
        worst_tokens = _worst_case_output_tokens(budget, seconds)
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
                files={"file": (filename, audio, "audio/ogg")},
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
