"""Picks the next topic angle and generates a 3-scene video script via Groq."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx
import yaml

log = logging.getLogger("yt-pipeline.planner")

_DEFAULT_TOPICS = Path(__file__).parent / "topics.yaml"
_DEFAULT_CALENDAR = Path(__file__).parent / "calendar.json"


def load_topics(topics_path: Path = _DEFAULT_TOPICS) -> list[dict]:
    """Load topics YAML and return flat list of {area, angle} dicts."""
    data = yaml.safe_load(topics_path.read_text())
    angles = []
    for area, config in data["topics"].items():
        for angle in config["angles"]:
            angles.append({"area": area, "angle": angle})
    return angles


def load_calendar(calendar_path: Path = _DEFAULT_CALENDAR) -> dict:
    """Load calendar.json or return defaults if not found."""
    if calendar_path.exists():
        return json.loads(calendar_path.read_text())
    return {
        "next_angle_index": 0,
        "last_run_utc": None,
        "consecutive_failures": 0,
        "published": [],
    }


def save_calendar(cal: dict, calendar_path: Path = _DEFAULT_CALENDAR) -> None:
    """Write calendar dict to JSON file."""
    calendar_path.write_text(json.dumps(cal, indent=2))


def generate_script(angle: str, groq_api_key: str) -> dict:
    """Call Groq to generate title, description, tags, and 3-scene script."""
    prompt = (
        f"You are writing a YouTube video script for the Industrial Skills Hub channel.\n"
        f"Topic: {angle}\n\n"
        f"Return a JSON object with these exact keys:\n"
        f"- title: string (YouTube title, keyword-rich, under 70 chars)\n"
        f"- description: string (150-200 words, include timestamps at 0:00 0:45 1:30 2:15 3:00 4:30)\n"
        f"- tags: list of 10 strings (industrial maintenance keywords)\n"
        f"- scene1_prompt: string (Seedance AI video prompt, 8s cinematic industrial B-roll hook)\n"
        f"- scene2_narration: string (narrator script for screen recording section, 200-300 words)\n"
        f"- scene3_prompt: string (Seedance AI video prompt, 8s B-roll for MIRA demo section)\n"
        f"- scene3_screenshot_keywords: list of 3 strings (filename substrings matching promo screenshots)\n\n"
        f"Return ONLY the JSON object, no markdown fences."
    )
    resp = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {groq_api_key}"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 2000,
        },
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"].strip()
    # Strip markdown fences if model adds them anyway
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content)


def plan_next(
    groq_api_key: str,
    topics_path: Path = _DEFAULT_TOPICS,
    calendar_path: Path = _DEFAULT_CALENDAR,
) -> dict:
    """Select next angle and generate script. Returns full plan dict."""
    cal = load_calendar(calendar_path)
    angles = load_topics(topics_path)
    idx = cal.get("next_angle_index", 0) % len(angles)
    chosen = angles[idx]
    log.info("Planning angle %d: area=%s", idx, chosen["area"])
    script = generate_script(chosen["angle"], groq_api_key)
    return {"area": chosen["area"], "angle": chosen["angle"], "angle_index": idx, **script}
