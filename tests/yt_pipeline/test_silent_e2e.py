"""End-to-end test for silent-draft production path.

Verifies three critical scenarios:
1. assembler.assemble() produces video-only MP4 when narration_audio key absent
2. main.run() saves outputs to ~/yt-pipeline-drafts/ with correct structure
3. Calendar advances next_angle_index and records draft entry
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="real ffmpeg and ffprobe required",
)
def test_silent_assembler_produces_playable_video(tmp_path):
    """assemble() with narration_script but NO narration_audio produces silent video.

    Verifies:
    - final.mp4 is created
    - Contains video stream (no audio stream)
    - Duration >= 30s floor (word-count-based estimation)
    """
    from tools.yt_pipeline.assembler import assemble

    # Create 3 real PNGs
    screenshots = []
    for i, color in enumerate(["red", "green", "blue"]):
        shot = tmp_path / f"shot_{i}.png"
        img = Image.new("RGB", (1280, 720), color)
        img.save(shot)
        screenshots.append(str(shot))

    # Create narration_script with ~78 words (should yield ~31s video at 150 wpm)
    narration_script = tmp_path / "narration_script.txt"
    script_text = (
        "In this tutorial we troubleshoot a conveyor system fault. "
        "The operator reports the motor stopped unexpectedly. "
        "We check the PLC diagnostic codes and identify an overcurrent condition. "
        "Next we verify the motor load using a clamp meter. "
        "The current is within normal range so we suspect a sensor issue. "
        "We swap the proximity sensor and the fault clears. "
        "Finally we run the motor through several cycles to confirm stability. "
        "The conveyor now runs smoothly without alarms or resets."
    )
    narration_script.write_text(script_text)
    assert len(script_text.split()) == 78  # Verify word count

    # Call assemble WITHOUT narration_audio key (simulates silent-draft)
    plan = {"title": "Silent Test Video"}
    assets = {
        "screenshots": screenshots,
        "narration_script": narration_script,
        # NO "narration_audio" key
    }
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    final_mp4 = assemble(plan, assets, output_dir)
    assert final_mp4.exists(), f"Expected {final_mp4} to be created"

    # Verify via ffprobe: video stream present, audio absent
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(final_mp4)],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    codec_types = [s["codec_type"] for s in data.get("streams", [])]

    assert "video" in codec_types, "Expected video stream in silent MP4"
    assert "audio" not in codec_types, "Expected NO audio stream in silent MP4"

    # Verify duration (78 words at 150 wpm ≈ 31s, so floor 30s is safe)
    for stream in data.get("streams", []):
        if stream["codec_type"] == "video":
            duration = float(stream.get("duration", 0))
            assert duration >= 30.0, f"Expected duration >= 30s, got {duration}s"


def test_assembler_silent_produces_video_only_ffprobe_verified(tmp_path):
    """Simpler assembler test: verify video-only output via ffprobe."""
    from tools.yt_pipeline.assembler import assemble

    # Create 1 PNG
    shot = tmp_path / "shot_0.png"
    img = Image.new("RGB", (1280, 720), "red")
    img.save(shot)

    # Create script
    script = tmp_path / "script.txt"
    script.write_text("Test script with some words for duration estimation.")

    # Assemble WITHOUT audio
    plan = {"title": "Test"}
    assets = {"screenshots": [str(shot)], "narration_script": script}
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    final_mp4 = assemble(plan, assets, output_dir)
    assert final_mp4.exists()

    # Verify video-only via ffprobe
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(final_mp4)],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    codec_types = [s["codec_type"] for s in data.get("streams", [])]
    assert "video" in codec_types
    assert "audio" not in codec_types


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="real ffmpeg and ffprobe required",
)
def test_run_silent_path_integration_with_mocks(tmp_path, monkeypatch):
    """Integration test: run() silent path writes draft folder and updates calendar.

    Mocks plan_next, produce, assemble, upload at source module level.
    Verifies:
    - upload() NOT called
    - Calendar next_angle_index advanced
    - draft_dir created with final.mp4, narration_script.txt, meta.txt
    """
    from tools.yt_pipeline import main as main_module

    # ===== Setup: Calendar, screenshots, script, silent MP4 =====
    calendar_file = tmp_path / "calendar.json"
    calendar = {
        "next_angle_index": 0,
        "last_run_utc": None,
        "consecutive_failures": 0,
        "published": [],
        "drafts": [],
    }
    calendar_file.write_text(json.dumps(calendar))

    drafts_base = tmp_path / "drafts"
    drafts_base.mkdir()

    # Create screenshots
    screenshots = []
    for i in range(3):
        shot = tmp_path / f"shot_{i}.png"
        img = Image.new("RGB", (1280, 720), "red")
        img.save(shot)
        screenshots.append(str(shot))

    # Create narration script
    script_file = tmp_path / "narration_script.txt"
    script_file.write_text("This is a test script for silent draft mode.")

    # Create silent final.mp4 (6 frames, ~0.24s at 25fps; duration will be low but that's OK for test)
    final_mp4 = tmp_path / "final.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-f", "lavfi",
            "-i", "color=red:s=1280x720:d=0.24",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            str(final_mp4),
        ],
        check=True,
        capture_output=True,
    )

    # ===== Setup: Mock plan, assets, run_dir =====
    plan = {
        "title": "Silent Test Video",
        "description": "Test description",
        "tags": ["test", "silent"],
        "area": "conveyor",
        "angle": "motor-speed",
        "angle_index": 0,
        "scene2_narration": "Some narration",
        "scene1_prompt": "Generate scene 1",
        "scene3_prompt": "Generate scene 3",
    }

    # assets WITHOUT narration_audio key (silent path)
    assets = {
        "screenshots": screenshots,
        "narration_script": script_file,
        # NO "narration_audio"
    }

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    # ===== Patch module-level constants and functions =====
    with patch.object(main_module, "_CALENDAR_FILE", calendar_file), \
         patch.object(main_module, "_YT_DRAFTS_DIR", drafts_base), \
         patch("tools.yt_pipeline.planner.plan_next", return_value=plan), \
         patch("tools.yt_pipeline.producer.produce", return_value=assets), \
         patch("tools.yt_pipeline.assembler.assemble", return_value=final_mp4), \
         patch("tools.yt_pipeline.uploader.upload") as mock_upload:

        # Monkeypatch ENV so run() doesn't fail early
        monkeypatch.setenv("GROQ_API_KEY", "test-key")

        # ===== Call run() =====
        main_module.run(dry_run=False)

        # ===== Verify upload NOT called =====
        mock_upload.assert_not_called()

        # ===== Verify calendar updated =====
        updated_calendar = json.loads(calendar_file.read_text())
        assert updated_calendar["next_angle_index"] == 1, "angle_index not advanced"
        assert updated_calendar["consecutive_failures"] == 0

        # ===== Verify draft entry recorded =====
        assert len(updated_calendar["drafts"]) > 0, "No draft entry in calendar"
        draft_entry = updated_calendar["drafts"][0]
        assert draft_entry["title"] == "Silent Test Video"
        assert draft_entry["topic"] == "conveyor", f"topic should be 'conveyor' (from plan['area']), got {draft_entry['topic']}"
        assert draft_entry["angle_index"] == 0
        assert "draft_dir" in draft_entry

        # ===== Verify draft folder structure =====
        draft_dir = Path(draft_entry["draft_dir"])
        assert draft_dir.exists(), f"Draft dir not created: {draft_dir}"
        assert (draft_dir / "final.mp4").exists(), "final.mp4 missing"
        assert (draft_dir / "narration_script.txt").exists(), "narration_script.txt missing"
        assert (draft_dir / "meta.txt").exists(), "meta.txt missing"

        # ===== Verify meta.txt content =====
        meta_text = (draft_dir / "meta.txt").read_text()
        assert "Silent Test Video" in meta_text or "title" in meta_text.lower()
        assert "Test description" in meta_text or "description" in meta_text.lower()
