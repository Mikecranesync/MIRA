"""Sitemaps task — crawl XML sitemaps and queue discovered URLs for ingest."""
from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.sitemaps")
