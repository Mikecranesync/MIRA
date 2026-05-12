"""LinkedIn writer agent — generates a LinkedIn post from ContentBrief + BlogPost via Groq LLM."""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

from mira_seo.models.content import BlogPost, ContentBrief, LinkedInPost

logger = logging.getLogger("mira-seo.linkedin-writer")

_PIPELINE_URL = os.getenv("MIRA_PIPELINE_URL", "http://mira-pipeline:9099")
_MODEL = os.getenv("MIRA_DEFAULT_MODEL", "llama-3.3-70b-versatile")
_SITE_URL = "https://factorylm.com"


def _build_prompt(brief: ContentBrief, post: BlogPost) -> str:
    sources_text = " | ".join(item.source for item in brief.stories)
    return f"""You are a B2B content writer for FactoryLM — an AI-powered industrial maintenance platform.

Write a LinkedIn post based on this blog article:
Title: {post.title}
Keyword: {brief.keyword}
Post type: {brief.post_type}
Source stories from: {sources_text}

Blog URL: {_SITE_URL}/blog/{post.slug}

OUTPUT: respond with ONLY valid JSON (no markdown):
{{
  "text": "The full LinkedIn post text — plain text only, NO markdown, NO hashtags in body",
  "hashtags": ["IndustrialMaintenance", "CMMS", "PredictiveMaintenance"]
}}

LinkedIn post rules:
- 200-500 characters for the post text (EXCLUDING hashtags)
- Start with a strong hook (surprising stat, provocative question, or bold claim)
- 1-3 short paragraphs max
- End with: "Full breakdown → {_SITE_URL}/blog/{post.slug}"
- 3-5 hashtags (no # in the hashtags array — just the word)
- NO markdown (no **bold**, no bullet points with -, no headers)
- Plain text only — LinkedIn renders line breaks, not markdown
- Speak to maintenance managers and reliability engineers
"""


async def write_linkedin(brief: ContentBrief, post: BlogPost) -> LinkedInPost:
    """Generate a LinkedIn post from ContentBrief + BlogPost via Groq LLM.

    Falls back to a template-based post if LLM fails.
    """
    prompt = _build_prompt(brief, post)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_PIPELINE_URL}/v1/chat/completions",
                json={
                    "model": _MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.5,
                    "max_tokens": 500,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.error("LinkedIn writer LLM call failed: %s — using fallback", exc)
        return _fallback_post(brief, post)

    raw = re.sub(r"```(?:json)?\n?", "", raw).strip().rstrip("```").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("LinkedIn writer returned invalid JSON — using fallback")
        return _fallback_post(brief, post)

    text = data.get("text", "").strip()
    hashtags = data.get("hashtags", ["IndustrialMaintenance", "CMMS"])

    # Enforce character limit
    if len(text) > 2900:
        text = text[:2900] + "..."

    li_post = LinkedInPost(text=text, hashtags=hashtags)
    logger.info("Generated LinkedIn post: %d chars, %d hashtags", li_post.char_count, len(hashtags))
    return li_post


def _fallback_post(brief: ContentBrief, post: BlogPost) -> LinkedInPost:
    text = (
        f"New on the FactoryLM blog: {post.title}\n\n"
        f"We break down {brief.keyword} — what's changing and what it means for maintenance teams.\n\n"
        f"Full article → {_SITE_URL}/blog/{post.slug}"
    )
    return LinkedInPost(
        text=text,
        hashtags=["IndustrialMaintenance", "CMMS", "PredictiveMaintenance"],
    )
