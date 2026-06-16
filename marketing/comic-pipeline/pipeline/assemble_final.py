#!/usr/bin/env python3
"""
Concatenate per-scene MP4s and mix in a low-volume ambient factory hum.

Flow:
  1. Build a concat file listing scene_1.mp4 … scene_N.mp4.
  2. Concat-copy (stream copy, no re-encode) into a temp joined.mp4.
  3. Generate an ambience track (sine 100 Hz + noise) sized to total duration
     at ambient_volume_db.
  4. Mix ambience + joined audio with amix (voiceover is weighted louder).
  5. Mux joined video + mixed audio with faststart for YouTube streaming.

Writes final MP4 to {output_root}/mira_explainer_v1.mp4 and copies a pointer
entry into {spend_log} for cross-pipeline spend tracking.
"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("comic.final")


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _probe_duration(mp4_path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "json", str(mp4_path)],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {mp4_path}: {proc.stderr[:400]}")
    return float(json.loads(proc.stdout)["format"]["duration"])


def _run(cmd: list[str], *, timeout: int = 900) -> None:
    logger.debug("ffmpeg cmd: %s", " ".join(cmd[:6]) + " …")
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1500:]
        raise RuntimeError(f"ffmpeg failed ({cmd[0]}): {tail}")


def assemble_final(
    *,
    config_path: Path,
    ordered_scene_ids: list[str],
) -> Path:
    """Produce the final YouTube-ready MP4. Returns its path."""
    cfg = _load_yaml(config_path)
    work_root = Path(cfg["work_root"])
    scenes_root = work_root / "scenes"

    output_root = Path(cfg["output_root"]).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    final_path = output_root / "mira_explainer_v1.mp4"

    # Pre-flight: every scene clip must exist.
    scene_paths = []
    for sid in ordered_scene_ids:
        p = scenes_root / f"scene_{sid}.mp4"
        if not p.exists():
            raise RuntimeError(f"missing scene clip: {p}")
        scene_paths.append(p)

    ambient_db = float(cfg["ambient_volume_db"])
    vbr = str(cfg["video_bitrate"])
    abr = str(cfg["audio_bitrate"])

    with tempfile.TemporaryDirectory(prefix="comic-final-") as td:
        td_path = Path(td)
        # Step 1 — concat list.
        list_file = td_path / "concat.txt"
        list_file.write_text(
            "\n".join(f"file '{p.resolve()}'" for p in scene_paths)
        )

        # Step 2 — concat with stream copy (fast, lossless join).
        joined = td_path / "joined.mp4"
        _run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c", "copy",
            str(joined),
        ])

        total_dur = _probe_duration(joined)

        # Step 3 — ambience track: low sine + faint noise, shaped to duration.
        ambience = td_path / "ambience.wav"
        _run([
            "ffmpeg", "-y",
            "-f", "lavfi", "-i",
                f"sine=frequency=100:duration={total_dur:.2f}",
            "-f", "lavfi", "-i",
                f"anoisesrc=color=brown:duration={total_dur:.2f}:amplitude=0.2",
            "-filter_complex",
                f"[0:a][1:a]amix=inputs=2:duration=shortest:weights=0.6 0.4,"
                f"volume={ambient_db}dB[aout]",
            "-map", "[aout]",
            "-ac", "2", "-ar", "48000",
            str(ambience),
        ])

        # Step 4 — mix ambience + voiceover (voiceover louder than hum).
        mixed_audio = td_path / "mixed.m4a"
        _run([
            "ffmpeg", "-y",
            "-i", str(joined),
            "-i", str(ambience),
            "-filter_complex",
                "[0:a]volume=1.0[va];[1:a]volume=1.0[aa];"
                "[va][aa]amix=inputs=2:duration=longest:weights=1.0 0.35[mix]",
            "-map", "[mix]",
            "-c:a", "aac", "-b:a", abr,
            str(mixed_audio),
        ])

        # Step 5 — mux original video with the new mixed audio, faststart for YT.
        _run([
            "ffmpeg", "-y",
            "-i", str(joined),
            "-i", str(mixed_audio),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-b:v", vbr, "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", abr,
            "-movflags", "+faststart",
            str(final_path),
        ])

    # Append a spend-log pointer for cross-pipeline observability.
    spend_log = Path(cfg["spend_log"]).expanduser()
    try:
        spend_log.parent.mkdir(parents=True, exist_ok=True)
        entries: list[Any] = []
        if spend_log.exists():
            entries = json.loads(spend_log.read_text())
        entries.append({
            "pipeline": "comic",
            "output": str(final_path),
            "scenes": ordered_scene_ids,
            "duration_seconds": total_dur,
        })
        spend_log.write_text(json.dumps(entries, indent=2))
    except Exception as e:
        logger.warning("spend log update skipped: %s", e)

    return final_path
