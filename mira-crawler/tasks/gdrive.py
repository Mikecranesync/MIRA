"""GDrive task — sync Google Drive folders and ingest new or updated documents."""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.gdrive")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# rclone remote name and source path, e.g. "gdrive:FactoryLM/Manuals"
_RCLONE_REMOTE = os.getenv("GDRIVE_RCLONE_REMOTE", "gdrive:FactoryLM/Manuals")
# Local directory where synced files land
_SYNC_DEST = os.getenv("GDRIVE_SYNC_DEST", "/data/gdrive_sync")
_REDIS_PROCESSED_KEY = "mira:gdrive:processed_files"
_RCLONE_TIMEOUT_SEC = 300  # 5 minutes for sync
_PDF_GLOB = "**/*.pdf"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_redis():
    """Return a Redis connection using CELERY_BROKER_URL, always db 0."""
    import redis

    broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    parsed = urlparse(broker_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


def _find_rclone() -> str | None:
    """Return the path to the rclone binary, or None if not found."""
    import shutil

    return shutil.which("rclone")


def _run_rclone_sync(rclone_bin: str, remote: str, dest: str) -> tuple[bool, str]:
    """Run rclone sync from remote to local dest directory.

    Returns (success, output_or_error_message).
    """
    Path(dest).mkdir(parents=True, exist_ok=True)

    cmd = [
        rclone_bin,
        "sync",
        remote,
        dest,
        "--progress",
        "--log-level",
        "INFO",
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_RCLONE_TIMEOUT_SEC,
        )
        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip()
            return False, error_msg
        return True, result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, f"rclone sync timed out after {_RCLONE_TIMEOUT_SEC}s"
    except Exception as exc:
        return False, str(exc)


def _scan_pdf_files(dest_dir: str) -> list[Path]:
    """Return all PDF files found under dest_dir."""
    base = Path(dest_dir)
    if not base.exists():
        return []
    return sorted(base.glob(_PDF_GLOB))


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.gdrive.sync_google_drive")
def sync_google_drive() -> dict:
    """Sync Google Drive via rclone and queue new PDFs for ingest.

    Steps:
      1. Check that rclone binary is available (graceful skip if missing).
      2. Run ``rclone sync`` to download new/updated files.
      3. Scan dest directory for PDF files.
      4. Load already-processed file paths from Redis set.
      5. For each new PDF: queue via ingest_url.delay(url=f"file://{path}").
      6. Persist newly queued paths to Redis.
      7. Return summary counts.
    """
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    # 1. Check rclone availability
    rclone_bin = _find_rclone()
    if not rclone_bin:
        logger.warning("rclone binary not found — skipping GDrive sync")
        return {"files_found": 0, "new_queued": 0, "error": "rclone_not_found"}

    # 2. Load processed file set from Redis
    try:
        r = _get_redis()
        processed: set[str] = r.smembers(_REDIS_PROCESSED_KEY)  # type: ignore[assignment]
    except Exception as exc:
        logger.error("Redis connection failed — aborting sync_google_drive: %s", exc)
        return {"files_found": 0, "new_queued": 0, "error": str(exc)}

    remote = os.getenv("GDRIVE_RCLONE_REMOTE", _RCLONE_REMOTE)
    dest = os.getenv("GDRIVE_SYNC_DEST", _SYNC_DEST)

    logger.info("Starting rclone sync: %s → %s", remote, dest)

    # 3. Run rclone sync
    success, output = _run_rclone_sync(rclone_bin, remote, dest)
    if not success:
        logger.error("rclone sync failed: %s", output[:200])
        return {"files_found": 0, "new_queued": 0, "error": f"rclone_failed: {output[:200]}"}

    logger.info("rclone sync complete: %s", output[:200] if output else "(no output)")

    # 4. Scan for PDFs
    pdf_files = _scan_pdf_files(dest)
    files_found = len(pdf_files)
    logger.info("Found %d PDF files in %s", files_found, dest)

    # 5. Queue new PDFs
    new_queued = 0
    newly_processed: list[str] = []

    for pdf_path in pdf_files:
        path_str = str(pdf_path)
        if path_str in processed:
            continue

        file_url = f"file://{pdf_path}"
        try:
            ingest_url.delay(url=file_url, source_type="manual")
            new_queued += 1
            newly_processed.append(path_str)
            processed.add(path_str)
            logger.debug("Queued PDF: %s", path_str)
        except Exception as exc:
            logger.warning("Failed to queue PDF %s: %s", path_str, exc)

    # 6. Persist newly processed paths to Redis
    if newly_processed:
        try:
            r.sadd(_REDIS_PROCESSED_KEY, *newly_processed)
            logger.info("Recorded %d newly processed files in Redis", len(newly_processed))
        except Exception as exc:
            logger.error("Failed to persist processed file list to Redis: %s", exc)

    logger.info(
        "sync_google_drive complete: %d files found, %d new queued",
        files_found,
        new_queued,
    )
    return {"files_found": files_found, "new_queued": new_queued}
