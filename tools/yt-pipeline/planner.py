"""Picks the next topic angle and generates a 3-scene video script via Groq."""

from __future__ import annotations

import json
import logging
import re
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
        f"- description: string (2-3 sentence compelling summary; do NOT add timestamps or chapter markers)\n"
        f"- tags: list of 10 strings (industrial maintenance keywords)\n"
        f"- scene1_prompt: string (Seedance AI video prompt, 8s cinematic industrial B-roll hook)\n"
        f"- scene2_narration: string (tight voiceover script, 110-140 words, ~60 seconds when read aloud)\n"
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


def _polish_chapter_label(beat_text: str, chapter_index: int) -> str:
    """Polish raw script beat text into a readable chapter title.

    Rules:
    1. Take the first sentence (or first ~8 words, whichever is shorter).
    2. Strip leading filler: "so", "now", "next", "then", "ok", "alright", "you know",
       "let's", "you'll", "you've", "we'll", "we've", "i'll", "you", "we", "it's",
       "that's" (case-insensitive, only at the start).
    3. Drop trailing prepositions/articles: "the", "a", "an", "of", "in", "on", "to",
       "for", "is", "are", "was", and audience/channel words.
    4. Cap at 50 characters (word boundary, no ellipsis).
    5. Capitalize first character only (not title-case).
    6. For the FIRST chapter, if result is generic ("Hi", "Hello", "Welcome"), use "Intro".
    7. If empty after stripping, fall back to "Chapter N".
    """
    # Extract first sentence or first ~8 words
    match = re.match(r"^([^.!?]*[.!?])", beat_text.strip())
    if match:
        first_sent = match.group(1).rstrip(".!?")
    else:
        first_sent = beat_text.strip()
    words = first_sent.split()
    words = words[:8] if len(words) > 8 else words
    text = " ".join(words) if words else ""

    def _norm(w: str) -> str:
        # Strip leading/trailing punctuation so "So," still matches "so".
        return re.sub(r"^[^\w']+|[^\w']+$", "", w.lower())

    # Strip leading filler
    filler = {
        "so", "now", "next", "then", "ok", "alright", "you", "know",
        "let's", "you'll", "you've", "we'll", "we've", "i'll", "we",
        "it's", "that's"
    }
    words = text.split()
    while words and _norm(words[0]) in filler:
        words.pop(0)
    text = " ".join(words) if words else ""
    if text and text[0] != text[0].upper():
        text = text[0].upper() + text[1:]

    # Strip trailing prepositions/articles and audience/channel words
    trailing = {
        "the", "a", "an", "of", "in", "on", "to", "for", "is", "are", "was",
        "everyone", "viewers", "folks", "friends", "guys", "people", "channel", "video"
    }
    words = text.split()
    while words and _norm(words[-1]) in trailing:
        words.pop()
    text = " ".join(words) if words else ""
    # Strip any dangling leading/trailing punctuation left after word removal
    text = text.strip(" ,;:—-")
    if text and text[0] != text[0].upper():
        text = text[0].upper() + text[1:]

    # Cap at 50 characters on word boundary
    if len(text) > 50:
        truncated = text[:50]
        last_space = truncated.rfind(" ")
        if last_space > 10:  # don't truncate too aggressively
            text = truncated[:last_space]
        else:
            text = truncated.rstrip()

    # For first chapter, fall back to "Intro" if generic
    if chapter_index == 0 and text.lower() in ("hi", "hello", "welcome", "hey", "greetings"):
        return "Intro"

    # If empty after stripping, use fallback
    if not text.strip():
        return f"Chapter {chapter_index + 1}"

    return text.strip()


def _chapter_timestamps(
    script: str, *, words_per_second: float = 2.5, max_chapters: int = 4
) -> str:
    """Build honest YouTube chapter lines from the narration script's reading time.

    Splits the script into sentences, groups them into up to `max_chapters`
    chapters, and timestamps each by cumulative word count at ~150 wpm
    (`words_per_second` = 2.5). The first chapter is forced to 0:00 and chapters
    are kept >=10s apart (YouTube's requirement). Produces timestamps that match
    a ~60-second video instead of fabricated multi-minute markers.
    """
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script.strip()) if s.strip()]
    if len(sentences) < 2:
        return ""
    n = min(max_chapters, len(sentences))
    per = max(1, len(sentences) // n)
    chapters: list[tuple[int, str]] = []
    cum_words = 0
    i = 0
    while i < len(sentences) and len(chapters) < n:
        # Last chapter takes all remaining sentences.
        chunk = sentences[i:] if len(chapters) == n - 1 else sentences[i : i + per]
        start = int(cum_words / words_per_second)
        raw_label = " ".join(chunk[0].split()[:6]).rstrip(".,;:!?")
        polished_label = _polish_chapter_label(raw_label, len(chapters))
        chapters.append((start, polished_label))
        cum_words += sum(len(s.split()) for s in chunk)
        i += len(chunk)
    lines: list[str] = []
    prev = -10
    for idx, (sec, label) in enumerate(chapters):
        sec = 0 if idx == 0 else max(sec, prev + 10)
        prev = sec
        lines.append(f"{sec // 60}:{sec % 60:02d} {label}")
    return "\n".join(lines)


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
    # Append honest, reading-time-based chapters to the description (used by both
    # the draft meta.txt and the YouTube upload path).
    chapters = _chapter_timestamps(script.get("scene2_narration", ""))
    if chapters:
        desc = (script.get("description") or "").strip()
        script["description"] = f"{desc}\n\nChapters:\n{chapters}".strip()
    return {"area": chosen["area"], "angle": chosen["angle"], "angle_index": idx, **script}
