"""Infographic builder — generates a 480×220 SVG stat card from ContentBrief.

Security note: LLM only provides text values for pre-defined slots.
The SVG structure is a fixed Python template — no arbitrary markup from LLM.
"""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

from mira_seo.models.content import ContentBrief, Infographic

logger = logging.getLogger("mira-seo.infographic-builder")

_PIPELINE_URL = os.getenv("MIRA_PIPELINE_URL", "http://mira-pipeline:9099")
_MODEL = os.getenv("MIRA_DEFAULT_MODEL", "llama-3.3-70b-versatile")


def _escape_svg_text(text: str) -> str:
    """Escape special characters for safe SVG text content."""
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )[:40]  # cap at 40 chars to fit in card


def _render_svg(
    title: str,
    stat1_value: str,
    stat1_label: str,
    stat2_value: str,
    stat2_label: str,
    stat3_value: str,
    stat3_label: str,
) -> str:
    """Fixed SVG template — only pre-escaped text values are interpolated."""
    t = _escape_svg_text(title)
    v1, l1 = _escape_svg_text(stat1_value), _escape_svg_text(stat1_label)
    v2, l2 = _escape_svg_text(stat2_value), _escape_svg_text(stat2_label)
    v3, l3 = _escape_svg_text(stat3_value), _escape_svg_text(stat3_label)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 220" width="480" height="220" role="img" aria-label="{t}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="480" height="220" rx="12" fill="url(#bg)"/>
  <text x="24" y="36" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#94a3b8" letter-spacing="1.5" text-transform="uppercase">{t}</text>
  <line x1="24" y1="48" x2="456" y2="48" stroke="#334155" stroke-width="1"/>
  <!-- Stat 1 -->
  <text x="80" y="115" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="#22c55e" text-anchor="middle">{v1}</text>
  <text x="80" y="140" font-family="system-ui,sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">{l1}</text>
  <!-- Divider -->
  <line x1="160" y1="72" x2="160" y2="168" stroke="#334155" stroke-width="1"/>
  <!-- Stat 2 -->
  <text x="240" y="115" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="#38bdf8" text-anchor="middle">{v2}</text>
  <text x="240" y="140" font-family="system-ui,sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">{l2}</text>
  <!-- Divider -->
  <line x1="320" y1="72" x2="320" y2="168" stroke="#334155" stroke-width="1"/>
  <!-- Stat 3 -->
  <text x="400" y="115" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="#f59e0b" text-anchor="middle">{v3}</text>
  <text x="400" y="140" font-family="system-ui,sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">{l3}</text>
  <!-- Footer -->
  <text x="240" y="198" font-family="system-ui,sans-serif" font-size="10" fill="#475569" text-anchor="middle">factorylm.com</text>
</svg>"""


async def _extract_stats(brief: ContentBrief) -> dict:
    """Use Groq to extract 3 key statistics from the source stories."""
    sources = "\n".join(f"- {item.title}: {item.summary[:300]}" for item in brief.stories)
    prompt = f"""Extract exactly 3 key statistics or data points from these industrial maintenance news stories.
Focus on numbers, percentages, or time values that would resonate with maintenance managers.

Stories:
{sources}

Topic: {brief.keyword}

Respond with ONLY valid JSON (no markdown):
{{
  "title": "Short card title (max 35 chars, e.g. 'VFD Failures: Key Stats 2026')",
  "stat1_value": "e.g. '23%'",
  "stat1_label": "e.g. 'Failure increase Q1'",
  "stat2_value": "e.g. '$47K'",
  "stat2_label": "e.g. 'Avg. downtime cost'",
  "stat3_value": "e.g. '3.2x'",
  "stat3_label": "e.g. 'ROI with predictive'",
  "alt": "Plain-text alt description of the infographic"
}}

If no real statistics found in stories, create plausible industry-standard stats for {brief.keyword}.
All values must be SHORT enough to fit in a small card (max 8 chars for values, 20 chars for labels)."""

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{_PIPELINE_URL}/v1/chat/completions",
                json={
                    "model": _MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 300,
                },
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.error("Infographic LLM call failed: %s — using defaults", exc)
        return _default_stats(brief.keyword)

    raw = re.sub(r"```(?:json)?\n?", "", raw).strip().rstrip("```").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error("Infographic: invalid JSON from LLM — using defaults")
        return _default_stats(brief.keyword)


def _default_stats(keyword: str) -> dict:
    return {
        "title": f"Industry Stats: {keyword[:25]}",
        "stat1_value": "47%",
        "stat1_label": "Unplanned downtime",
        "stat2_value": "$260K",
        "stat2_label": "Avg. annual cost",
        "stat3_value": "3.5x",
        "stat3_label": "ROI w/ AI maintenance",
        "alt": f"Key statistics for {keyword}",
    }


async def build_infographic(brief: ContentBrief) -> Infographic:
    """Generate a 3-stat SVG infographic card from ContentBrief.

    LLM extracts stats; Python template renders safe SVG.
    """
    stats = await _extract_stats(brief)

    svg = _render_svg(
        title=stats.get("title", f"Stats: {brief.keyword[:25]}"),
        stat1_value=stats.get("stat1_value", "—"),
        stat1_label=stats.get("stat1_label", ""),
        stat2_value=stats.get("stat2_value", "—"),
        stat2_label=stats.get("stat2_label", ""),
        stat3_value=stats.get("stat3_value", "—"),
        stat3_label=stats.get("stat3_label", ""),
    )

    alt = stats.get("alt", f"Key statistics: {brief.keyword}")
    logger.info(
        "Built infographic for keyword=%r (%d bytes SVG)",
        brief.keyword,
        len(svg),
    )
    return Infographic(svg_content=svg, alt=alt)
