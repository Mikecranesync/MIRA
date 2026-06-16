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

worker_concurrency = 3  # Bravo has 10 cores; 3 slots balance Ollama embedding headroom with pipeline throughput
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
    # --- Existing task modules ---
    "mira_crawler.tasks.discover.*": {"queue": "discovery"},
    "mira_crawler.tasks.ingest.*": {"queue": "ingest"},
    "mira_crawler.tasks.foundational.*": {"queue": "ingest"},
    "mira_crawler.tasks.report.*": {"queue": "default"},
    "mira_crawler.tasks.content.*": {"queue": "content"},
    "mira_crawler.tasks.social.*": {"queue": "social"},
    "mira_crawler.tasks.blog.*": {"queue": "blog"},
    # --- 24/7 ingest pipeline — new task modules ---
    "mira_crawler.tasks.rss.*": {"queue": "discovery"},
    "mira_crawler.tasks.sitemaps.*": {"queue": "discovery"},
    "mira_crawler.tasks.reddit.*": {"queue": "discovery"},
    "mira_crawler.tasks.patents.*": {"queue": "discovery"},
    "mira_crawler.tasks.playwright_crawler.*": {"queue": "discovery"},
    "mira_crawler.tasks.youtube.*": {"queue": "ingest"},
    "mira_crawler.tasks.reddit_intent.*": {"queue": "discovery"},
    "mira_crawler.tasks.youtube_intent.*": {"queue": "discovery"},
    "mira_crawler.tasks.intent_digest.*": {"queue": "default"},
    "mira_crawler.tasks.gdrive.*": {"queue": "ingest"},
    "mira_crawler.tasks.freshness.*": {"queue": "freshness"},
    "mira_crawler.tasks.component_template.*": {"queue": "ingest"},
    # --- LinkedIn draft generation ---
    "linkedin.*": {"queue": "celery"},
}

# ---------------------------------------------------------------------------
# Rate limits (per-task overrides in task decorators take precedence)
# ---------------------------------------------------------------------------

task_annotations = {
    # Existing tasks
    "tasks.discover.discover_manufacturer": {"rate_limit": "1/m"},
    "tasks.ingest.ingest_url": {"rate_limit": "20/m"},
    # 24/7 ingest pipeline — new tasks
    # All task names here match the registered name in both local dev and Docker:
    # - tasks with explicit name= in @app.task always register as "tasks.*"
    # - tasks without explicit name= (youtube) also use "tasks.*" in local dev;
    #   in Docker they resolve to "mira_crawler.tasks.*" but rate-limit keys use
    #   the short form so both environments benefit from rate-limit coverage.
    "tasks.rss.poll_rss_feeds": {"rate_limit": "30/m"},
    "tasks.sitemaps.check_sitemaps": {"rate_limit": "10/m"},
    "tasks.youtube.ingest_youtube_channels": {"rate_limit": "5/m"},
    "tasks.reddit.scrape_forums": {"rate_limit": "6/m"},
    "tasks.patents.scrape_patents": {"rate_limit": "10/m"},
    "tasks.gdrive.sync_google_drive": {"rate_limit": "10/m"},
    "tasks.freshness.audit_stale_content": {"rate_limit": "60/m"},
    "tasks.playwright_crawler.crawl_js_site": {"rate_limit": "5/m"},
    # Intent monitor — defensive rate limits; beat owns cadence.
    "tasks.reddit_intent.scan_reddit_intent": {"rate_limit": "1/h"},
    "tasks.youtube_intent.scan_youtube_intent": {"rate_limit": "1/h"},
    "tasks.intent_digest.send_daily_digest": {"rate_limit": "1/h"},
    # Component template builder — rate-limited so an ingest burst doesn't
    # blow through the Groq cascade's free-tier hourly cap.
    "mira_crawler.tasks.component_template.extract_component_template": {
        "rate_limit": "10/m",
    },
}

# ---------------------------------------------------------------------------
# Beat schedule
# ---------------------------------------------------------------------------
# Most ingest tasks are scheduled by Trigger.dev Cloud (see mira-crawler/trigger/).
# The intent monitor trio is re-enabled here in Celery Beat to keep its operational
# loop self-contained — Trigger.dev parity can be mirrored later if needed. Run
# `celery -A mira_crawler.celery_app beat` alongside the worker to activate.
#
# Hours are UTC. 06:00 ET ≈ 10:00 UTC (EDT) / 11:00 UTC (EST). Single cron entry
# at 10:00 UTC accepts ±1h DST drift, per spec.

beat_schedule = {
    "reddit-intent-scan": {
        "task": "tasks.reddit_intent.scan_reddit_intent",
        "schedule": crontab(minute=0, hour="*/6"),
    },
    "youtube-intent-scan": {
        "task": "tasks.youtube_intent.scan_youtube_intent",
        "schedule": crontab(minute=0, hour=4),  # 00:00 ET (EDT)
    },
    "intent-daily-digest": {
        "task": "tasks.intent_digest.send_daily_digest",
        "schedule": crontab(minute=0, hour=10),  # 06:00 ET (EDT)
    },
}

# LinkedIn draft (linkedin.draft_post) still scheduled via Trigger.dev: Mon/Wed/Fri 12:00 UTC

# ---------------------------------------------------------------------------
# Result expiry
# ---------------------------------------------------------------------------

result_expires = 86400  # 24 hours — results cleaned up after 1 day
