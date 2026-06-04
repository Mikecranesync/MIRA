"""Tests for yt-pipeline producer module."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def fake_repo(tmp_path):
    """Build a fake repo layout matching what visuals.yaml's base_dirs expect."""
    industrial = tmp_path / "tests" / "regime3_nameplate" / "photos" / "real"
    industrial.mkdir(parents=True)
    # Sprinkle a handful of files per tag so pools are non-trivial.
    for tag in ("vfd", "motor", "contactor", "breaker", "panel", "plc"):
        for i in range(1, 6):
            (industrial / f"gp_{tag}_{i:03d}.jpg").touch()
    # "other" files must NOT be picked.
    for i in range(1, 4):
        (industrial / f"gp_other_{i:03d}.jpg").touch()

    product = tmp_path / "docs" / "promo-screenshots"
    product.mkdir(parents=True)
    # Recent demo captures (matching the visuals.yaml globs).
    for d in ("2026-05-22", "2026-05-23", "2026-05-24", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31"):
        (product / f"{d}_hub-feed_desktop.png").touch()
    # Older marketing stills that MUST be excluded by the globs.
    (product / "2026-04-27_pricing-page_desktop.png").touch()
    (product / "2026-04-30_hub-login_desktop.png").touch()

    manifest = tmp_path / "visuals.yaml"
    manifest.write_text(
        """
pools:
  industrial_hardware:
    base_dir: tests/regime3_nameplate/photos/real
    filename_pattern: "gp_{tag}_*.jpg"
  mira_product:
    base_dir: docs/promo-screenshots
    filename_globs:
      - "2026-05-2*_*.png"
      - "2026-05-3*_*.png"
topics:
  week1_fault_rescues:
    industrial_tags: [vfd, motor, contactor, breaker, panel, plc]
    product_fraction: 0.0
  week4_product_proof_and_deep_demos:
    industrial_tags: [vfd, motor, panel]
    product_fraction: 0.6
"""
    )

    # Reset the module-level cache so each test reloads our fake manifest.
    import tools.yt_pipeline.producer as producer_module
    producer_module._visuals_cache = None

    return tmp_path, manifest


def test_select_visuals_industrial_topic_picks_industrial_assets(fake_repo):
    """week1_fault_rescues picks ONLY industrial hardware photos — no MIRA product UI."""
    repo_root, manifest = fake_repo
    from tools.yt_pipeline.producer import select_visuals

    paths = select_visuals(
        "week1_fault_rescues", run_seed=0, count=12,
        manifest_path=manifest, repo_root=repo_root,
    )

    assert len(paths) == 12
    industrial_dir = repo_root / "tests" / "regime3_nameplate" / "photos" / "real"
    product_dir = repo_root / "docs" / "promo-screenshots"
    for p in paths:
        assert p.parent == industrial_dir, f"Non-industrial path leaked: {p}"
        assert p.parent != product_dir
        # Must match a permitted tag prefix; "other" must NOT appear.
        assert p.name.startswith(("gp_vfd_", "gp_motor_", "gp_contactor_",
                                  "gp_breaker_", "gp_panel_", "gp_plc_")), p.name
        assert not p.name.startswith("gp_other_"), f"'other' tag leaked: {p.name}"


def test_select_visuals_demo_topic_mixes_product_screenshots(fake_repo):
    """week4 (product_fraction=0.6, count=10) yields ≥5 product paths and ≥3 industrial."""
    repo_root, manifest = fake_repo
    from tools.yt_pipeline.producer import select_visuals

    paths = select_visuals(
        "week4_product_proof_and_deep_demos", run_seed=0, count=10,
        manifest_path=manifest, repo_root=repo_root,
    )

    assert len(paths) == 10
    product_dir = repo_root / "docs" / "promo-screenshots"
    product = [p for p in paths if p.parent == product_dir]
    industrial = [p for p in paths if p.parent != product_dir]
    assert len(product) >= 5, f"expected ≥5 product paths (0.6 fraction of 10), got {len(product)}"
    assert len(industrial) >= 3, f"expected some industrial mix, got {len(industrial)}"
    # Confirm older (pre-2026-05-2x) marketing stills did NOT slip through the glob.
    for p in product:
        assert "2026-04" not in p.name, f"old marketing still leaked: {p.name}"


def test_select_visuals_deterministic_per_seed(fake_repo):
    """Same (area, run_seed) → same list across two calls; different seed → different list."""
    repo_root, manifest = fake_repo
    from tools.yt_pipeline.producer import select_visuals

    a = select_visuals("week1_fault_rescues", run_seed=2, count=12,
                       manifest_path=manifest, repo_root=repo_root)
    b = select_visuals("week1_fault_rescues", run_seed=2, count=12,
                       manifest_path=manifest, repo_root=repo_root)
    c = select_visuals("week1_fault_rescues", run_seed=5, count=12,
                       manifest_path=manifest, repo_root=repo_root)

    assert a == b, "Same seed must produce the same list"
    assert a != c, "Different seeds should produce different lists"


def test_select_visuals_missing_industrial_pool_falls_back_to_product(fake_repo, caplog):
    """When the industrial dir is empty, fall back to the product pool (loud warning, not crash)."""
    repo_root, manifest = fake_repo
    industrial = repo_root / "tests" / "regime3_nameplate" / "photos" / "real"
    for p in industrial.glob("*.jpg"):
        p.unlink()

    from tools.yt_pipeline.producer import select_visuals

    with caplog.at_level("WARNING"):
        paths = select_visuals(
            "week1_fault_rescues", run_seed=0, count=4,
            manifest_path=manifest, repo_root=repo_root,
        )

    assert len(paths) > 0
    product_dir = repo_root / "docs" / "promo-screenshots"
    for p in paths:
        assert p.parent == product_dir
    assert any("Industrial pool empty" in r.message for r in caplog.records)


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


def test_produce_skips_broll_without_byteplus_key(tmp_path):
    """produce() skips B-roll generation when byteplus_api_key is empty; assets dict has no scene1/scene3."""
    plan = {
        "area": "week1_fault_rescues",
        "angle_index": 0,
        "scene1_prompt": "cinematic opening",
        "scene3_prompt": "closing shot",
        "scene2_narration": "Here is the narration text.",
    }

    fake_shot = tmp_path / "fake_shot.jpg"
    fake_shot.touch()
    fake_mp3 = tmp_path / "narration.mp3"
    fake_mp3.write_bytes(b"id3-fake-mp3")

    with patch("tools.yt_pipeline.producer.generate_broll") as mock_broll, \
         patch("tools.yt_pipeline.producer.select_visuals", return_value=[fake_shot]), \
         patch("tools.yt_pipeline.producer.synth_narration", return_value=fake_mp3):
        from tools.yt_pipeline.producer import produce

        assets = produce(
            plan,
            tmp_path,
            byteplus_api_key="",  # Empty key => no B-roll
            openai_api_key="fake-key",
        )

    # generate_broll should NOT have been called
    mock_broll.assert_not_called()

    # Assets dict must have screenshots and narration but NOT scene1/scene3 clips
    assert "screenshots" in assets
    assert "narration_audio" in assets
    assert "narration_script" in assets
    assert "scene1_clip" not in assets
    assert "scene3_clip" not in assets
    assert len(assets["screenshots"]) > 0

    # Verify narration_script file exists and contains the text
    narration_script_path = assets["narration_script"]
    assert Path(narration_script_path).exists()
    assert Path(narration_script_path).read_text() == plan["scene2_narration"]


def test_produce_degrades_to_silent_when_tts_fails(tmp_path):
    """When a key is present but TTS raises (e.g. 429 no quota), produce() degrades to a silent draft."""
    plan = {
        "area": "week1_fault_rescues",
        "angle_index": 0,
        "scene1_prompt": "cinematic opening",
        "scene3_prompt": "closing shot",
        "scene2_narration": "Narration that cannot be voiced because the account has no quota.",
    }
    fake_shot = tmp_path / "fake_shot.jpg"
    fake_shot.touch()

    with patch("tools.yt_pipeline.producer.generate_broll"), \
         patch("tools.yt_pipeline.producer.select_visuals", return_value=[fake_shot]), \
         patch(
             "tools.yt_pipeline.producer.synth_narration",
             side_effect=RuntimeError("Error code: 429 - insufficient_quota"),
         ):
        from tools.yt_pipeline.producer import produce

        # Key is present (truthy) but TTS fails — must NOT raise.
        assets = produce(
            plan,
            tmp_path,
            byteplus_api_key="",
            openai_api_key="present-but-unfunded",
        )

    # Degraded to silent: script present, no audio, no exception propagated.
    assert "narration_audio" not in assets
    assert "narration_script" in assets
    assert Path(assets["narration_script"]).read_text() == plan["scene2_narration"]
    assert "screenshots" in assets


def test_produce_silent_when_no_openai_key(tmp_path):
    """produce() skips narration synthesis when openai_api_key is empty; narration_script still written."""
    plan = {
        "area": "week1_fault_rescues",
        "angle_index": 0,
        "scene1_prompt": "cinematic opening",
        "scene3_prompt": "closing shot",
        "scene2_narration": "This is the silent narration script text.",
    }

    fake_shot = tmp_path / "fake_shot.jpg"
    fake_shot.touch()

    with patch("tools.yt_pipeline.producer.generate_broll") as _mock_broll, \
         patch("tools.yt_pipeline.producer.select_visuals", return_value=[fake_shot]), \
         patch("tools.yt_pipeline.producer.synth_narration") as mock_synth:
        from tools.yt_pipeline.producer import produce

        assets = produce(
            plan,
            tmp_path,
            byteplus_api_key="fake-byteplus-key",
            openai_api_key="",  # Empty key => no narration synthesis
        )

    # synth_narration should NOT have been called
    mock_synth.assert_not_called()

    # Assets dict must have narration_script but NOT narration_audio
    assert "narration_script" in assets
    assert "narration_audio" not in assets
    assert "screenshots" in assets

    # Verify narration_script file exists and contains the text
    narration_script_path = assets["narration_script"]
    assert Path(narration_script_path).exists()
    assert Path(narration_script_path).read_text() == plan["scene2_narration"]
