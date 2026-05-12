"""News curator agent — picks top 3 stories and determines content brief via Groq LLM."""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

from mira_seo.models.content import ContentBrief, FeedItem

logger = logging.getLogger("mira-seo.news-curator")

_PIPELINE_URL = os.getenv("MIRA_PIPELINE_URL", "http://mira-pipeline:9099")
_MODEL = os.getenv("MIRA_DEFAULT_MODEL", "llama-3.3-70b-versatile")
_PROBLEM_AWARE_KEYWORDS = [
    "troubleshooting",
    "failure",
    "fault",
    "repair",
    "fix",
    "broken",
    "downtime",
    "root cause",
    "diagnosis",
    "maintenance issue",
    "equipment problem",
]
_PRODUCT_AWARE_KEYWORDS = [
    "CMMS",
    "predictive maintenance",
    "AI maintenance",
    "maintenance software",
    "work order",
    "asset management",
    "preventive maintenance software",
]


def _classify_angle(keyword: str) -> str:
    kw_lower = keyword.lower()
    if any(p in kw_lower for p in _PROBLEM_AWARE_KEYWORDS):
        return "problem-aware"
    if any(p in kw_lower for p in _PRODUCT_AWARE_KEYWORDS):
        return "product-aware"
    # default 60/40 split via deterministic hash
    return "problem-aware" if hash(keyword) % 10 < 6 else "product-aware"


def _build_prompt(stories: list[FeedItem]) -> str:
    story_list = "\n".join(
        f"{i + 1}. [{item.source}] {item.title} — {item.summary[:200]}"
        for i, item in enumerate(stories)
    )
    return f"""You are an SEO content strategist for FactoryLM — an AI-powered industrial maintenance platform.

Given these recent industry stories:
{story_list}

Select the top 3 most relevant and timely stories for our audience (industrial maintenance managers and technicians). Then generate a content brief.

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "selected_indices": [0, 1, 2],  // 0-based indices from the list above
  "keyword": "the primary SEO keyword to target (e.g. 'VFD fault codes 2026')",
  "post_type": "one of: how_to | pain_story | case_study | myth_bust | insight | news_roundup",
  "reasoning": "1-2 sentences on why these stories and this keyword"
}}

Rules:
- keyword must be 2-6 words, specific, searchable
- target 60% problem-aware (troubleshooting, failures, repair guides) and 40% product-aware (CMMS, AI maintenance tools)
- prefer stories with concrete numbers, recent dates, or industrial equipment specifics
"""


async def curate(stories: list[FeedItem]) -> ContentBrief:
    """Pick top 3 stories and determine keyword + angle via Groq LLM.

    Returns ContentBrief. Falls back to first 3 stories if LLM fails.
    """
    if not stories:
        raise ValueError("No stories provided for curation")

    prompt = _build_prompt(stories)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_PIPELINE_URL}/v1/chat/completions",
                json={
                    "model": _MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 300,
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.error("LLM call failed: %s — falling back to first 3 stories", exc)
        return ContentBrief(
            stories=stories[:3],
            keyword="industrial maintenance AI 2026",
            angle="problem-aware",
            post_type="insight",
        )

    # Strip markdown code fences if present
    content = re.sub(r"```(?:json)?\n?", "", content).strip().rstrip("```").strip()

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        logger.error("Failed to parse LLM response as JSON: %s", content[:200])
        return ContentBrief(
            stories=stories[:3],
            keyword="industrial maintenance AI 2026",
            angle="problem-aware",
            post_type="insight",
        )

    selected_indices = data.get("selected_indices", [0, 1, 2])
    selected = [stories[i] for i in selected_indices if i < len(stories)][:3]
    if len(selected) < 3:
        selected += stories[: 3 - len(selected)]

    keyword = data.get("keyword", "industrial maintenance 2026")
    angle = _classify_angle(keyword)

    logger.info("Curated: keyword=%r angle=%s post_type=%s", keyword, angle, data.get("post_type"))

    return ContentBrief(
        stories=selected,
        keyword=keyword,
        angle=angle,  # type: ignore[arg-type]
        post_type=data.get("post_type", "insight"),
    )
