"""MIRA TTS — Kokoro ONNX local text-to-speech, returns OGG OPUS bytes."""

import io
import logging
import os
import re

logger = logging.getLogger("mira-tts")

_KOKORO = None
_KOKORO_LOADED = False

_MARKDOWN_RE = re.compile(r"[*_`#\->]")

KOKORO_MODEL = os.getenv("KOKORO_MODEL_PATH", "/app/kokoro-v1.0.onnx")
KOKORO_VOICES = os.getenv("KOKORO_VOICES_PATH", "/app/voices-v1.0.bin")
KOKORO_VOICE = os.getenv("KOKORO_VOICE", "af_heart")
KOKORO_LANG = os.getenv("KOKORO_LANG", "en-us")
MAX_WORDS = int(os.getenv("TTS_MAX_WORDS", "150"))

TRUNCATION_SUFFIX = " See text for full details."


def _get_kokoro():
    """Lazy-load Kokoro once at first use."""
    global _KOKORO, _KOKORO_LOADED
    if _KOKORO_LOADED:
        return _KOKORO
    try:
        from kokoro_onnx import Kokoro

        _KOKORO = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
        logger.info("Kokoro TTS loaded: %s / %s", KOKORO_MODEL, KOKORO_VOICES)
    except Exception as e:
        logger.error("Kokoro TTS failed to load: %s", e)
        _KOKORO = None
    _KOKORO_LOADED = True
    return _KOKORO


def _clean_text(text: str) -> str:
    """Strip markdown and truncate to MAX_WORDS words."""
    text = _MARKDOWN_RE.sub("", text).strip()
    words = text.split()
    if len(words) > MAX_WORDS:
        text = " ".join(words[:MAX_WORDS]) + TRUNCATION_SUFFIX
    return text


async def text_to_ogg(text: str) -> bytes | None:
    """Convert text to OGG OPUS bytes suitable for Telegram send_voice.

    Returns None on any error — callers must not raise.
    """
    try:
        import soundfile as sf
        from pydub import AudioSegment

        kokoro = _get_kokoro()
        if kokoro is None:
            return None

        clean = _clean_text(text)
        if not clean:
            return None

        samples, sample_rate = kokoro.create(clean, voice=KOKORO_VOICE, speed=1.0, lang=KOKORO_LANG)

        wav_buf = io.BytesIO()
        sf.write(wav_buf, samples, sample_rate, format="WAV")
        wav_buf.seek(0)

        audio = AudioSegment.from_wav(wav_buf)
        ogg_buf = io.BytesIO()
        audio.export(ogg_buf, format="ogg", codec="libopus")
        return ogg_buf.getvalue()

    except Exception as e:
        logger.error("TTS error: %s", e)
        return None
