"""Celery application for mira-crawler task queue.

Broker: Redis (mira-redis container or localhost:6379).
Workers handle: Apify discovery, document ingest, foundational KB crawls,
RSS/sitemap polling, YouTube, Reddit, patent, GDrive, freshness, and
Playwright-based crawling.

Scheduling: Trigger.dev Cloud (NOT Celery Beat). See mira-crawler/trigger/.

Start worker:
    celery -A mira_crawler.celery_app worker --loglevel=info --concurrency=3
"""

from __future__ import annotations

import importlib
import logging
import os

from celery import Celery

logger = logging.getLogger("mira_crawler.celery_app")

broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

def _detect_package_prefix() -> str:
    """Detect whether we're running as mira_crawler.* (Docker) or local dev."""
    try:
        import mira_crawler.celeryconfig  # noqa: F401
        return "mira_crawler"
    except ImportError:
        return ""


_PREFIX = _detect_package_prefix()
_config_module = f"{_PREFIX}.celeryconfig" if _PREFIX else "celeryconfig"
_tasks_package = f"{_PREFIX}.tasks" if _PREFIX else "tasks"

app = Celery(
    "mira_crawler",
    broker=broker_url,
    backend=result_backend,
)
app.config_from_object(_config_module)

# Explicit task imports register tasks in both Docker (mira_crawler.*) and local
# dev (tasks.*) layouts. Each module is imported INDEPENDENTLY, and a failure is
# logged + skipped rather than aborting boot. A slim worker image legitimately
# lacks the dependencies of tasks it never runs — e.g. the historian queue image
# (Dockerfile.celery) has no tools/ for component_template and no browsers for
# playwright_crawler. Before this loop, one unimportable optional task module
# crash-looped the entire worker/beat (historian deploy, 2026-06-28).
_TASK_MODULES = (
    "blog",
    "component_template",
    "content",
    "discover",
    "eval_scorer",
    "foundational",
    "freshness",
    "gdrive",
    "historize_runs",
    "ingest",
    "intent_digest",
    "linkedin",
    "patents",
    "playwright_crawler",
    "reddit",
    "reddit_intent",
    "report",
    "rss",
    "sitemaps",
    "social",
    "tag_diff_historizer",
    "synthetic_dogfood",
    "youtube",
    "youtube_intent",
)

for _task_name in _TASK_MODULES:
    try:
        importlib.import_module(f"{_tasks_package}.{_task_name}")
    except Exception as _exc:  # noqa: BLE001 — boot must survive a missing optional task
        logger.warning("celery: task module %r not loaded (%s)", _task_name, _exc)

if __name__ == "__main__":
    app.start()
