"""Tests for yt-pipeline producer module."""
from __future__ import annotations

from unittest.mock import MagicMock, patch


def test_select_screenshots_matches_keywords(tmp_path):
    """select_screenshots() returns paths whose filenames contain the keywords."""
    (tmp_path / "2026-04-27_workorder-detail_desktop.png").touch()
    (tmp_path / "2026-04-27_hub-login_desktop.png").touch()
    (tmp_path / "2026-04-27_schedule-calendar_desktop.png").touch()

    from tools.yt_pipeline.producer import select_screenshots

    results = select_screenshots(["workorder", "hub"], screenshots_dir=tmp_path)
    names = [r.name for r in results]
    assert any("workorder" in n for n in names)
    assert any("hub" in n for n in names)


def test_select_screenshots_pads_to_four(tmp_path):
    """select_screenshots() always returns up to 4 paths, padding with recents."""
    for i in range(6):
        (tmp_path / f"2026-04-{i + 1:02d}_shot_{i}.png").touch()

    from tools.yt_pipeline.producer import select_screenshots

    results = select_screenshots(["nomatch"], screenshots_dir=tmp_path)
    assert len(results) == 4


def test_generate_broll_polls_until_succeeded(tmp_path):
    """generate_broll() submits job, polls, downloads MP4 on success (no real sleep)."""
    submit_resp = MagicMock()
    submit_resp.raise_for_status = MagicMock()
    submit_resp.json.return_value = {"id": "job-123"}

    poll_resp = MagicMock()
    poll_resp.raise_for_status = MagicMock()
    poll_resp.json.return_value = {
        "status": "succeeded",
        "content": [{"video_url": "https://example.com/clip.mp4"}],
    }

    download_resp = MagicMock()
    download_resp.content = b"fake-mp4-bytes"

    with patch("httpx.post", return_value=submit_resp), \
         patch("httpx.get", side_effect=[poll_resp, download_resp]), \
         patch("tools.yt_pipeline.producer.time.sleep"):
        from tools.yt_pipeline.producer import generate_broll

        out = generate_broll("cinematic broll prompt", tmp_path, "scene1", "fake-key")

    assert out.exists()
    assert out.read_bytes() == b"fake-mp4-bytes"
    assert out.name == "scene1.mp4"


def test_synth_narration_reuses_tts(tmp_path):
    """synth_narration() delegates to the comic-pipeline synth_beat and yields narration.mp3."""
    fake_mp3 = tmp_path / "beat_abc123.mp3"
    fake_mp3.write_bytes(b"id3-fake-mp3")

    with patch("tools.yt_pipeline.producer.synth_beat", return_value=fake_mp3):
        from tools.yt_pipeline.producer import synth_narration

        out = synth_narration(
            "In this video we fix a VFD overcurrent fault.", tmp_path, api_key="fake-key"
        )

    assert out.exists()
    assert out.name == "narration.mp3"
    assert out.read_bytes() == b"id3-fake-mp3"
