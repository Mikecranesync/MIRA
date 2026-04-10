"""Celery configuration for mira-crawler workers.

All settings overridable via environment variables where noted.
"""

from __future__ import annotations

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
    "mira_crawler.tasks.gdrive.*": {"queue": "ingest"},
    "mira_crawler.tasks.freshness.*": {"queue": "freshness"},
}

# ---------------------------------------------------------------------------
# Rate limits (per-task overrides in task decorators take precedence)
# ---------------------------------------------------------------------------

task_annotations = {
    # Existing tasks
    "mira_crawler.tasks.discover.discover_manufacturer": {"rate_limit": "1/m"},
    "mira_crawler.tasks.ingest.ingest_url": {"rate_limit": "20/m"},
    # 24/7 ingest pipeline — new tasks
    "mira_crawler.tasks.rss.poll_rss_feed": {"rate_limit": "30/m"},
    "mira_crawler.tasks.sitemaps.crawl_sitemap": {"rate_limit": "10/m"},
    "mira_crawler.tasks.youtube.ingest_youtube_video": {"rate_limit": "5/m"},
    "mira_crawler.tasks.reddit.poll_subreddit": {"rate_limit": "6/m"},
    "mira_crawler.tasks.patents.fetch_patent": {"rate_limit": "10/m"},
    "mira_crawler.tasks.gdrive.sync_gdrive_folder": {"rate_limit": "10/m"},
    "mira_crawler.tasks.freshness.check_url_freshness": {"rate_limit": "60/m"},
    "mira_crawler.tasks.playwright_crawler.crawl_page": {"rate_limit": "5/m"},
}

# Beat schedule removed — Trigger.dev Cloud owns all scheduling. See mira-crawler/trigger/

# ---------------------------------------------------------------------------
# Result expiry
# ---------------------------------------------------------------------------

result_expires = 86400  # 24 hours — results cleaned up after 1 day
