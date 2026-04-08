"""Celery application for mira-crawler task queue.

Broker: Redis (mira-redis container or localhost:6379).
Workers handle: Apify discovery, document ingest, foundational KB crawls.

Start worker:
    celery -A mira_crawler.celery_app worker --loglevel=info --concurrency=2

Start beat (periodic scheduler):
    celery -A mira_crawler.celery_app beat --loglevel=info
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
    import mira_crawler.tasks.content  # noqa: F401
    import mira_crawler.tasks.discover  # noqa: F401
    import mira_crawler.tasks.foundational  # noqa: F401
    import mira_crawler.tasks.ingest  # noqa: F401
    import mira_crawler.tasks.report  # noqa: F401
    import mira_crawler.tasks.social  # noqa: F401
except ImportError:
    import tasks.content  # noqa: F401
    import tasks.discover  # noqa: F401
    import tasks.foundational  # noqa: F401
    import tasks.ingest  # noqa: F401
    import tasks.report  # noqa: F401
    import tasks.social  # noqa: F401

if __name__ == "__main__":
    app.start()
