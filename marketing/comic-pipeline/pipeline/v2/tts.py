"""
Per-beat TTS for comic-pipeline v2.

One OpenAI TTS call per narration beat. Cached on disk by content hash
so iteration on visuals doesn't re-pay for unchanged narration.

Model routing:
  gpt-4o-mini-tts — instruction-following; pass style_instruction via instructions=
  tts-1-hd        — legacy; ignores instructions; cadence set only by voice + speed
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI

logger = logging.getLogger("comic.v2.tts")

_INSTRUCTION_MODELS = {"gpt-4o-mini-tts", "gpt-4o-audio-preview"}


@dataclass
class BeatAudio:
    shot_id: int
    beat_index: int
    text: str
    path: Path
    duration: float


def _hash_for(text: str, voice: str, model: str, speed: float, instructions: str) -> str:
    h = hashlib.sha256()
    h.update(f"{model}|{voice}|{speed}|{instructions}|{text}".encode("utf-8"))
    return h.hexdigest()[:16]


def _probe_duration(audio: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "json", str(audio)],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return float(json.loads(proc.stdout)["format"]["duration"])


def synth_beat(
    client: OpenAI,
    *,
    text: str,
    voice: str,
    model: str,
    speed: float,
    cache_dir: Path,
    instructions: str = "",
) -> Path:
    """Synthesize one beat's MP3, hitting the on-disk cache if possible.

    When model is gpt-4o-mini-tts, the instructions= parameter is passed so
    the style context actually shapes delivery (cadence, tone, gravitas).
    Legacy tts-1-hd ignores instructions; style comes only from voice + speed.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = _hash_for(text, voice, model, speed, instructions)
    out_path = cache_dir / f"beat_{fingerprint}.mp3"
    if out_path.exists() and out_path.stat().st_size > 0:
        logger.info("[tts] cache hit %s (%s…)", out_path.name, text[:40])
        return out_path

    logger.info("[tts] synth model=%s (%d chars, speed=%.2f) %s…", model, len(text), speed, text[:60])

    kwargs: dict = dict(model=model, voice=voice, input=text, speed=speed)
    if instructions and model in _INSTRUCTION_MODELS:
        kwargs["instructions"] = instructions

    with client.audio.speech.with_streaming_response.create(**kwargs) as response:
        response.stream_to_file(out_path)
    return out_path


def synth_all_beats(
    storyboard: dict,
    *,
    cache_dir: Path,
) -> list[BeatAudio]:
    """Synthesize every beat in the storyboard, returning ordered BeatAudio list."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set — run under `doppler run`.")
    client = OpenAI(api_key=api_key)

    audio_cfg = storyboard["audio"]
    voice = audio_cfg["tts_voice"]
    model = audio_cfg["tts_model"]
    speed = float(audio_cfg["tts_speed"])
    instructions = audio_cfg.get("style_instruction", "").strip()

    if model in _INSTRUCTION_MODELS and instructions:
        logger.info("[tts] using instructions= parameter (model=%s)", model)
    elif instructions:
        logger.info("[tts] model=%s ignores style instructions; cadence from voice+speed only", model)

    beats: list[BeatAudio] = []
    for shot in storyboard["shots"]:
        for j, beat in enumerate(shot["beats"]):
            mp3 = synth_beat(
                client, text=beat["text"], voice=voice, model=model,
                speed=speed, cache_dir=cache_dir, instructions=instructions,
            )
            beats.append(BeatAudio(
                shot_id=shot["id"], beat_index=j, text=beat["text"],
                path=mp3, duration=_probe_duration(mp3),
            ))
    return beats
