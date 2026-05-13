"""Send Celery tasks to the shared Redis broker without importing the worker package.

Used by `content_approval.py` to dispatch `mira_seo.tasks.daily_content.publish_approved`
when an admin taps an inline button on a draft preview.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("mira-bot.celery-client")


def send_task(task_name: str, *args: Any, **kwargs: Any) -> str | None:
    """Push a Celery task onto the shared Redis broker.

    Args:
        task_name: full dotted Celery task name (e.g. "mira_seo.tasks.daily_content.publish_approved")
        *args: positional args for the task
        **kwargs: keyword args for the task

    Returns:
        Celery task id (UUID) on success, None on failure or missing config
    """
    broker_url = os.environ.get("REDIS_URL") or os.environ.get("CELERY_BROKER_URL")
    if not broker_url:
        logger.error("REDIS_URL / CELERY_BROKER_URL not set — cannot dispatch task %s", task_name)
        return None

    try:
        from celery import Celery
    except ImportError:
        logger.error("celery library not installed — cannot dispatch task %s", task_name)
        return None

    try:
        app = Celery("mira-bot-dispatcher", broker=broker_url)
        result = app.send_task(task_name, args=list(args), kwargs=kwargs)
        logger.info("Dispatched %s id=%s args=%s kwargs=%s", task_name, result.id, args, kwargs)
        return result.id
    except Exception:
        logger.exception("Failed to dispatch Celery task %s", task_name)
        return None
