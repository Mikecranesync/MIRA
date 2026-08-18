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

import job_registry
from apscheduler.schedulers.background import BackgroundScheduler
from crawler.csv_crawler import CSVCrawler
from crawler.curriculum import CurriculumCrawler
from crawler.manufacturer import ManufacturerCrawler
from crawler.report import generate_report
from ingest.chunker import chunk_blocks
from ingest.converter import extract_from_docling, extract_from_pdf
from ingest.dedup import DedupStore
from ingest.embedder import embed_batch
from ingest.provenance import visibility_for_source
from ingest.store import store_chunks
from metrics import heartbeat
from metrics.latency import IngestLatencyRecorder
from watcher.folder_watcher import FolderWatcher

from config import CrawlerConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("mira-crawler")


def _ingest_file(path: Path, config: CrawlerConfig) -> None:
    """Ingest a single file from the incoming folder."""
    logger.info("Ingesting dropped file: %s", path.name)
    parser_name = "docling" if config.use_docling else "pdfplumber"
    recorder = IngestLatencyRecorder(
        source_id=path.name,
        parser=parser_name,
        source_file=str(path),
        delivered_at=path.stat().st_mtime if path.exists() else None,
        metadata={"ingest_path": "folder_watcher"},
    )
    status = "ok"
    error = ""
    try:
        with recorder.stage("read"):
            data = path.read_bytes()
        recorder.set_metric("bytes", len(data))

        dedup = DedupStore(db_path=config.dedup_db_path)
        with recorder.stage("dedup"):
            already_indexed = dedup.is_already_indexed(data)
        if already_indexed:
            status = "skipped"
            recorder.set_metric("skip_reason", "already_indexed")
            logger.info("Skipping (already indexed): %s", path.name)
            return

        with recorder.stage("parse", parser=parser_name):
            if config.use_docling:
                blocks = extract_from_docling(data, min_chars=config.chunk_min_chars)
                if not blocks:
                    recorder.set_metric("parser_fallback", "pdfplumber")
                    blocks = extract_from_pdf(data, min_chars=config.chunk_min_chars)
            else:
                blocks = extract_from_pdf(data, min_chars=config.chunk_min_chars)
        recorder.update_metrics(
            blocks=len(blocks),
            parsed_chars=sum(len(b.get("text", "")) for b in blocks),
        )

        if config.use_docling and recorder.metrics.get("parser_fallback") == "pdfplumber":
            parser_name = "docling+pdfplumber_fallback"
            recorder.parser = parser_name

        if not blocks:
            status = "no_content"
            recorder.set_metric("skip_reason", "no_blocks_extracted")
            logger.warning("No blocks extracted from %s", path.name)
            return

        with recorder.stage("chunk"):
            chunks = chunk_blocks(
                blocks,
                source_url=path.name,
                source_file=path.name,
                source_type="equipment_manual",
                max_chars=config.chunk_max_chars,
                min_chars=config.chunk_min_chars,
            )
        recorder.update_metrics(
            chunks=len(chunks),
            chunk_chars=sum(len(c.get("text", "")) for c in chunks),
        )

        with recorder.stage("embed", model=config.embed_model):
            embedded = embed_batch(
                chunks,
                ollama_url=config.ollama_base_url,
                model=config.embed_model,
            )
        valid = [(c, v) for c, v in embedded if v is not None]
        recorder.update_metrics(embeddings=len(valid), embedding_failures=len(chunks) - len(valid))
        if not valid:
            status = "embed_failed"
            recorder.set_metric("skip_reason", "all_embeddings_failed")
            logger.warning("All embeddings failed for %s", path.name)
            return

        with recorder.stage("store", backend="neon"):
            # CLI crawl of curated sources -> shared corpus (unverified).
            # Local filesystem source -> PRIVATE, per the canonical classifier.
            # Owner decision 2026-08-18: no folder-watcher file may enter the
            # shared corpus. Derived, not hardcoded, so the policy lives in one
            # place (ingest/provenance.py) rather than in three call sites.
            stored = store_chunks(
                valid,
                tenant_id=config.mira_tenant_id,
                is_private=visibility_for_source(str(path)),
            )
            dedup.mark_indexed(data, source_url=path.name, chunk_count=stored)
        recorder.set_metric("stored_chunks", stored)
        logger.info("Ingested %s: %d chunks stored", path.name, stored)
    except Exception as e:
        status = "error"
        error = f"{type(e).__name__}: {e}"
        logger.error("Failed to ingest %s: %s", path.name, e)
    finally:
        try:
            recorder.finish(status=status, error=error)
        except Exception as metric_error:
            logger.warning("Failed to write ingest latency metric: %s", metric_error)


def _run_curriculum_crawl(config: CrawlerConfig, tiers: list[str] | None = None) -> dict:
    """Run curriculum crawl job. Returns the crawl stats dict."""
    logger.info("Starting curriculum crawl (tiers=%s)", tiers or "all")
    crawler = CurriculumCrawler(config, tiers=tiers)
    try:
        stats = crawler.crawl()
        logger.info("Curriculum crawl complete: %s", stats)
        return stats
    finally:
        crawler.close()


def _run_manufacturer_crawl(
    config: CrawlerConfig, manufacturers: list[str] | None = None
) -> dict:
    """Run manufacturer crawl job. Returns the crawl stats dict."""
    logger.info("Starting manufacturer crawl (filter=%s)", manufacturers or "all")
    crawler = ManufacturerCrawler(config, manufacturers=manufacturers)
    try:
        stats = crawler.crawl()
        logger.info("Manufacturer crawl complete: %s", stats)
        return stats
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
        CrawlerConfig()
        return True
    except Exception:
        return False


def _run_registered_job(config: CrawlerConfig, spec: job_registry.JobSpec) -> None:
    """Run one registered job and record a heartbeat for it.

    This is the fix for the "registration != success" trap: every scheduled run
    now leaves a per-job heartbeat (``ok`` / ``no_new`` / ``failed``) that
    ``health.py`` reads. A raise is recorded as ``failed`` and re-raised so
    APScheduler still logs the exception.
    """
    try:
        if spec.target == "manufacturer_crawl":
            stats = _run_manufacturer_crawl(config, list(spec.args))
        elif spec.target == "curriculum_crawl":
            stats = _run_curriculum_crawl(config)
        elif spec.target == "report":
            _run_report(config)
            stats = None
        elif spec.target == "healthcheck":
            stats = None if healthcheck() else {"total_urls": 1, "fetched": 0, "stored_chunks": 0, "errors": 1}
        else:  # pragma: no cover - registry drift guard
            raise ValueError(f"unknown job target: {spec.target}")
        status = heartbeat.classify_crawl_stats(stats)
        heartbeat.record_job(spec.id, status, detail=stats if isinstance(stats, dict) else None)
    except Exception as exc:
        heartbeat.record_job(
            spec.id,
            heartbeat.STATUS_FAILED,
            detail={"error": f"{type(exc).__name__}: {exc}"},
        )
        raise


def _setup_scheduler(config: CrawlerConfig) -> BackgroundScheduler:
    """Configure APScheduler from the single-source-of-truth job registry.

    Every job is wrapped in ``_run_registered_job`` so it emits a heartbeat.
    Ids / triggers / cadence come from ``job_registry.JOBS`` — the same table
    ``health.py`` judges, so the schedule that fires and the schedule that is
    judged healthy cannot drift.
    """
    scheduler = BackgroundScheduler()
    for spec in job_registry.JOBS:
        scheduler.add_job(
            _run_registered_job,
            spec.trigger_type,
            args=[config, spec],
            id=spec.id,
            name=spec.name,
            **spec.trigger_kwargs,
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
    parser.add_argument(
        "--crawl-from-csv",
        action="store_true",
        help="Crawl PDFs from manual_scrape_targets.csv url_hint column",
    )
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

    if args.crawl_from_csv:
        crawler = CSVCrawler(config)
        try:
            stats = crawler.crawl(dry_run=args.dry_run)
            print(stats)
        finally:
            crawler.close()
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
