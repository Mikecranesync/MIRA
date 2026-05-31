"""Generates Seedance B-roll clips, selects promo screenshots, synthesizes narration audio."""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

import httpx

log = logging.getLogger("yt-pipeline.producer")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_SCREENSHOTS_DIR = _REPO_ROOT / "docs" / "promo-screenshots"

# Reuse MIRA's existing TTS engine from the comic pipeline (single source of truth).
_COMIC_ROOT = _REPO_ROOT / "marketing" / "comic-pipeline"
if str(_COMIC_ROOT) not in sys.path:
    sys.path.insert(0, str(_COMIC_ROOT))

from openai import OpenAI  # noqa: E402  (import after sys.path setup)
from pipeline.v2.tts import synth_beat  # noqa: E402  (comic-pipeline TTS)

_API_BASE = "https://ark.ap-southeast.byteplus.com/api/v3"
_MODEL = "seedance-1-0-lite-t2v-250428"
_POLL_INTERVAL = 10
_MAX_POLLS = 36  # 6 minutes

# Narration voice — same engine/voice/style the comic pipeline uses.
_TTS_MODEL = "gpt-4o-mini-tts"
_TTS_VOICE = "onyx"
_TTS_SPEED = 1.05
_NARRATION_STYLE = (
    "Speak like a confident, experienced maintenance engineer talking to a peer. "
    "Conversational and direct — not pitching, just telling it straight. "
    "Natural rhythm. Let short sentences land with weight. "
    "Longer sentences flow without over-emphasizing every word."
)


def select_screenshots(
    keywords: list[str],
    screenshots_dir: Path = _DEFAULT_SCREENSHOTS_DIR,
) -> list[Path]:
    """Return up to 4 screenshots: keyword matches first, then most recent."""
    all_shots = sorted(screenshots_dir.glob("*.png"), reverse=True)
    matches: list[Path] = []
    for kw in keywords:
        for shot in all_shots:
            if kw.lower() in shot.name.lower() and shot not in matches:
                matches.append(shot)
                break
    for shot in all_shots:
        if len(matches) >= 4:
            break
        if shot not in matches:
            matches.append(shot)
    return matches[:4]


def generate_broll(prompt: str, run_dir: Path, clip_name: str, api_key: str) -> Path:
    """Submit Seedance job, poll until complete, download MP4. Returns output path."""
    resp = httpx.post(
        f"{_API_BASE}/contents/generations/tasks",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": _MODEL,
            "content": [{"type": "text", "text": prompt}],
            "parameters": {"resolution": "720p", "duration": 8, "aspect_ratio": "16:9"},
        },
        timeout=30,
    )
    resp.raise_for_status()
    task_id = resp.json()["id"]
    log.info("Seedance job submitted: %s", task_id)

    for _ in range(_MAX_POLLS):
        time.sleep(_POLL_INTERVAL)
        status_resp = httpx.get(
            f"{_API_BASE}/contents/generations/tasks/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        status_resp.raise_for_status()
        data = status_resp.json()
        if data["status"] == "succeeded":
            video_url = data["content"][0]["video_url"]
            out_path = run_dir / f"{clip_name}.mp4"
            out_path.write_bytes(httpx.get(video_url, timeout=120).content)
            log.info("B-roll saved: %s", out_path)
            return out_path
        if data["status"] == "failed":
            raise RuntimeError(f"Seedance job {task_id} failed: {data}")

    raise TimeoutError(
        f"Seedance job {task_id} timed out after {_MAX_POLLS * _POLL_INTERVAL}s"
    )


def synth_narration(narration_text: str, run_dir: Path, *, api_key: str) -> Path:
    """Render narration text to narration.mp3 using MIRA's comic-pipeline TTS engine."""
    run_dir.mkdir(parents=True, exist_ok=True)
    client = OpenAI(api_key=api_key)
    mp3 = synth_beat(
        client,
        text=narration_text,
        voice=_TTS_VOICE,
        model=_TTS_MODEL,
        speed=_TTS_SPEED,
        cache_dir=run_dir,
        instructions=_NARRATION_STYLE,
    )
    out = run_dir / "narration.mp3"
    if mp3 != out:
        out.write_bytes(mp3.read_bytes())
    log.info("Narration synthesized: %s", out)
    return out


def produce(
    plan: dict,
    run_dir: Path,
    *,
    byteplus_api_key: str,
    openai_api_key: str,
) -> dict:
    """Generate all assets for a run. Returns asset path dict."""
    run_dir.mkdir(parents=True, exist_ok=True)
    clip1 = generate_broll(plan["scene1_prompt"], run_dir, "scene1", byteplus_api_key)
    clip3 = generate_broll(plan["scene3_prompt"], run_dir, "scene3", byteplus_api_key)
    screenshots = select_screenshots(plan["scene3_screenshot_keywords"])
    narration_audio = synth_narration(
        plan["scene2_narration"], run_dir, api_key=openai_api_key
    )
    return {
        "scene1_clip": str(clip1),
        "scene3_clip": str(clip3),
        "screenshots": [str(s) for s in screenshots],
        "narration_audio": str(narration_audio),
    }
