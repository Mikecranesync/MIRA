"""Celery tasks for YouTube KB pipeline.

Four tasks, four queues:
  youtube-discovery  — discover_youtube_videos (every 15min beat)
  youtube-transcript — ingest_youtube_transcript (per-video, 4 workers)
  youtube-keyframes  — extract_youtube_keyframes (per-video, 2 workers)
  youtube-patterns   — analyze_teaching_patterns (per-video, 1 worker)

CLI dry-run usage (Phase 1 gate):
  python -m mira_crawler.tasks.youtube_tasks discover --dry-run
  python -m mira_crawler.tasks.youtube_tasks ingest-transcript <video_id> --dry-run
  python -m mira_crawler.tasks.youtube_tasks extract-keyframes <video_id> --dry-run
  python -m mira_crawler.tasks.youtube_tasks analyze-pattern <video_id> --dry-run
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("mira-crawler.youtube.tasks")

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app


# ---------------------------------------------------------------------------
# Task: discover_youtube_videos
# Queue: youtube-discovery | Beat: every 15 min
# ---------------------------------------------------------------------------

@app.task(
    bind=True,
    name="mira_crawler.tasks.youtube_tasks.discover_youtube_videos",
    queue="youtube-discovery",
    max_retries=2,
    default_retry_delay=60,
)
def discover_youtube_videos(self, dry_run: bool = False) -> dict:
    """Search YouTube API for new industrial maintenance/PLC videos.

    Rotates through keyword seeds from sources.yaml. Quota-aware —
    skips when daily API units near limit.
    """
    try:
        from crawler.youtube_crawler import discover_videos
        result = discover_videos(dry_run=dry_run)

        # Queue transcript ingestion for each newly inserted video
        if not dry_run and result.get("inserted", 0) > 0:
            _queue_pending_transcripts()

        return result
    except Exception as exc:
        logger.error("Discovery task failed: %s", exc)
        raise self.retry(exc=exc)


def _queue_pending_transcripts() -> None:
    """Find all videos with transcript_status=pending and queue them."""

    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return
    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("""SELECT video_id FROM youtube_videos
                        WHERE transcript_status = 'pending'
                        AND queued_at > NOW() - INTERVAL '3 hours'""")
            ).fetchall()
        for (video_id,) in rows:
            ingest_youtube_transcript.apply_async(args=[video_id], queue="youtube-transcript")
            logger.info("Queued transcript: %s", video_id)
    except Exception as e:
        logger.error("Failed to queue pending transcripts: %s", e)


# ---------------------------------------------------------------------------
# Task: ingest_youtube_transcript
# Queue: youtube-transcript | Triggered: after discovery
# ---------------------------------------------------------------------------

@app.task(
    bind=True,
    name="mira_crawler.tasks.youtube_tasks.ingest_youtube_transcript",
    queue="youtube-transcript",
    max_retries=3,
    default_retry_delay=30,
)
def ingest_youtube_transcript(self, video_id: str, dry_run: bool = False) -> dict:
    """Extract + chunk + embed transcript for one video into NeonDB.

    On completion queues both keyframe extraction and pattern analysis.
    """
    try:
        from ingest.youtube_transcript import ingest_transcript
        result = ingest_transcript(video_id, dry_run=dry_run)

        status = result.get("status", "")
        if not dry_run and status == "done":
            # Kick off downstream tasks
            extract_youtube_keyframes.apply_async(args=[video_id], queue="youtube-keyframes")
            analyze_teaching_patterns.apply_async(args=[video_id], queue="youtube-patterns")
            logger.info("Queued keyframes + patterns for %s", video_id)

        return result
    except Exception as exc:
        logger.error("Transcript task failed for %s: %s", video_id, exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task: extract_youtube_keyframes
# Queue: youtube-keyframes | Triggered: after transcript done
# ---------------------------------------------------------------------------

@app.task(
    bind=True,
    name="mira_crawler.tasks.youtube_tasks.extract_youtube_keyframes",
    queue="youtube-keyframes",
    max_retries=2,
    default_retry_delay=120,
    # Soft 20-min time limit — keyframe extraction is CPU-bound
    soft_time_limit=1200,
    time_limit=1500,
)
def extract_youtube_keyframes(self, video_id: str, dry_run: bool = False) -> dict:
    """Download video, extract scene-change keyframes, classify with Claude vision.

    Valuable frames (fault codes, wiring, ladder logic, HMI, etc.) are
    stored in PHOTOS_DIR + embedded with nomic-embed-vision → NeonDB.
    Temp video deleted immediately after frame extraction.
    """
    try:
        from ingest.youtube_keyframe import extract_keyframes
        return extract_keyframes(video_id, dry_run=dry_run)
    except Exception as exc:
        logger.error("Keyframe task failed for %s: %s", video_id, exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task: analyze_teaching_patterns
# Queue: youtube-patterns | Triggered: after transcript done
# ---------------------------------------------------------------------------

@app.task(
    bind=True,
    name="mira_crawler.tasks.youtube_tasks.analyze_teaching_patterns",
    queue="youtube-patterns",
    max_retries=2,
    default_retry_delay=60,
    # Rate-limit: 1 pattern analysis per minute to manage Claude API cost
    rate_limit="1/m",
)
def analyze_teaching_patterns(self, video_id: str, dry_run: bool = False) -> dict:
    """Run Claude on full transcript to extract teaching structure patterns.

    Stores results in teaching_patterns table. Top patterns by
    engagement_score are injected into bot system prompts weekly.
    """
    try:
        from ingest.youtube_pattern import analyze_pattern
        return analyze_pattern(video_id, dry_run=dry_run)
    except Exception as exc:
        logger.error("Pattern task failed for %s: %s", video_id, exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task: backfill_youtube_pending
# Queue: youtube-discovery | Beat: every hour
# ---------------------------------------------------------------------------

@app.task(
    name="mira_crawler.tasks.youtube_tasks.backfill_youtube_pending",
    queue="youtube-discovery",
)
def backfill_youtube_pending() -> dict:
    """Re-queue any videos stuck in 'pending' state for more than 2 hours.

    Guards against Celery worker crashes leaving videos unprocessed.
    """

    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return {"requeued_transcripts": 0, "requeued_keyframes": 0, "requeued_patterns": 0}

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    counts = {"requeued_transcripts": 0, "requeued_keyframes": 0, "requeued_patterns": 0}

    try:
        with engine.connect() as conn:
            # Transcripts stuck pending for > 2 hours
            rows = conn.execute(text("""
                SELECT video_id FROM youtube_videos
                WHERE transcript_status = 'pending'
                  AND queued_at < now() - interval '2 hours'
            """)).fetchall()
            for (vid,) in rows:
                ingest_youtube_transcript.apply_async(args=[vid], queue="youtube-transcript")
                counts["requeued_transcripts"] += 1

            # Keyframes pending after transcript done
            rows = conn.execute(text("""
                SELECT video_id FROM youtube_videos
                WHERE transcript_status = 'done'
                  AND keyframe_status = 'pending'
                  AND updated_at < now() - interval '2 hours'
            """)).fetchall()
            for (vid,) in rows:
                extract_youtube_keyframes.apply_async(args=[vid], queue="youtube-keyframes")
                counts["requeued_keyframes"] += 1

            # Patterns pending after transcript done
            rows = conn.execute(text("""
                SELECT video_id FROM youtube_videos
                WHERE transcript_status = 'done'
                  AND pattern_status = 'pending'
                  AND updated_at < now() - interval '2 hours'
            """)).fetchall()
            for (vid,) in rows:
                analyze_teaching_patterns.apply_async(args=[vid], queue="youtube-patterns")
                counts["requeued_patterns"] += 1

    except Exception as e:
        logger.error("Backfill failed: %s", e)

    logger.info("Backfill: %s", counts)
    return counts


# ---------------------------------------------------------------------------
# CLI entry point for dry-run testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    dry_run = "--dry-run" in sys.argv

    if cmd == "discover":
        from crawler.youtube_crawler import discover_videos
        result = discover_videos(dry_run=dry_run)
        print(result)

    elif cmd == "ingest-transcript":
        video_id = sys.argv[2] if len(sys.argv) > 2 else ""
        if not video_id:
            print("Usage: python -m mira_crawler.tasks.youtube_tasks ingest-transcript <video_id> [--dry-run]")
            sys.exit(1)
        from ingest.youtube_transcript import ingest_transcript
        result = ingest_transcript(video_id, dry_run=dry_run)
        print(result)

    elif cmd == "extract-keyframes":
        video_id = sys.argv[2] if len(sys.argv) > 2 else ""
        if not video_id:
            print("Usage: python -m mira_crawler.tasks.youtube_tasks extract-keyframes <video_id> [--dry-run]")
            sys.exit(1)
        from ingest.youtube_keyframe import extract_keyframes
        result = extract_keyframes(video_id, dry_run=dry_run)
        print(result)

    elif cmd == "analyze-pattern":
        video_id = sys.argv[2] if len(sys.argv) > 2 else ""
        if not video_id:
            print("Usage: python -m mira_crawler.tasks.youtube_tasks analyze-pattern <video_id> [--dry-run]")
            sys.exit(1)
        from ingest.youtube_pattern import analyze_pattern
        result = analyze_pattern(video_id, dry_run=dry_run)
        print(result)

    else:
        print(__doc__)
