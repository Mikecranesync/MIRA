"""
Per-beat TTS for comic-pipeline v2.

One OpenAI tts-1-hd call per narration beat. Cached on disk by content hash
so iteration on visuals doesn't re-pay for unchanged narration.
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


@dataclass
class BeatAudio:
    shot_id: int
    beat_index: int
    text: str
    path: Path
    duration: float


def _hash_for(text: str, voice: str, model: str, speed: float) -> str:
    h = hashlib.sha256()
    h.update(f"{model}|{voice}|{speed}|{text}".encode("utf-8"))
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
) -> Path:
    """Synthesize one beat's MP3, hitting the on-disk cache if possible."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = _hash_for(text, voice, model, speed)
    out_path = cache_dir / f"beat_{fingerprint}.mp3"
    if out_path.exists() and out_path.stat().st_size > 0:
        logger.info("[tts] cache hit %s (%s…)", out_path.name, text[:40])
        return out_path

    logger.info("[tts] synth (%d chars, speed=%.2f) %s…", len(text), speed, text[:60])
    with client.audio.speech.with_streaming_response.create(
        model=model, voice=voice, input=text, speed=speed,
    ) as response:
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
    # Note: tts-1-hd does NOT follow inline style instructions — the model
    # reads whatever you put in `input` aloud, including a "style preamble".
    # Documentary cadence comes from voice=onyx + speed=0.9, not from prompt text.
    # (For instruction-following TTS, swap model to "gpt-4o-mini-tts" + use
    # the `instructions` parameter.)

    beats: list[BeatAudio] = []
    for shot in storyboard["shots"]:
        for j, beat in enumerate(shot["beats"]):
            mp3 = synth_beat(
                client, text=beat["text"], voice=voice, model=model,
                speed=speed, cache_dir=cache_dir,
            )
            beats.append(BeatAudio(
                shot_id=shot["id"], beat_index=j, text=beat["text"],
                path=mp3, duration=_probe_duration(mp3),
            ))
    return beats
