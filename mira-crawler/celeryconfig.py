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
    "mira_crawler.tasks.youtube_tasks.discover_youtube_videos": {"queue": "youtube-discovery"},
    "mira_crawler.tasks.youtube_tasks.backfill_youtube_pending": {"queue": "youtube-discovery"},
    "mira_crawler.tasks.youtube_tasks.ingest_youtube_transcript": {"queue": "youtube-transcript"},
    "mira_crawler.tasks.youtube_tasks.extract_youtube_keyframes": {"queue": "youtube-keyframes"},
    "mira_crawler.tasks.youtube_tasks.analyze_teaching_patterns": {"queue": "youtube-patterns"},
}

# ---------------------------------------------------------------------------
# Rate limits (per-task overrides in task decorators take precedence)
# ---------------------------------------------------------------------------

task_annotations = {
    "mira_crawler.tasks.discover.discover_manufacturer": {"rate_limit": "1/m"},
    "mira_crawler.tasks.ingest.ingest_url": {"rate_limit": "20/m"},
    # Pattern analysis is throttled — each call hits Claude API
    "mira_crawler.tasks.youtube_tasks.analyze_teaching_patterns": {"rate_limit": "1/m"},
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
    # YouTube KB — runs 24/7 on BRAVO
    "youtube-discover-every-15min": {
        "task": "mira_crawler.tasks.youtube_tasks.discover_youtube_videos",
        "schedule": crontab(minute="*/15"),
    },
    "youtube-backfill-hourly": {
        "task": "mira_crawler.tasks.youtube_tasks.backfill_youtube_pending",
        "schedule": crontab(minute=0),
    },
    "youtube-regen-style-weekly": {
        "task": "mira_crawler.tasks.youtube_tasks.regenerate_youtube_style_prompt",
        "schedule": crontab(day_of_week="sun", hour=4, minute=0),
    },
}

# ---------------------------------------------------------------------------
# Result expiry
# ---------------------------------------------------------------------------

result_expires = 86400  # 24 hours — results cleaned up after 1 day
