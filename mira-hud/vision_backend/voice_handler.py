"""
voice_handler.py — Microphone recording + Whisper transcription

Phase 1: Mac built-in microphone via sounddevice
Phase 2 (Halo): uncomment HALO lines

Swap point: record_audio() — transcribe() is identical in both phases.
"""

import asyncio
import os
import tempfile
import warnings
from typing import Optional

import numpy as np
import scipy.io.wavfile as wavfile
import sounddevice as sd

warnings.filterwarnings("ignore")

# HALO: from frame_sdk import Frame

SAMPLE_RATE = 16000
RECORD_SECONDS = 5


class VoiceHandler:
    def __init__(self):
        self._model = None  # lazy-loaded on first transcription

    def _load_whisper(self):
        if self._model is None:
            import whisper  # noqa: PLC0415
            print("[voice] loading Whisper base model...")
            self._model = whisper.load_model("base")
            print("[voice] Whisper ready")
        return self._model

    # ── Recording ──────────────────────────────────────────────

    def record_audio(self, seconds: int = RECORD_SECONDS) -> str:
        """
        Record from Mac microphone for `seconds` seconds.
        Returns path to a temporary WAV file.

        HALO swap: replace this method body with:
            glasses = await get_glasses()
            raw = await glasses.microphone.stream(sample_rate=16000, seconds=seconds)
            return _save_wav(raw, SAMPLE_RATE)
        """
        # HALO: glasses = await get_glasses()
        # HALO: raw = await glasses.microphone.stream(sample_rate=16000, seconds=seconds)
        # HALO: return _save_wav(raw, SAMPLE_RATE)

        print(f"[voice] recording {seconds}s...")
        recording = sd.rec(
            int(seconds * SAMPLE_RATE),
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
        )
        sd.wait()

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        wavfile.write(tmp.name, SAMPLE_RATE, recording)
        tmp.close()
        return tmp.name

    # ── Transcription ──────────────────────────────────────────

    def transcribe(self, wav_path: str) -> str:
        """Transcribe WAV file using Whisper. Deletes file after reading."""
        model = self._load_whisper()
        result = model.transcribe(wav_path, language="en")
        transcript = result["text"].strip()
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        print(f"[voice] transcript: \"{transcript}\"")
        return transcript

    # ── Async interface ────────────────────────────────────────

    async def capture_query(self, seconds: int = RECORD_SECONDS) -> str:
        """
        Record + transcribe in a thread pool (non-blocking).
        Returns transcript string.
        """
        loop = asyncio.get_event_loop()
        wav_path = await loop.run_in_executor(None, self.record_audio, seconds)
        transcript = await loop.run_in_executor(None, self.transcribe, wav_path)
        return transcript


# ── HALO helper (unused in Phase 1) ────────────────────────────

def _save_wav(raw_bytes: bytes, sample_rate: int) -> str:
    """Save raw PCM bytes to a temp WAV file. Used by Halo path."""
    audio = np.frombuffer(raw_bytes, dtype="int16")
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    wavfile.write(tmp.name, sample_rate, audio)
    tmp.close()
    return tmp.name
