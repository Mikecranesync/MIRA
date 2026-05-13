"""Daily content pipeline — orchestrates fetch → generate → notify → publish."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date
from pathlib import Path

from mira_seo.agents.blog_writer import write_blog
from mira_seo.agents.infographic_builder import build_infographic
from mira_seo.agents.linkedin_writer import write_linkedin
from mira_seo.agents.news_curator import curate
from mira_seo.models.content import DraftPayload, MediumExcerpt, MetricsSnapshot
from mira_seo.providers.gsc_client import GSCClient
from mira_seo.providers.openpagerank import OpenPageRankClient
from mira_seo.providers.rss_scraper import fetch_feeds
from mira_seo.tools import (
    linkedin_publisher,
    medium_publisher,
    metrics_reporter,
    neon_publisher,
    telegram_notifier,
)

logger = logging.getLogger("mira-seo.daily-content")

_FEEDS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "feeds.yml"
_SITE_URL = "https://factorylm.com"


def _build_medium_excerpt(payload: DraftPayload) -> MediumExcerpt:
    blog = payload.blog_post
    # Extract first paragraph section as Medium content
    content_parts = []
    for section in blog.sections[:6]:
        if section.type == "paragraph" and section.text:
            content_parts.append(section.text)
        elif section.type == "heading" and section.text:
            content_parts.append(f"## {section.text}")
    content = "\n\n".join(content_parts[:4])
    return MediumExcerpt(
        title=blog.title,
        content=content or blog.description,
        canonical_url=f"{_SITE_URL}/blog/{blog.slug}",
        tags=[payload.brief.keyword.split()[0], "industrial", "maintenance", "factorylm"],
    )


async def _run_pipeline() -> dict:
    """Execute the full content generation pipeline. Returns summary dict."""
    today = date.today().isoformat()
    enabled = os.getenv("DAILY_CONTENT_ENABLED", "false").lower() == "true"
    if not enabled:
        logger.info("DAILY_CONTENT_ENABLED not set — dry-run mode")

    # ── Step 1: Parallel data fetch ─────────────────────────────────────────
    gsc = GSCClient()
    opr = OpenPageRankClient()

    feeds_task = asyncio.create_task(fetch_feeds(_FEEDS_CONFIG))
    gsc_task = asyncio.create_task(asyncio.to_thread(gsc.get_top_queries))
    opr_task = asyncio.create_task(asyncio.to_thread(opr.get_domain_rank, "factorylm.com"))

    stories, gsc_data, opr_data = await asyncio.gather(feeds_task, gsc_task, opr_task, return_exceptions=True)

    if isinstance(stories, Exception) or not stories:
        logger.error("RSS fetch failed or returned no stories: %s", stories)
        return {"status": "error", "reason": "rss_fetch_failed"}

    gsc_data = {} if isinstance(gsc_data, Exception) else gsc_data
    opr_data = {} if isinstance(opr_data, Exception) else opr_data

    # ── Step 2: Curate top 3 stories ────────────────────────────────────────
    brief = await curate(stories)

    # ── Step 3: Parallel content generation ─────────────────────────────────
    blog_post = await write_blog(brief)

    linkedin_post, infographic = await asyncio.gather(
        write_linkedin(brief, blog_post),
        asyncio.to_thread(build_infographic, brief),
    )

    # ── Step 4: Build metrics snapshot ──────────────────────────────────────
    top_row = (gsc_data.get("rows") or [{}])[0] if isinstance(gsc_data, dict) else {}
    snap = MetricsSnapshot(
        gsc_top_query=top_row.get("keys", [""])[0] if top_row else "",
        gsc_clicks_7d=sum(r.get("clicks", 0) for r in gsc_data.get("rows", [])) if isinstance(gsc_data, dict) else 0,
        gsc_impressions_7d=sum(r.get("impressions", 0) for r in gsc_data.get("rows", [])) if isinstance(gsc_data, dict) else 0,
        gsc_top_position=top_row.get("position", 0.0) if top_row else 0.0,
        domain_authority=opr_data.get("page_rank_decimal", 0.0) if isinstance(opr_data, dict) else 0.0,
    )

    # ── Step 5: Build full payload ───────────────────────────────────────────
    payload = DraftPayload(
        blog_post=blog_post,
        linkedin_post=linkedin_post,
        medium_excerpt=_build_medium_excerpt(
            DraftPayload(
                blog_post=blog_post,
                linkedin_post=linkedin_post,
                medium_excerpt=MediumExcerpt(title="", content="", canonical_url=""),
                infographic=infographic,
                feed_sources=brief.stories,
                brief=brief,
                metrics_snapshot=snap,
            )
        ),
        infographic=infographic,
        feed_sources=brief.stories,
        brief=brief,
        metrics_snapshot=snap,
    )

    # ── Step 6: Store in NeonDB ──────────────────────────────────────────────
    draft_id = await neon_publisher.insert_draft(payload, blog_post.slug)

    # ── Step 7: Send Telegram preview ───────────────────────────────────────
    msg_id = await telegram_notifier.send_draft_preview(draft_id, payload)
    if msg_id:
        await neon_publisher.store_telegram_msg_id(draft_id, msg_id)

    # ── Step 8: Write metrics report ────────────────────────────────────────
    metrics_reporter.write_and_commit(today, payload)

    logger.info(
        "Daily pipeline complete — draft=%s slug=%s keyword=%s",
        draft_id,
        blog_post.slug,
        brief.keyword,
    )
    return {
        "status": "ok",
        "draft_id": draft_id,
        "slug": blog_post.slug,
        "keyword": brief.keyword,
        "telegram_msg_id": msg_id,
    }


async def _publish_draft(draft_id: str, reject: bool = False) -> dict:
    """Publish or reject an approved draft."""
    if reject:
        await neon_publisher.set_status(draft_id, "rejected")
        logger.info("Draft %s rejected", draft_id)
        return {"status": "rejected", "draft_id": draft_id}

    payload = await neon_publisher.get_draft(draft_id)
    await neon_publisher.set_status(draft_id, "live")

    linkedin_ok = await linkedin_publisher.publish(payload.linkedin_post)
    medium_url = await medium_publisher.publish(payload.medium_excerpt)

    blog_url = f"{_SITE_URL}/blog/{payload.blog_post.slug}"
    logger.info("Draft %s published — blog=%s linkedin=%s medium=%s", draft_id, blog_url, linkedin_ok, medium_url)

    return {
        "status": "live",
        "draft_id": draft_id,
        "blog_url": blog_url,
        "linkedin_ok": linkedin_ok,
        "medium_url": medium_url,
    }


# ── Celery task wrappers ─────────────────────────────────────────────────────
try:
    from mira_seo.main import celery_app  # type: ignore[import]

    @celery_app.task(name="mira_seo.tasks.daily_content.run", bind=True, max_retries=2)
    def run(self):  # type: ignore[no-untyped-def]
        """Daily content pipeline Celery task."""
        try:
            return asyncio.run(_run_pipeline())
        except Exception as exc:
            logger.exception("Daily pipeline failed: %s", exc)
            raise self.retry(exc=exc, countdown=300)

    @celery_app.task(name="mira_seo.tasks.daily_content.publish_approved")
    def publish_approved(draft_id: str, reject: bool = False) -> dict:
        """Publish or reject an approved draft."""
        return asyncio.run(_publish_draft(draft_id, reject=reject))

except Exception:
    # Allow import without Celery (e.g. tests)
    logger.warning("Celery not available — task wrappers skipped")
