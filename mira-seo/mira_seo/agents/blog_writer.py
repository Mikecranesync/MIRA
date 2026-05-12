"""Blog writer agent — generates BlogPost JSON from ContentBrief via Groq LLM."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date

import httpx

from mira_seo.models.content import BlogPost, BlogSection, ContentBrief

logger = logging.getLogger("mira-seo.blog-writer")

_PIPELINE_URL = os.getenv("MIRA_PIPELINE_URL", "http://mira-pipeline:9099")
_MODEL = os.getenv("MIRA_DEFAULT_MODEL", "llama-3.3-70b-versatile")


def _slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    import unicodedata

    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:80]


def _build_prompt(brief: ContentBrief) -> str:
    sources = "\n".join(
        f"- [{item.source}] {item.title}: {item.summary[:300]}" for item in brief.stories
    )
    today = date.today().isoformat()

    return f"""You are an expert technical writer for FactoryLM — an AI-powered industrial maintenance platform targeting maintenance managers and technicians.

Write a 600-1000 word SEO-optimized blog post for the keyword: "{brief.keyword}"

Source material (USE THESE — ground the post in real facts):
{sources}

Post type: {brief.post_type}
Angle: {brief.angle}
Today's date: {today}

OUTPUT FORMAT: respond with ONLY valid JSON (no markdown fences, no explanation):
{{
  "slug": "url-safe-slug-max-80-chars",
  "title": "SEO title (50-60 chars)",
  "description": "Meta description (150-160 chars), include keyword naturally",
  "category": "one of: Guides | Industry News | Product | Case Studies | Tips",
  "readingTime": "X min read",
  "heroEmoji": "single relevant emoji",
  "sections": [
    {{"type": "paragraph", "text": "Opening paragraph with keyword in first 100 words..."}},
    {{"type": "heading", "text": "Section Heading"}},
    {{"type": "paragraph", "text": "Body content..."}},
    {{"type": "list", "items": ["Point 1", "Point 2", "Point 3"], "ordered": false}},
    {{"type": "callout", "variant": "tip", "text": "Key takeaway or action item"}},
    {{"type": "paragraph", "text": "CTA paragraph mentioning MIRA/FactoryLM naturally..."}}
  ],
  "relatedPosts": [],
  "relatedFaultCodes": []
}}

Rules:
- 5-7 sections minimum
- Include at least 1 list and 1 callout section
- Ground claims in the source material — cite specific sources inline in paragraph text
- Include keyword in title, first paragraph, and at least one heading
- End with a soft CTA to try MIRA at factorylm.com
- author field will be added automatically — DO NOT include it in output
- heroEmoji must be a single Unicode emoji character
"""


async def write_blog(brief: ContentBrief) -> BlogPost:
    """Generate a BlogPost from ContentBrief via Groq LLM.

    Returns BlogPost. On LLM failure raises RuntimeError.
    """
    prompt = _build_prompt(brief)
    today = date.today().isoformat()

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{_PIPELINE_URL}/v1/chat/completions",
                json={
                    "model": _MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4,
                    "max_tokens": 2500,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        raise RuntimeError(f"Blog writer LLM call failed: {exc}") from exc

    # Strip markdown code fences
    raw = re.sub(r"```(?:json)?\n?", "", raw).strip().rstrip("```").strip()
    # Strip any leading/trailing content outside the JSON object
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Blog writer returned invalid JSON: {exc}\nRaw: {raw[:500]}") from exc

    # Ensure required fields
    data.setdefault("date", today)
    data.setdefault("author", "FactoryLM Engineering")
    data.setdefault("relatedPosts", [])
    data.setdefault("relatedFaultCodes", [])

    # Auto-generate slug if not provided or empty
    if not data.get("slug"):
        data["slug"] = _slugify(f"{brief.keyword}-{today}")

    # Parse sections
    sections = [BlogSection(**s) for s in data.get("sections", [])]
    if not sections:
        raise RuntimeError("Blog writer returned no sections")

    post = BlogPost(
        slug=data["slug"],
        title=data["title"],
        description=data["description"],
        date=data["date"],
        author=data["author"],
        category=data.get("category", "Guides"),
        readingTime=data.get("readingTime", "5 min read"),
        heroEmoji=data.get("heroEmoji", "📝"),
        sections=sections,
        relatedPosts=data.get("relatedPosts", []),
        relatedFaultCodes=data.get("relatedFaultCodes", []),
    )

    logger.info("Generated blog post: slug=%s title=%r", post.slug, post.title)
    return post
