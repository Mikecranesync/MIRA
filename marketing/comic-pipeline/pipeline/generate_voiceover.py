#!/usr/bin/env python3
"""
Generate voiceover MP3s via OpenAI TTS (tts-1-hd).

Output: output/audio/scene_{id}.mp3 + runtime manifest entry with the
actual audio duration measured by ffprobe (so stitch_video.py can size
each panel correctly).
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

import yaml
from openai import OpenAI

logger = logging.getLogger("comic.voiceover")


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _probe_duration(mp3_path: Path) -> float:
    """Return audio duration in seconds via ffprobe."""
    proc = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "json", str(mp3_path),
        ],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {mp3_path}: {proc.stderr[:400]}")
    data = json.loads(proc.stdout)
    return float(data["format"]["duration"])


def _synthesise(client: OpenAI, *, model: str, voice: str, text: str, out_path: Path) -> None:
    """Stream a TTS call to disk. tts-1-hd default format is MP3."""
    with client.audio.speech.with_streaming_response.create(
        model=model, voice=voice, input=text,
    ) as response:
        response.stream_to_file(out_path)


def generate_all(
    *,
    script_path: Path,
    config_path: Path,
    scene_filter: list[str] | None = None,
    progress_cb=None,
) -> dict[str, dict[str, Any]]:
    """Return {scene_id: {path, duration_seconds}} and write an updated manifest."""
    cfg = _load_yaml(config_path)
    script = _load_yaml(script_path)
    scenes = script["scenes"]

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set — run under `doppler run`.")
    client = OpenAI(api_key=api_key)

    work_root = Path(cfg["work_root"])
    audio_root = work_root / "audio"
    audio_root.mkdir(parents=True, exist_ok=True)
    manifest_path = work_root / "manifest.json"

    manifest: dict[str, Any] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())

    style = cfg["voiceover_style_instruction"].strip()
    results: dict[str, dict[str, Any]] = {}

    for scene_id, scene in scenes.items():
        if scene_filter and scene_id not in scene_filter:
            continue
        out_path = audio_root / f"scene_{scene_id}.mp3"
        needs_gen = not (out_path.exists() and out_path.stat().st_size > 0)
        if needs_gen:
            text = f"{style}\n\n{scene['voiceover_text'].strip()}"
            logger.info("[scene %s] voiceover: generating (%d chars)...", scene_id, len(text))
            _synthesise(
                client,
                model=cfg["tts_model"], voice=cfg["tts_voice"],
                text=text, out_path=out_path,
            )
        else:
            logger.info("[scene %s] voiceover: already exists, skipping", scene_id)

        duration = _probe_duration(out_path)
        results[scene_id] = {"path": str(out_path), "duration_seconds": duration}
        manifest.setdefault("audio", {})[scene_id] = results[scene_id]

        if progress_cb:
            progress_cb(scene_id, out_path, duration, skipped=not needs_gen)

    manifest_path.write_text(json.dumps(manifest, indent=2))
    return results
