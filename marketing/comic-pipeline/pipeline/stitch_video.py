#!/usr/bin/env python3
"""
Stitch per-scene MP4s from panel PNGs + scene voiceover MP3.

Thin wrapper over pipeline.multi_image_assembler.assemble_multi_image_video.
The assembler auto-divides audio duration across panels, applies a Ken Burns
zoom, and crossfades each xfade transition cumulatively — we don't need to
re-implement any of that here.

Note: per-panel `duration_seconds` values in scene_scripts.yaml are ignored
for now; the TTS audio is the source of truth for scene length. If we later
want fixed per-panel pacing independent of voiceover, add a new function to
multi_image_assembler rather than duplicating filter logic.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from .multi_image_assembler import assemble_multi_image_video

logger = logging.getLogger("comic.stitch")


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def stitch_all(
    *,
    script_path: Path,
    config_path: Path,
    scene_filter: list[str] | None = None,
    progress_cb=None,
) -> dict[str, Path]:
    """Produce one MP4 per scene. Returns {scene_id: mp4_path}."""
    cfg = _load_yaml(config_path)
    script = _load_yaml(script_path)
    scenes = script["scenes"]

    work_root = Path(cfg["work_root"])
    panels_root = work_root / "panels"
    audio_root = work_root / "audio"
    scenes_root = work_root / "scenes"
    scenes_root.mkdir(parents=True, exist_ok=True)

    width = int(cfg["video_width"])
    height = int(cfg["video_height"])
    transition = float(cfg["transition_duration"])
    zoom = float(cfg["ken_burns_zoom_amount"])

    results: dict[str, Path] = {}
    manifest_path = work_root / "manifest.json"
    manifest: dict[str, Any] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())

    for scene_id, scene in scenes.items():
        if scene_filter and scene_id not in scene_filter:
            continue

        panel_dir = panels_root / f"scene_{scene_id}"
        panel_paths = sorted(
            panel_dir.glob("panel_*.png"),
            key=lambda p: int(p.stem.split("_")[1]),
        )
        if len(panel_paths) < 2:
            raise RuntimeError(
                f"scene {scene_id}: need ≥2 panels, got {len(panel_paths)} in {panel_dir}"
            )

        audio_path = audio_root / f"scene_{scene_id}.mp3"
        if not audio_path.exists():
            raise RuntimeError(f"scene {scene_id}: missing voiceover at {audio_path}")

        out_path = scenes_root / f"scene_{scene_id}.mp4"
        if out_path.exists() and out_path.stat().st_size > 0:
            logger.info("[scene %s] clip: already exists, skipping", scene_id)
            results[scene_id] = out_path
            if progress_cb:
                progress_cb(scene_id, out_path, skipped=True)
            continue

        logger.info(
            "[scene %s] stitching %d panels with audio %s -> %s",
            scene_id, len(panel_paths), audio_path.name, out_path.name,
        )
        result = assemble_multi_image_video(
            images=[str(p) for p in panel_paths],
            audio_path=str(audio_path),
            output_path=str(out_path),
            width=width,
            height=height,
            transition_duration=transition,
            zoom_amount=zoom,
        )
        if not result["success"]:
            raise RuntimeError(f"scene {scene_id} ffmpeg failed: {result['error']}")

        results[scene_id] = out_path
        manifest.setdefault("scenes", {})[scene_id] = {
            "path": str(out_path),
            "panel_count": len(panel_paths),
            "audio_duration": result["metadata"].get("audio_duration"),
            "per_image_duration": result["metadata"].get("per_image_duration"),
        }
        if progress_cb:
            progress_cb(scene_id, out_path, skipped=False)

    manifest_path.write_text(json.dumps(manifest, indent=2))
    return results
