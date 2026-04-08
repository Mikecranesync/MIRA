"""Celery configuration for mira-crawler workers.

All settings overridable via environment variables where noted.
"""

from __future__ import annotations

from celery.schedules import crontab

# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]
timezone = "UTC"
enable_utc = True

# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

worker_concurrency = 2  # Bravo has 10 cores but Ollama embedding needs headroom
worker_prefetch_multiplier = 1  # one task at a time per worker slot
task_acks_late = True  # ack after completion, not on receipt (crash-safe)
task_reject_on_worker_lost = True

# ---------------------------------------------------------------------------
# Retry defaults
# ---------------------------------------------------------------------------

task_default_retry_delay = 30  # seconds
task_max_retries = 3

# ---------------------------------------------------------------------------
# Task routes
# ---------------------------------------------------------------------------

task_routes = {
    "mira_crawler.tasks.discover.*": {"queue": "discovery"},
    "mira_crawler.tasks.ingest.*": {"queue": "ingest"},
    "mira_crawler.tasks.foundational.*": {"queue": "ingest"},
    "mira_crawler.tasks.report.*": {"queue": "default"},
    "mira_crawler.tasks.content.*": {"queue": "content"},
    "mira_crawler.tasks.social.*": {"queue": "social"},
}

# ---------------------------------------------------------------------------
# Rate limits (per-task overrides in task decorators take precedence)
# ---------------------------------------------------------------------------

task_annotations = {
    "mira_crawler.tasks.discover.discover_manufacturer": {"rate_limit": "1/m"},
    "mira_crawler.tasks.ingest.ingest_url": {"rate_limit": "20/m"},
}

# ---------------------------------------------------------------------------
# Beat schedule (periodic tasks)
# ---------------------------------------------------------------------------

beat_schedule = {
    "discover-manufacturers-weekly": {
        "task": "mira_crawler.tasks.discover.discover_all_manufacturers",
        "schedule": crontab(day_of_week="sun", hour=3, minute=0),
    },
    "ingest-foundational-kb-monthly": {
        "task": "mira_crawler.tasks.foundational.ingest_foundational_kb",
        "schedule": crontab(day_of_month="1", hour=4, minute=0),
    },
    "ingest-pending-manuals-nightly": {
        "task": "mira_crawler.tasks.ingest.ingest_all_pending",
        "schedule": crontab(hour=2, minute=15),
    },
    # --- Content Fleet ---
    "generate-daily-social-content": {
        "task": "mira_crawler.tasks.content.generate_social_batch",
        "schedule": crontab(hour=6, minute=0),
        "args": ["maintenance_tech"],
    },
    "generate-weekly-blog-post": {
        "task": "mira_crawler.tasks.content.generate_blog_post",
        "schedule": crontab(day_of_week="mon", hour=5, minute=0),
        "args": ["maintenance_tech"],
    },
    "generate-weekly-video-script": {
        "task": "mira_crawler.tasks.content.generate_weekly_video_script",
        "schedule": crontab(day_of_week="thu", hour=5, minute=0),
        "args": ["maintenance_tech"],
    },
    # --- Social Fleet ---
    "schedule-approved-social-posts": {
        "task": "mira_crawler.tasks.social.schedule_buffer_posts",
        "schedule": crontab(hour=7, minute=0),
    },
    "weekly-social-engagement-report": {
        "task": "mira_crawler.tasks.social.social_engagement_report",
        "schedule": crontab(day_of_week="sun", hour=8, minute=0),
    },
}

# ---------------------------------------------------------------------------
# Result expiry
# ---------------------------------------------------------------------------

result_expires = 86400  # 24 hours — results cleaned up after 1 day
