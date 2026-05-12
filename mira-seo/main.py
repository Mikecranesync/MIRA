"""Celery app initialization for mira-seo."""

import os
from celery import Celery
from celery.schedules import crontab

celery_app = Celery(
    "mira-seo",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    include=[
        "mira_seo.tasks.weekly_audit",
        "mira_seo.tasks.content_factory",
        "mira_seo.tasks.geo_probe",
    ],
)

celery_app.conf.beat_schedule = {
    "weekly-seo-audit": {
        "task": "mira_seo.tasks.weekly_audit.run",
        "schedule": crontab(hour="6", minute="0", day_of_week="1"),  # Monday 06:00 UTC
    },
    "geo-probe": {
        "task": "mira_seo.tasks.geo_probe.run",
        "schedule": crontab(hour="6", minute="0", day_of_week="3"),  # Wednesday 06:00 UTC
    },
}
