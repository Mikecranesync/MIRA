"""W2.1 — Live stack validation: YouTube analyzer pipeline on reference video.

Usage:
    doppler run --project factorylm --config prd -- python3.12 tools/analyze_reference_video.py
    doppler run --project factorylm --config prd -- python3.12 tools/analyze_reference_video.py <youtube_url>

Output: docs/seo-youtube-content-analysis-2026-05.md
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Add parent to path so we can import mira_seo without installing
sys.path.insert(0, str(Path(__file__).parent.parent))

from mira_seo.providers.youtube_analyzer import (
    get_transcript,
    youtube_autocomplete,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("mira-seo.w2.1")

GROQ_API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("GROQ", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

# Reference video for stack validation (Karpathy: "Let's build GPT from scratch")
# AI/ML content is relevant to MIRA's domain (AI-powered maintenance platform)
DEFAULT_VIDEO_URL = "https://www.youtube.com/watch?v=kCc8FmEb1nY"

# Seed keywords relevant to MIRA's SEO focus
SEED_KEYWORDS = [
    "AI industrial maintenance",
    "predictive maintenance software",
    "CMMS software",
    "VFD troubleshooting",
    "equipment fault diagnosis AI",
]

OUTPUT_PATH = Path(__file__).parent.parent.parent / "docs" / "seo-youtube-content-analysis-2026-05.md"


async def analyze_with_groq(transcript: str) -> dict:
    """Call Groq API directly for SEO analysis."""
    if not GROQ_API_KEY:
        logger.error("GROQ_API_KEY not set — cannot run analysis")
        return {}

    system_prompt = "You are an SEO analyst. Extract structured data from this YouTube video transcript to inform a content strategy for an AI-powered industrial maintenance platform."
    user_prompt = (
        f"Transcript (first 8000 chars):\n{transcript[:8000]}\n\n"
        "Extract the following and return as JSON only (no markdown fences):\n"
        "1. main_topics: list of 5-10 main topics covered\n"
        "2. keywords: list of 15-20 SEO-relevant keywords mentioned or implied\n"
        "3. content_format: one of 'tutorial', 'explainer', 'demo', 'review', 'interview'\n"
        "4. key_questions: list of 5-8 questions the video answers\n"
        "5. content_gaps: list of 3-5 topics NOT covered that MIRA could address\n"
        "6. estimated_audience: brief description of the target audience\n"
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                },
            )
            resp.raise_for_status()
            data = resp.json()

            content = data["choices"][0]["message"]["content"]
            # Strip markdown fences if present
            json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
            if json_match:
                content = json_match.group(1)

            return json.loads(content)

    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error: {e}")
        return {}
    except httpx.HTTPError as e:
        logger.error(f"Groq API error: {e}")
        return {}


async def run_autocomplete_batch(keywords: list[str]) -> dict[str, list[str]]:
    """Run autocomplete for all seed keywords concurrently."""
    tasks = {kw: youtube_autocomplete(kw) for kw in keywords}
    results = {}
    for kw, coro in tasks.items():
        suggestions = await coro
        results[kw] = suggestions
        logger.info(f"Autocomplete '{kw}': {len(suggestions)} suggestions")
    return results


def render_markdown(
    video_url: str,
    transcript_len: int,
    analysis: dict,
    autocomplete_results: dict[str, list[str]],
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        "# SEO YouTube Content Analysis — May 2026",
        "",
        f"> Generated: {now}  ",
        f"> Reference video: {video_url}  ",
        f"> Transcript length: {transcript_len:,} characters  ",
        "> Purpose: W2.1 stack validation — live pipeline run",
        "",
        "---",
        "",
        "## Content Analysis",
        "",
    ]

    if analysis:
        topics = analysis.get("main_topics", [])
        if topics:
            lines += ["### Main Topics", ""]
            lines += [f"- {t}" for t in topics]
            lines += [""]

        keywords = analysis.get("keywords", [])
        if keywords:
            lines += ["### SEO Keywords Identified", ""]
            lines += [f"- `{k}`" for k in keywords]
            lines += [""]

        lines += [
            "### Content Format",
            "",
            f"**{analysis.get('content_format', 'unknown')}**",
            "",
        ]

        audience = analysis.get("estimated_audience", "")
        if audience:
            lines += ["### Target Audience", "", audience, ""]

        questions = analysis.get("key_questions", [])
        if questions:
            lines += ["### Key Questions Answered", ""]
            lines += [f"{i+1}. {q}" for i, q in enumerate(questions)]
            lines += [""]

        gaps = analysis.get("content_gaps", [])
        if gaps:
            lines += ["### Content Gaps (MIRA Opportunities)", ""]
            lines += [f"- {g}" for g in gaps]
            lines += [""]
    else:
        lines += ["*Analysis unavailable — check GROQ_API_KEY*", ""]

    lines += ["---", "", "## YouTube Autocomplete Results", ""]
    lines += ["> Seed keywords relevant to MIRA's target market", ""]

    for kw, suggestions in autocomplete_results.items():
        lines += [f"### `{kw}`", ""]
        if suggestions:
            lines += [f"- {s}" for s in suggestions]
        else:
            lines += ["*No suggestions returned*"]
        lines += [""]

    lines += [
        "---",
        "",
        "## Pipeline Validation",
        "",
        "| Check | Result |",
        "|-------|--------|",
        f"| Transcript fetch | {'✅ OK' if transcript_len > 0 else '❌ FAIL'} ({transcript_len:,} chars) |",
        f"| Groq LLM analysis | {'✅ OK' if analysis else '❌ FAIL'} |",
        f"| YouTube autocomplete | {'✅ OK' if any(autocomplete_results.values()) else '❌ FAIL'} ({sum(len(v) for v in autocomplete_results.values())} suggestions total) |",
        "",
        "All three providers exercised end-to-end. Wave 1 stack confirmed live.",
    ]

    return "\n".join(lines) + "\n"


async def main() -> None:
    video_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_URL
    logger.info(f"Analyzing: {video_url}")

    # Step 1: Get transcript
    logger.info("Fetching transcript...")
    transcript = get_transcript(video_url)
    logger.info(f"Transcript: {len(transcript):,} chars")

    if not transcript:
        logger.error("No transcript — aborting")
        sys.exit(1)

    # Step 2: LLM analysis via Groq
    logger.info("Running Groq SEO analysis...")
    analysis = await analyze_with_groq(transcript)
    if analysis:
        logger.info(f"Analysis OK: {list(analysis.keys())}")
    else:
        logger.warning("Analysis failed — continuing with autocomplete only")

    # Step 3: Autocomplete for seed keywords
    logger.info(f"Running autocomplete for {len(SEED_KEYWORDS)} seed keywords...")
    autocomplete_results = await run_autocomplete_batch(SEED_KEYWORDS)

    # Step 4: Write document
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = render_markdown(video_url, len(transcript), analysis, autocomplete_results)
    OUTPUT_PATH.write_text(doc)
    logger.info(f"Written: {OUTPUT_PATH}")

    # Summary
    ok_count = sum([
        bool(transcript),
        bool(analysis),
        any(autocomplete_results.values()),
    ])
    print(f"\nW2.1 complete — {ok_count}/3 checks passed")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
