"""Reddit task — poll subreddits for maintenance-relevant posts and comments."""
from __future__ import annotations

import logging

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.reddit")
