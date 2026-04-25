"""
Video rendering for comic-pipeline v2.

Three stages:
  1. canvas_pre_render — letterbox each source image to 1920x1080 PNG (cached)
  2. render_beat_clip   — one MP4 per beat with piecewise zoompan animation
                          (camera holds at focal during narration; pans to next
                          focal during the pause). Last beat of each shot has
                          focal_out=None and just holds.
  3. concat_all_beats   — concat every beat clip end-to-end with no xfade
                          (hard cuts between shots). Camera continuity within
                          a shot, hard cut between shots — the audio breath
                          (pause_between_shots silence) carries the transition.
"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("comic.v2.render")


@dataclass
class BeatClip:
    shot_id: int
    beat_index: int
    path: Path
    narration_seconds: float
    pause_seconds: float
    total_seconds: float


def _run(cmd: list[str], *, timeout: int = 600) -> None:
    """Run ffmpeg/ffprobe; raise with the stderr tail on failure."""
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1500:]
        raise RuntimeError(f"{cmd[0]} failed (exit {proc.returncode}):\n{tail}")


def canvas_pre_render(
    *,
    source_images: dict[int, Path],
    out_dir: Path,
    width: int = 1920,
    height: int = 1080,
) -> dict[int, Path]:
    """Letterbox each source image to a fixed-size canvas PNG. Cached on disk.

    Returns {shot_id: canvas_png_path}.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    canvases: dict[int, Path] = {}
    for shot_id, src in source_images.items():
        canvas = out_dir / f"shot_{shot_id}_canvas.png"
        if canvas.exists() and canvas.stat().st_size > 0:
            canvases[shot_id] = canvas
            continue
        logger.info("[canvas] pre-render shot %s -> %s", shot_id, canvas.name)
        _run([
            "ffmpeg", "-y", "-i", str(src),
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"setsar=1",
            str(canvas),
        ])
        canvases[shot_id] = canvas
    return canvases


def _zoompan_filter(
    *,
    focal_in: dict,
    focal_out: dict | None,
    narration_frames: int,
    pause_frames: int,
    total_frames: int,
    width: int,
    height: int,
    fps: int,
) -> str:
    """Build the zoompan filter expression for one beat clip.

    If focal_out is None: static throughout (last beat in shot).
    Else: hold at focal_in for `narration_frames`, then linearly interpolate
    to focal_out over the next `pause_frames`.
    """
    if focal_out is None:
        z_expr = f"{focal_in['zoom']}"
        x_expr = f"iw*({focal_in['cx']} - 1/(2*zoom))"
        y_expr = f"ih*({focal_in['cy']} - 1/(2*zoom))"
    else:
        # progress = 0 during narration, 0->1 over pause, clamped.
        progress = (
            f"max(0,min(1,(on-{narration_frames})/{max(1, pause_frames)}))"
        )
        dz = focal_out["zoom"] - focal_in["zoom"]
        dcx = focal_out["cx"] - focal_in["cx"]
        dcy = focal_out["cy"] - focal_in["cy"]
        z_expr = f"{focal_in['zoom']}+({dz})*({progress})"
        cx_expr = f"({focal_in['cx']}+({dcx})*({progress}))"
        cy_expr = f"({focal_in['cy']}+({dcy})*({progress}))"
        x_expr = f"iw*({cx_expr}-1/(2*zoom))"
        y_expr = f"ih*({cy_expr}-1/(2*zoom))"

    return (
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':"
        f"d={total_frames}:s={width}x{height}:fps={fps},format=yuv420p"
    )


def render_beat_clip(
    *,
    canvas_png: Path,
    out_path: Path,
    focal_in: dict,
    focal_out: dict | None,
    narration_seconds: float,
    pause_seconds: float,
    width: int,
    height: int,
    fps: int,
) -> None:
    """Render one beat's silent MP4 with piecewise zoompan animation."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.stat().st_size > 0:
        logger.info("[beat] cache hit %s", out_path.name)
        return

    total_seconds = narration_seconds + pause_seconds
    narration_frames = int(narration_seconds * fps)
    pause_frames = int(pause_seconds * fps)
    total_frames = int(total_seconds * fps)

    vf = _zoompan_filter(
        focal_in=focal_in, focal_out=focal_out,
        narration_frames=narration_frames, pause_frames=pause_frames,
        total_frames=total_frames, width=width, height=height, fps=fps,
    )
    logger.info(
        "[beat] render %s (%.2fs narr + %.2fs pause = %d frames)",
        out_path.name, narration_seconds, pause_seconds, total_frames,
    )
    _run([
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", str(canvas_png),
        "-vf", vf,
        "-t", f"{total_seconds:.4f}",
        "-c:v", "libx264",
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        str(out_path),
    ])


def concat_all_beats(
    *,
    beat_paths: list[Path],
    out_path: Path,
) -> float:
    """Concat all beat clips end-to-end with stream-copy (no re-encode, hard cuts).

    Returns total duration in seconds.
    """
    if out_path.exists() and out_path.stat().st_size > 0:
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "json", str(out_path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        return float(json.loads(proc.stdout)["format"]["duration"])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        for p in beat_paths:
            f.write(f"file '{p.resolve()}'\n")
        list_file = f.name
    try:
        logger.info("[final-video] concat %d beats -> %s", len(beat_paths), out_path.name)
        _run([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", list_file,
            "-c", "copy", str(out_path),
        ])
    finally:
        Path(list_file).unlink(missing_ok=True)

    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "json", str(out_path)],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return float(json.loads(proc.stdout)["format"]["duration"])
