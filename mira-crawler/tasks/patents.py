"""Patents task — fetch and ingest industrial equipment patents from USPTO/Google Patents."""
from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.patents")
