"""Tests for yt-pipeline assembler module."""
from __future__ import annotations

import json
import shutil
import subprocess
from unittest.mock import MagicMock, patch

import pytest


def test_assemble_raises_on_ffmpeg_failure(tmp_path):
    """assemble() raises RuntimeError when ffmpeg returns non-zero exit code."""
    # Create minimal fake files for the assets dict
    (tmp_path / "shot1.png").touch()
    (tmp_path / "narration.mp3").touch()

    assets = {
        "screenshots": [str(tmp_path / "shot1.png")],
        "narration_audio": str(tmp_path / "narration.mp3"),
    }
    plan = {"title": "Test Title"}
    run_dir = tmp_path / "run"

    # Mock subprocess.run to return a failure (returncode=1) for ffmpeg,
    # but success for ffprobe (duration probe)
    with patch("subprocess.run") as mock_run:
        def side_effect(*args, **kwargs):
            cmd_args = args[0] if args else []
            if cmd_args and cmd_args[0] == "ffmpeg":
                result = MagicMock(returncode=1, stderr="ffmpeg boom")
                result.returncode = 1
                result.stderr = "ffmpeg boom"
                return result
            elif cmd_args and cmd_args[0] == "ffprobe":
                # Return valid duration JSON for ffprobe
                result = MagicMock(returncode=0, stdout='{"format": {"duration": "5.0"}}')
                result.returncode = 0
                return result
            # For other calls, return success
            result = MagicMock(returncode=0, stdout="", stderr="")
            result.returncode = 0
            return result

        mock_run.side_effect = side_effect

        from tools.yt_pipeline.assembler import assemble

        with pytest.raises(RuntimeError, match="ffmpeg"):
            assemble(plan, assets, run_dir)


def test_render_card_writes_png(tmp_path):
    """_render_card() writes a PNG of size 1920x1080 to the specified path."""
    from PIL import Image

    from tools.yt_pipeline.assembler import _render_card

    out_png = tmp_path / "card.png"
    _render_card("Some Title", out_png)

    assert out_png.exists()
    assert out_png.stat().st_size > 0

    # Verify it's a valid PNG and has the correct dimensions
    img = Image.open(out_png)
    assert img.size == (1920, 1080)


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg not installed"
)
def test_assemble_produces_playable_mp4_screenshot_only(tmp_path):
    """assemble() produces a valid MP4 with video and audio from screenshots + narration only (no B-roll)."""
    from PIL import Image

    from tools.yt_pipeline.assembler import assemble

    # Create 4 real PNGs of varied sizes
    screenshots = []
    sizes = [(800, 600), (1280, 720), (1920, 1080), (640, 480)]
    colors = ["red", "green", "blue", "yellow"]
    for i, (size, color) in enumerate(zip(sizes, colors)):
        shot = tmp_path / f"shot_{i}.png"
        img = Image.new("RGB", size, color)
        img.save(shot)
        screenshots.append(str(shot))

    # Create a real MP3 (sine wave, 4 seconds)
    narration_mp3 = tmp_path / "narration.mp3"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            str(narration_mp3),
        ],
        capture_output=True,
        check=True,
    )

    # Build assets WITHOUT B-roll clips
    assets = {
        "screenshots": screenshots,
        "narration_audio": str(narration_mp3),
    }
    plan = {"title": "Test YouTube Video"}
    run_dir = tmp_path / "output"

    # Call assemble
    final = assemble(plan, assets, run_dir)

    # Verify output file exists
    assert final == run_dir / "final.mp4"
    assert final.exists()
    assert final.stat().st_size > 0

    # Use ffprobe to verify video and audio streams exist
    ffprobe_result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            str(final),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(ffprobe_result.stdout)

    # Verify streams
    codec_types = {s["codec_type"] for s in info["streams"]}
    assert "video" in codec_types, "Output must have a video stream"
    assert "audio" in codec_types, "Output must have an audio stream"

    # Verify format has duration >= narration (4s + title 3s + outro 5s, minus overlap from -shortest removal)
    duration = float(info["format"]["duration"])
    assert duration >= 4.0, f"Output duration {duration} must be >= 4.0s (narration)"


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg not installed"
)
def test_assemble_silent_no_audio(tmp_path):
    """assemble() with narration_script but NO narration_audio produces silent video (no audio stream)."""
    from PIL import Image

    from tools.yt_pipeline.assembler import assemble

    # Create 3 real PNGs
    screenshots = []
    for i, color in enumerate(["red", "green", "blue"]):
        shot = tmp_path / f"shot_{i}.png"
        img = Image.new("RGB", (1280, 720), color)
        img.save(shot)
        screenshots.append(str(shot))

    # Create narration_script file with ~30 words (estimate ~12 seconds at 150 wpm)
    narration_script = tmp_path / "narration_script.txt"
    script_text = (
        "In this video we fix a VFD overcurrent fault. "
        "First we identify the fault code on the display. "
        "Then we check the motor load. Finally we reset and restart."
    )
    narration_script.write_text(script_text)

    # Build assets WITH narration_script but NO narration_audio
    assets = {
        "screenshots": screenshots,
        "narration_script": str(narration_script),
    }
    plan = {"title": "Silent Test Video"}
    run_dir = tmp_path / "output"

    # Call assemble
    final = assemble(plan, assets, run_dir)

    # Verify output file exists
    assert final == run_dir / "final.mp4"
    assert final.exists()
    assert final.stat().st_size > 0

    # Use ffprobe to verify video stream exists but NO audio stream
    ffprobe_result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            str(final),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(ffprobe_result.stdout)

    # Verify streams
    codec_types = {s["codec_type"] for s in info["streams"]}
    assert "video" in codec_types, "Output must have a video stream"
    assert "audio" not in codec_types, "Output must NOT have an audio stream (silent)"

    # Verify duration is >= the floor (30 seconds)
    duration = float(info["format"]["duration"])
    assert duration >= 30.0, f"Output duration {duration} must be >= 30.0s (silent floor)"


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg not installed"
)
def test_assemble_with_broll_bookends(tmp_path):
    """assemble() produces a valid MP4 when B-roll scene1/scene3 clips are included in assets."""
    from PIL import Image

    from tools.yt_pipeline.assembler import assemble

    # Create real B-roll clips with ffmpeg (720p, 1 second each)
    scene1_mp4 = tmp_path / "scene1.mp4"
    scene3_mp4 = tmp_path / "scene3.mp4"

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=1",
            "-pix_fmt", "yuv420p",
            str(scene1_mp4),
        ],
        capture_output=True,
        check=True,
    )

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=1",
            "-pix_fmt", "yuv420p",
            str(scene3_mp4),
        ],
        capture_output=True,
        check=True,
    )

    # Create 3 real PNGs
    screenshots = []
    for i, color in enumerate(["red", "green", "blue"]):
        shot = tmp_path / f"shot_{i}.png"
        img = Image.new("RGB", (1280, 720), color)
        img.save(shot)
        screenshots.append(str(shot))

    # Create a real MP3 (sine wave, 3 seconds)
    narration_mp3 = tmp_path / "narration.mp3"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            str(narration_mp3),
        ],
        capture_output=True,
        check=True,
    )

    # Build assets WITH B-roll clips
    assets = {
        "scene1_clip": str(scene1_mp4),
        "scene3_clip": str(scene3_mp4),
        "screenshots": screenshots,
        "narration_audio": str(narration_mp3),
    }
    plan = {"title": "Test YouTube Video"}
    run_dir = tmp_path / "output"

    # Call assemble
    final = assemble(plan, assets, run_dir)

    # Verify output file exists
    assert final == run_dir / "final.mp4"
    assert final.exists()
    assert final.stat().st_size > 0

    # Use ffprobe to verify video and audio streams exist
    ffprobe_result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            str(final),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(ffprobe_result.stdout)

    # Verify streams
    codec_types = {s["codec_type"] for s in info["streams"]}
    assert "video" in codec_types, "Output must have a video stream"
    assert "audio" in codec_types, "Output must have an audio stream"

    # Duration should include both B-roll clips
    duration = float(info["format"]["duration"])
    assert duration > 0, "Output must have positive duration"
