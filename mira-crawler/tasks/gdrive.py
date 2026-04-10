"""GDrive task — sync Google Drive folders and ingest new or updated documents."""
from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.gdrive")
