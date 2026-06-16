"""Social Fleet — scheduling, cross-posting, and engagement reporting.

Handles pushing approved content to Buffer API for scheduled posting,
adapting content across platforms, and generating weekly reports.
"""

from __future__ import annotations

import logging
import os

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.social")

BUFFER_API_URL = "https://api.bufferapp.com/1"

PLATFORM_CHAR_LIMITS = {
    "linkedin": 3000,
    "x": 280,
    "reddit": 40000,
    "facebook": 63206,
    "tiktok": 2200,
    "instagram": 2200,
}


def _get_buffer_token() -> str:
    """Get Buffer access token from env."""
    return os.getenv("BUFFER_ACCESS_TOKEN", "")


def _get_approved_social_items():
    """Fetch social items with status='approved' from NeonDB."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        db_url = os.getenv("NEON_DATABASE_URL", "")
        if not db_url:
            return []

        engine = create_engine(db_url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT id, platform, body_text, char_count FROM social_items "
                "WHERE status = 'approved' ORDER BY created_at"
            ))
            return [dict(row._mapping) for row in result]
    except Exception as e:
        logger.error("Failed to fetch approved social items: %s", e)
        return []


def _update_social_item_status(item_id, status, buffer_post_id=None):
    """Update a social item's status in NeonDB."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        db_url = os.getenv("NEON_DATABASE_URL", "")
        if not db_url:
            return

        engine = create_engine(db_url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            if buffer_post_id:
                conn.execute(text(
                    "UPDATE social_items SET status = :status, buffer_post_id = :bid "
                    "WHERE id = :id"
                ), {"status": status, "bid": buffer_post_id, "id": item_id})
            else:
                conn.execute(text(
                    "UPDATE social_items SET status = :status WHERE id = :id"
                ), {"status": status, "id": item_id})
            conn.commit()
    except Exception as e:
        logger.error("Failed to update social item %s: %s", item_id, e)


@app.task
def schedule_buffer_posts():
    """Push approved social items to Buffer for scheduled posting.

    Reads items with status='approved' from NeonDB, POSTs to Buffer API,
    and updates status to 'scheduled'.

    Requires BUFFER_ACCESS_TOKEN env var.
    """
    token = _get_buffer_token()
    if not token:
        logger.warning("BUFFER_ACCESS_TOKEN not set — skipping Buffer scheduling")
        return {"scheduled": 0, "failed": 0, "skipped_no_token": True}

    items = _get_approved_social_items()
    if not items:
        logger.info("No approved social items to schedule")
        return {"scheduled": 0, "failed": 0}

    scheduled = 0
    failed = 0

    with httpx.Client(timeout=30) as client:
        for item in items:
            try:
                resp = client.post(
                    f"{BUFFER_API_URL}/updates/create.json",
                    data={
                        "access_token": token,
                        "text": item["body_text"],
                        "profile_ids[]": os.getenv(
                            f"BUFFER_PROFILE_{item['platform'].upper()}", ""
                        ),
                        "now": "false",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                buffer_id = data.get("updates", [{}])[0].get("id", "")
                _update_social_item_status(item["id"], "scheduled", buffer_id)
                scheduled += 1
                logger.info(
                    "Scheduled to Buffer: platform=%s buffer_id=%s",
                    item["platform"], buffer_id,
                )
            except Exception as e:
                logger.error(
                    "Buffer scheduling failed for item %s (%s): %s",
                    item["id"], item["platform"], e,
                )
                failed += 1

    logger.info("Buffer scheduling complete: scheduled=%d failed=%d", scheduled, failed)
    return {"scheduled": scheduled, "failed": failed}


@app.task(bind=True, max_retries=2, default_retry_delay=30)
def cross_post_content(self, source_platform: str, source_text: str,
                       target_platforms: list[str] | None = None):
    """Adapt content from one platform for others via Claude.

    Takes content written for source_platform and rewrites it for each
    target platform, respecting character limits and cultural norms.
    """
    import asyncio

    from mira_copy.client import complete

    if not target_platforms:
        target_platforms = [p for p in PLATFORM_CHAR_LIMITS if p != source_platform]

    system = (
        "You are a social media copywriter for FactoryLM, an AI maintenance tool. "
        "Adapt the following content for different platforms. "
        "Each adaptation must feel native to the platform, not copy-pasted. "
        "Return JSON: {\"adaptations\": [{\"platform\": str, \"text\": str, \"char_count\": int}]}"
    )

    user = (
        f"Original content (written for {source_platform}):\n\n{source_text}\n\n"
        f"Adapt for: {', '.join(target_platforms)}\n\n"
        f"Character limits: {', '.join(f'{p}: {PLATFORM_CHAR_LIMITS[p]}' for p in target_platforms)}\n\n"
        "Return valid JSON only."
    )

    try:
        raw, usage = asyncio.run(complete(system, user))
        from mira_copy.client import extract_json
        data = extract_json(raw)
    except Exception as exc:
        logger.error("Cross-post generation failed: %s", exc)
        raise self.retry(exc=exc)

    adaptations = data.get("adaptations", [])
    logger.info(
        "Cross-posted from %s to %d platforms, tokens_in=%d tokens_out=%d",
        source_platform, len(adaptations),
        usage.get("input_tokens", 0), usage.get("output_tokens", 0),
    )

    return {
        "source_platform": source_platform,
        "adaptations": adaptations,
    }


@app.task
def social_engagement_report(days: int = 7):
    """Generate a weekly social engagement summary.

    Queries NeonDB for content generation stats and optionally
    Buffer API for post performance.
    """
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        db_url = os.getenv("NEON_DATABASE_URL", "")
        if not db_url:
            return {"error": "NEON_DATABASE_URL not set"}

        engine = create_engine(db_url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            # Content stats
            content_rows = conn.execute(text(
                "SELECT content_type, status, COUNT(*) as cnt "
                "FROM content_items "
                "WHERE created_at > NOW() - INTERVAL ':days days' "
                "GROUP BY content_type, status"
            ).bindparams(days=days))
            content_stats = [dict(r._mapping) for r in content_rows]

            # Social stats
            social_rows = conn.execute(text(
                "SELECT platform, status, COUNT(*) as cnt "
                "FROM social_items "
                "WHERE created_at > NOW() - INTERVAL ':days days' "
                "GROUP BY platform, status"
            ).bindparams(days=days))
            social_stats = [dict(r._mapping) for r in social_rows]

    except Exception as e:
        logger.error("Engagement report query failed: %s", e)
        content_stats = []
        social_stats = []

    report = {
        "period_days": days,
        "content_items": content_stats,
        "social_items": social_stats,
    }

    logger.info("Social engagement report: %s", report)
    return report
