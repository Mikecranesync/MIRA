"""Content Fleet — automated marketing content generation via Claude API.

Generates blog posts, social posts, email variants, and YouTube scripts
on a schedule. Outputs to mira_copy/outputs/ for human review. Tracks
state in NeonDB content_items table.

Reuses mira_copy.client (Claude API wrapper) and mira_copy.generate
(prompt loading + rendering) — same code as the CLI tool.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.content")

# Rotating topic bank for automatic content generation
TOPIC_BANK = [
    "powerflex-525-f004-undervoltage",
    "gs20-overcurrent-fault",
    "hydraulic-low-pressure-troubleshooting",
    "micro820-ethernet-no-comms",
    "powerflex-525-f005-overvoltage",
    "gs20-ground-fault",
    "hydraulic-cylinder-drift",
    "vfd-parameter-setup-basics",
    "motor-megger-testing-guide",
    "hydraulic-suction-strainer-maintenance",
    "powerflex-525-f033-overtemp",
    "gs10-programming-quickstart",
]

SOCIAL_THEMES = [
    "fault-code-tip",
    "ai-vs-manual",
    "build-in-public",
    "poll-engagement",
    "case-study",
]


def _run_async(coro):
    """Run an async function from a sync Celery task."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _insert_content_item(content_type, audience, topic, title, slug, output_path, word_count):
    """Insert a content tracking row into NeonDB."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        db_url = os.getenv("NEON_DATABASE_URL", "")
        if not db_url:
            logger.warning("NEON_DATABASE_URL not set — skipping content tracking")
            return None

        engine = create_engine(db_url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS content_items (
                    id          SERIAL PRIMARY KEY,
                    content_type TEXT NOT NULL,
                    audience    TEXT NOT NULL,
                    topic       TEXT,
                    title       TEXT,
                    slug        TEXT,
                    status      TEXT NOT NULL DEFAULT 'draft',
                    output_path TEXT,
                    word_count  INT,
                    created_at  TIMESTAMPTZ DEFAULT NOW(),
                    published_at TIMESTAMPTZ
                )
            """))
            result = conn.execute(
                text("""
                    INSERT INTO content_items (content_type, audience, topic, title, slug, output_path, word_count)
                    VALUES (:ct, :aud, :topic, :title, :slug, :path, :wc)
                    RETURNING id
                """),
                {
                    "ct": content_type, "aud": audience, "topic": topic,
                    "title": title or "", "slug": slug or "",
                    "path": output_path or "", "wc": word_count or 0,
                },
            )
            conn.commit()
            row = result.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.error("Failed to insert content_item: %s", e)
        return None


def _insert_social_items(content_item_id, posts):
    """Insert social post tracking rows into NeonDB."""
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        db_url = os.getenv("NEON_DATABASE_URL", "")
        if not db_url:
            return

        engine = create_engine(db_url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS social_items (
                    id          SERIAL PRIMARY KEY,
                    content_item_id INT,
                    platform    TEXT NOT NULL,
                    body_text   TEXT NOT NULL,
                    char_count  INT,
                    status      TEXT NOT NULL DEFAULT 'draft',
                    buffer_post_id TEXT,
                    scheduled_for TIMESTAMPTZ,
                    created_at  TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            for post in posts:
                conn.execute(
                    text("""
                        INSERT INTO social_items (content_item_id, platform, body_text, char_count)
                        VALUES (:cid, :platform, :text, :chars)
                    """),
                    {
                        "cid": content_item_id,
                        "platform": post.get("platform", ""),
                        "text": post.get("text", ""),
                        "chars": post.get("char_count", 0),
                    },
                )
            conn.commit()
    except Exception as e:
        logger.error("Failed to insert social_items: %s", e)


@app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_blog_post(self, audience: str, topic: str | None = None):
    """Generate an SEO blog post via Claude API.

    If no topic provided, picks randomly from the topic bank.
    Output: mira_copy/outputs/blog-post/{audience}/{topic}.md
    """
    from mira_copy.generate import generate as gen

    if not topic:
        topic = random.choice(TOPIC_BANK)

    logger.info("Generating blog post: audience=%s topic=%s", audience, topic)

    try:
        result = _run_async(gen("blog-post", audience, topic))
    except Exception as exc:
        logger.error("Blog post generation failed: %s", exc)
        raise self.retry(exc=exc)

    title = result.raw_json.get("title", "")
    slug = result.raw_json.get("slug", topic)
    word_count = result.raw_json.get("word_count", len(result.rendered_md.split()))

    content_id = _insert_content_item(
        "blog-post", audience, topic, title, slug,
        str(result.rendered_md[:100]), word_count,
    )

    logger.info(
        "Blog post generated: id=%s title='%s' words=%d tokens_in=%d tokens_out=%d",
        content_id, title, word_count,
        result.usage.get("input_tokens", 0), result.usage.get("output_tokens", 0),
    )

    return {
        "content_id": content_id,
        "title": title,
        "slug": slug,
        "word_count": word_count,
        "audience": audience,
        "topic": topic,
    }


@app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_social_batch(self, audience: str, theme: str | None = None):
    """Generate social posts for all 6 platforms in one Claude call.

    Output: mira_copy/outputs/social/{audience}/{theme}.md
    """
    from mira_copy.generate import generate as gen

    if not theme:
        theme = random.choice(SOCIAL_THEMES)

    logger.info("Generating social batch: audience=%s theme=%s", audience, theme)

    try:
        result = _run_async(gen("social-batch", audience, theme))
    except Exception as exc:
        logger.error("Social batch generation failed: %s", exc)
        raise self.retry(exc=exc)

    posts = result.raw_json.get("posts", [])
    content_id = _insert_content_item(
        "social", audience, theme, f"Social batch: {theme}", theme,
        f"social/{audience}/{theme}.md", 0,
    )

    if posts and content_id:
        _insert_social_items(content_id, posts)

    platforms = [p.get("platform", "?") for p in posts]
    logger.info(
        "Social batch generated: id=%s theme=%s platforms=%s tokens_in=%d tokens_out=%d",
        content_id, theme, platforms,
        result.usage.get("input_tokens", 0), result.usage.get("output_tokens", 0),
    )

    return {
        "content_id": content_id,
        "theme": theme,
        "audience": audience,
        "post_count": len(posts),
        "platforms": platforms,
    }


@app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_email_variant(self, audience: str, email_type: str, variant_label: str = "B"):
    """Generate an A/B variant of a drip email.

    Output: mira_copy/outputs/drip-email/{audience}/{email_type}_variant_{label}.html
    """
    from mira_copy.generate import generate as gen

    variant_key = f"{email_type}_variant_{variant_label}"
    logger.info("Generating email variant: audience=%s type=%s label=%s", audience, email_type, variant_label)

    try:
        result = _run_async(gen("drip-email", audience, email_type))
    except Exception as exc:
        logger.error("Email variant generation failed: %s", exc)
        raise self.retry(exc=exc)

    subject = result.raw_json.get("subject", "")
    content_id = _insert_content_item(
        "email", audience, email_type, subject, variant_key,
        f"drip-email/{audience}/{variant_key}.html", 0,
    )

    logger.info("Email variant generated: id=%s subject='%s'", content_id, subject)

    return {
        "content_id": content_id,
        "subject": subject,
        "preview_text": result.raw_json.get("preview_text", ""),
        "variant": variant_label,
        "audience": audience,
    }


@app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_weekly_video_script(self, audience: str, topic: str | None = None):
    """Generate a full YouTube script package via Claude API.

    Includes: title options, chapter outline, full script, description,
    thumbnail prompt, pinned comment, and tags.

    Output: mira_copy/outputs/video-script/{audience}/{topic}.md
    """
    from mira_copy.generate import generate as gen

    if not topic:
        topic = random.choice(TOPIC_BANK[:6])

    logger.info("Generating video script: audience=%s topic=%s", audience, topic)

    try:
        result = _run_async(gen("video-script", audience, topic))
    except Exception as exc:
        logger.error("Video script generation failed: %s", exc)
        raise self.retry(exc=exc)

    title_options = result.raw_json.get("title_options", [])
    duration = result.raw_json.get("total_duration_estimate", "10:00")

    content_id = _insert_content_item(
        "video-script", audience, topic,
        title_options[0] if title_options else topic,
        topic, f"video-script/{audience}/{topic}.md", 0,
    )

    logger.info(
        "Video script generated: id=%s titles=%s duration=%s",
        content_id, title_options, duration,
    )

    return {
        "content_id": content_id,
        "title_options": title_options,
        "duration_estimate": duration,
        "audience": audience,
        "topic": topic,
    }
