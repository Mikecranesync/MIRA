"""mira-crawler entry point — scheduler + folder watcher.

Starts APScheduler for timed crawl jobs and Watchdog for folder monitoring.
Both run in background threads. Main thread blocks until interrupted.

Usage:
    python main.py                    # start scheduler + watcher
    python main.py --crawl curriculum # run curriculum crawl once (no scheduler)
    python main.py --crawl manufacturer --filter abb  # crawl specific manufacturer
    python main.py --report           # generate crawl report
    python main.py --healthcheck      # check services
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler

from config import CrawlerConfig
from crawler.curriculum import CurriculumCrawler
from crawler.manufacturer import ManufacturerCrawler
from crawler.report import generate_report
from ingest.converter import extract_from_pdf
from ingest.chunker import chunk_blocks
from ingest.dedup import DedupStore
from ingest.embedder import embed_batch
from ingest.store import store_chunks
from watcher.folder_watcher import FolderWatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("mira-crawler")


def _ingest_file(path: Path, config: CrawlerConfig) -> None:
    """Ingest a single file from the incoming folder."""
    logger.info("Ingesting dropped file: %s", path.name)
    try:
        data = path.read_bytes()
        dedup = DedupStore(db_path=config.dedup_db_path)
        if dedup.is_already_indexed(data):
            logger.info("Skipping (already indexed): %s", path.name)
            return

        blocks = extract_from_pdf(data, min_chars=config.chunk_min_chars)
        if not blocks:
            logger.warning("No blocks extracted from %s", path.name)
            return

        chunks = chunk_blocks(
            blocks,
            source_url=path.name,
            source_file=path.name,
            source_type="equipment_manual",
            max_chars=config.chunk_max_chars,
            min_chars=config.chunk_min_chars,
        )

        embedded = embed_batch(
            chunks,
            ollama_url=config.ollama_base_url,
            model=config.embed_model,
        )
        valid = [(c, v) for c, v in embedded if v is not None]
        if not valid:
            logger.warning("All embeddings failed for %s", path.name)
            return

        stored = store_chunks(valid, tenant_id=config.mira_tenant_id)
        dedup.mark_indexed(data, source_url=path.name, chunk_count=stored)
        logger.info("Ingested %s: %d chunks stored", path.name, stored)
    except Exception as e:
        logger.error("Failed to ingest %s: %s", path.name, e)


def _run_curriculum_crawl(config: CrawlerConfig, tiers: list[str] | None = None) -> None:
    """Run curriculum crawl job."""
    logger.info("Starting curriculum crawl (tiers=%s)", tiers or "all")
    crawler = CurriculumCrawler(config, tiers=tiers)
    try:
        stats = crawler.crawl()
        logger.info("Curriculum crawl complete: %s", stats)
    finally:
        crawler.close()


def _run_manufacturer_crawl(
    config: CrawlerConfig, manufacturers: list[str] | None = None
) -> None:
    """Run manufacturer crawl job."""
    logger.info("Starting manufacturer crawl (filter=%s)", manufacturers or "all")
    crawler = ManufacturerCrawler(config, manufacturers=manufacturers)
    try:
        stats = crawler.crawl()
        logger.info("Manufacturer crawl complete: %s", stats)
    finally:
        crawler.close()


def _run_report(config: CrawlerConfig) -> None:
    """Generate weekly crawl report."""
    dedup = DedupStore(db_path=config.dedup_db_path)
    output = config.cache_dir / "crawl_report.md"
    generate_report(dedup, output)


def healthcheck() -> bool:
    """Basic health check — can import and config loads."""
    try:
        config = CrawlerConfig()
        return True
    except Exception:
        return False


def _setup_scheduler(config: CrawlerConfig) -> BackgroundScheduler:
    """Configure APScheduler with crawl cron triggers."""
    scheduler = BackgroundScheduler()

    # Nightly manufacturer crawls (staggered by hour)
    manufacturers = [
        ("abb", "01:00"),
        ("fanuc", "02:00"),
        ("kuka", "03:00"),
        ("siemens", "04:00"),
        ("rockwell", "05:00"),
        ("automationdirect", "05:30"),
    ]
    for mfr, time_str in manufacturers:
        hour, minute = time_str.split(":")
        scheduler.add_job(
            _run_manufacturer_crawl,
            "cron",
            hour=int(hour),
            minute=int(minute),
            args=[config, [mfr]],
            id=f"crawl_{mfr}",
            name=f"Crawl {mfr}",
        )

    # Weekly curriculum crawl (Sunday 06:00)
    scheduler.add_job(
        _run_curriculum_crawl,
        "cron",
        day_of_week="sun",
        hour=6,
        args=[config],
        id="crawl_curriculum",
        name="Crawl all curriculum sources",
    )

    # Weekly report (Monday 07:00)
    scheduler.add_job(
        _run_report,
        "cron",
        day_of_week="mon",
        hour=7,
        args=[config],
        id="generate_report",
        name="Generate weekly crawl report",
    )

    # Healthcheck every 30 minutes
    scheduler.add_job(
        healthcheck,
        "interval",
        minutes=30,
        id="healthcheck",
        name="Health check",
    )

    return scheduler


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="mira-crawler",
        description="MIRA knowledge base crawler and document ingest service",
    )
    parser.add_argument(
        "--crawl",
        choices=["curriculum", "manufacturer"],
        help="Run a single crawl (no scheduler)",
    )
    parser.add_argument("--filter", type=str, help="Filter crawl by name (e.g., manufacturer)")
    parser.add_argument("--tiers", type=str, help="Comma-separated tier filters for curriculum")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be crawled")
    parser.add_argument("--report", action="store_true", help="Generate crawl report")
    parser.add_argument("--healthcheck", action="store_true", help="Run health check")
    args = parser.parse_args()

    config = CrawlerConfig()

    # One-shot modes
    if args.healthcheck:
        ok = healthcheck()
        print("OK" if ok else "FAIL")
        sys.exit(0 if ok else 1)

    if args.report:
        _run_report(config)
        return

    if args.crawl == "curriculum":
        tiers = args.tiers.split(",") if args.tiers else None
        crawler = CurriculumCrawler(config, tiers=tiers)
        try:
            stats = crawler.crawl(dry_run=args.dry_run)
            print(stats)
        finally:
            crawler.close()
        return

    if args.crawl == "manufacturer":
        mfrs = [args.filter] if args.filter else None
        crawler = ManufacturerCrawler(config, manufacturers=mfrs)
        try:
            stats = crawler.crawl(dry_run=args.dry_run)
            print(stats)
        finally:
            crawler.close()
        return

    # Service mode — scheduler + watcher
    logger.info("Starting mira-crawler service")

    # Folder watcher
    watcher = FolderWatcher(
        watch_dir=config.incoming_dir,
        on_file=lambda path: _ingest_file(path, config),
    )
    watcher.start()

    # Scheduler
    scheduler = None
    if config.schedule_enabled:
        scheduler = _setup_scheduler(config)
        scheduler.start()
        logger.info("APScheduler started with %d jobs", len(scheduler.get_jobs()))
    else:
        logger.info("Scheduler disabled (CRAWL_SCHEDULE_ENABLED=false)")

    # Block until interrupted
    stop_event = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop_event.set())
    signal.signal(signal.SIGTERM, lambda *_: stop_event.set())

    logger.info("mira-crawler running — press Ctrl+C to stop")
    stop_event.wait()

    # Cleanup
    logger.info("Shutting down...")
    watcher.stop()
    if scheduler:
        scheduler.shutdown(wait=False)
    logger.info("mira-crawler stopped")


if __name__ == "__main__":
    main()
