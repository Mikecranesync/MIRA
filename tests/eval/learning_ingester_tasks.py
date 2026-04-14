"""MIRA Learning Ingester Celery Task — nightly 02:00 UTC (#189).

Queries feedback_log for thumbs-up entries since last run, formats Q&A
pairs as approved_faq chunks, embeds via Ollama, inserts into NeonDB.

Beat schedule entry:
    'mira-learning-ingest-nightly': {
        'task': 'mira_learning_ingest.run_nightly',
        'schedule': crontab(hour=2, minute=0),
    }

Runs BEFORE the 03:00 eval run so new FAQ chunks are available for
retrieval during that night's eval.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import shared_task

_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from mira_bots.tools.learning_ingester import (  # noqa: E402
    LearningIngester,
    LearningIngesterConfig,
)

logger = logging.getLogger("mira-learning-ingest-task")

MIRA_DIR = Path(os.getenv("MIRA_DIR", "/opt/mira"))
LOCK_FILE = Path("/tmp/mira_learning_ingest.lock")
LOCK_MAX_AGE_S = 900  # 15 min


def _acquire_lock() -> bool:
    if LOCK_FILE.exists():
        age = time.monotonic() - LOCK_FILE.stat().st_mtime
        if age < LOCK_MAX_AGE_S:
            logger.warning("Learning ingester already running — skipping")
            return False
        logger.warning("Stale lock (age=%.0fs) — clearing", age)
        LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


@shared_task(name="mira_learning_ingest.run_nightly", max_retries=0, ignore_result=False)
def run_nightly() -> dict:
    """Nightly: 👍 feedback → approved_faq chunks in NeonDB."""
    if os.getenv("LEARNING_INGEST_DISABLED", "").strip() == "1":
        logger.info("Learning ingest disabled — skipping")
        return {"status": "skipped", "reason": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    try:
        neon_url = os.getenv("NEON_DATABASE_URL", "")
        tenant_id = os.getenv("MIRA_TENANT_ID", "")

        if not neon_url:
            return {"status": "error", "reason": "missing_neon_url", "ts": ts}
        if not tenant_id:
            return {"status": "error", "reason": "missing_tenant_id", "ts": ts}

        ingester = LearningIngester(LearningIngesterConfig(
            db_path=Path(os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db")),
            neon_url=neon_url,
            tenant_id=tenant_id,
            ollama_url=os.getenv("OLLAMA_BASE_URL",
                                 "http://host.docker.internal:11434"),
            embed_model=os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"),
            state_path=Path(os.getenv(
                "LEARNING_STATE_PATH", "/opt/mira/data/learning_state.json"
            )),
            max_per_run=int(os.getenv("LEARNING_MAX_PER_RUN", "50")),
        ))

        result = ingester.run(dry_run=False)

        logger.info(
            "Learning ingester complete: %d ingested, %d skipped (of %d positives)",
            result.get("ingested", 0), result.get("skipped", 0),
            result.get("positives_found", 0),
        )
        return result

    except Exception as e:
        logger.error("Learning ingester unexpected error: %s", e)
        return {"status": "error", "reason": str(e), "ts": ts}
    finally:
        _release_lock()
