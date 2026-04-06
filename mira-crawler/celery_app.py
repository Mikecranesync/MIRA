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

app = Celery(
    "mira_crawler",
    broker=broker_url,
    backend=result_backend,
    include=[
        "mira_crawler.tasks.discover",
        "mira_crawler.tasks.ingest",
        "mira_crawler.tasks.foundational",
        "mira_crawler.tasks.report",
    ],
)

app.config_from_object("mira_crawler.celeryconfig")

if __name__ == "__main__":
    app.start()
