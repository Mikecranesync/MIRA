"""Freshness task — check whether previously ingested URLs have changed and re-queue stale ones."""
from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.freshness")
