"""Assembles B-roll, screenshots, PIL-rendered cards, and narration into final.mp4 via ffmpeg."""
from __future__ import annotations

import json
import logging
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

log = logging.getLogger("yt-pipeline.assembler")

_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
_W, _H, _FPS = 1920, 1080, 30

# Per-input normalization applied to EVERY segment before concat.
# Ensures all inputs have identical resolution, fps, SAR, and format.
_NORM = (
    f"scale={_W}:{_H}:force_original_aspect_ratio=decrease,"
    f"pad={_W}:{_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={_FPS},format=yuv420p"
)


def _run(*args: str) -> None:
    """Run ffmpeg with the given arguments. Raise RuntimeError on failure."""
    result = subprocess.run(["ffmpeg", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        # Keep the last 800 chars of stderr for the error message
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-800:]}")


def _render_card(text: str, out_png: Path, *, fontsize: int = 72) -> Path:
    """Render a text card with PIL and save it as a PNG."""
    img = Image.new("RGB", (_W, _H), "black")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(_FONT_PATH, fontsize)

    # Wrap text to roughly 28 characters per line
    wrapped = textwrap.fill(text, width=28)

    # Compute bounding box to center the text
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, align="center", spacing=12)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    # Draw centered, multi-line text
    draw.multiline_text(
        ((_W - tw) / 2, (_H - th) / 2),
        wrapped,
        fill="white",
        font=font,
        align="center",
        spacing=12,
    )
    img.save(out_png)
    return out_png


def _card_clip(png: Path, seconds: int, out_mp4: Path) -> Path:
    """Convert a PNG to an MP4 clip of the specified duration, normalized to output format."""
    _run(
        "-loop", "1",
        "-t", str(seconds),
        "-i", str(png),
        "-vf", _NORM,
        "-r", str(_FPS),
        str(out_mp4),
    )
    return out_mp4


def _probe_duration(path: str | Path) -> float:
    """Probe a media file and return its duration in seconds."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def _slideshow(shots: list[str], run_dir: Path, per_shot_seconds: float = 5) -> Path:
    """
    Create a slideshow from PNG screenshots with zoompan effect.

    Args:
        shots: list of PNG file paths
        run_dir: output directory
        per_shot_seconds: duration of each shot in seconds (can be fractional)

    Returns:
        Path to the generated slideshow.mp4
    """
    inputs: list[str] = []
    for s in shots:
        inputs += ["-loop", "1", "-t", str(per_shot_seconds), "-i", s]

    # Build filter complex: scale, crop, zoompan each shot, then concat
    parts: list[str] = []
    per_shot_frames = round(per_shot_seconds * _FPS)
    for i in range(len(shots)):
        parts.append(
            f"[{i}:v]scale={_W}:{_H}:force_original_aspect_ratio=increase,"
            f"crop={_W}:{_H},zoompan=z='min(zoom+0.001,1.1)':d={per_shot_frames}:s={_W}x{_H},"
            f"setsar=1,fps={_FPS},format=yuv420p[v{i}]"
        )

    # Concat all the scaled/cropped shots
    parts.append("".join(f"[v{i}]" for i in range(len(shots))) + f"concat=n={len(shots)}:v=1:a=0[out]")

    out = run_dir / "slideshow.mp4"
    _run(*inputs, "-filter_complex", ";".join(parts), "-map", "[out]", str(out))
    return out


def assemble(plan: dict, assets: dict, run_dir: Path) -> Path:
    """
    Assemble video segments, PIL-rendered cards, a screenshot slideshow, and narration
    into a single final.mp4.

    Args:
        plan: dict with at least plan["title"] (str)
        assets: dict with keys "screenshots" (list of PNG paths) and "narration_audio" (MP3 path).
                Optional keys: "scene1_clip", "scene3_clip" (B-roll MP4 paths, only present if generated).
        run_dir: output directory for intermediate and final files

    Returns:
        Path to the final.mp4 file
    """
    run_dir.mkdir(parents=True, exist_ok=True)
    shots = assets["screenshots"]
    narration = assets["narration_audio"]

    # Probe narration duration to drive the slideshow length
    narration_duration = _probe_duration(narration)
    per_shot_seconds = max(2.5, narration_duration / len(shots)) if shots else 2.5

    # Generate the slideshow from screenshots, scaled to match narration duration
    slideshow = _slideshow(shots, run_dir, per_shot_seconds=per_shot_seconds)

    # Render and convert title card to MP4
    title_mp4 = _card_clip(_render_card(plan["title"], run_dir / "title.png"), 3, run_dir / "title.mp4")

    # Render and convert outro card to MP4
    outro_mp4 = _card_clip(
        _render_card("Try MIRA free at factorylm.com", run_dir / "outro.png", fontsize=56),
        5,
        run_dir / "outro.mp4",
    )

    # Build segment list in order: [scene1 if present] -> title -> slideshow -> [scene3 if present] -> outro
    segments: list[str] = []
    if "scene1_clip" in assets:
        segments.append(assets["scene1_clip"])
    segments.append(str(title_mp4))
    segments.append(str(slideshow))
    if "scene3_clip" in assets:
        segments.append(assets["scene3_clip"])
    segments.append(str(outro_mp4))

    # Prepare ffmpeg inputs: all video segments + the narration audio
    inputs: list[str] = []
    for seg in segments:
        inputs += ["-i", seg]
    inputs += ["-i", narration]

    # Build filter_complex:
    # 1. Normalize each video segment to {_W}x{_H}, {_FPS}, setsar=1, yuv420p
    # 2. Concat all normalized video segments
    n = len(segments)
    norm = ";".join(f"[{i}:v]{_NORM}[v{i}]" for i in range(n))
    concat = "".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vout]"

    out = run_dir / "final.mp4"
    _run(
        *inputs,
        "-filter_complex", f"{norm};{concat}",
        "-map", "[vout]",
        "-map", f"{n}:a",  # n is the index of the narration audio input
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    )

    log.info("Assembly complete: %s (%.1f MB)", out, out.stat().st_size / 1e6)
    return out
