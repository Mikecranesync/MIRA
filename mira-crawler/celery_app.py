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

import os

from celery import Celery

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

# Explicit imports ensure task registration in both Docker (mira_crawler.*) and local dev
try:
    import mira_crawler.tasks.blog  # noqa: F401
    import mira_crawler.tasks.content  # noqa: F401
    import mira_crawler.tasks.discover  # noqa: F401
    import mira_crawler.tasks.foundational  # noqa: F401
    import mira_crawler.tasks.freshness  # noqa: F401
    import mira_crawler.tasks.gdrive  # noqa: F401
    import mira_crawler.tasks.ingest  # noqa: F401
    import mira_crawler.tasks.patents  # noqa: F401
    import mira_crawler.tasks.playwright_crawler  # noqa: F401
    import mira_crawler.tasks.reddit  # noqa: F401
    import mira_crawler.tasks.report  # noqa: F401
    import mira_crawler.tasks.rss  # noqa: F401
    import mira_crawler.tasks.sitemaps  # noqa: F401
    import mira_crawler.tasks.social  # noqa: F401
    import mira_crawler.tasks.youtube  # noqa: F401
except ImportError:
    import tasks.blog  # noqa: F401
    import tasks.content  # noqa: F401
    import tasks.discover  # noqa: F401
    import tasks.foundational  # noqa: F401
    import tasks.freshness  # noqa: F401
    import tasks.gdrive  # noqa: F401
    import tasks.ingest  # noqa: F401
    import tasks.patents  # noqa: F401
    import tasks.playwright_crawler  # noqa: F401
    import tasks.reddit  # noqa: F401
    import tasks.report  # noqa: F401
    import tasks.rss  # noqa: F401
    import tasks.sitemaps  # noqa: F401
    import tasks.social  # noqa: F401
    import tasks.youtube  # noqa: F401

if __name__ == "__main__":
    app.start()
