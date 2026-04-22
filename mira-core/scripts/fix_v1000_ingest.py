#!/usr/bin/env python3
"""Targeted fix for issue #383 — reset pdf_stored flag for V1000 manual
and trigger re-ingest via mira-ingest HTTP API.

Usage:
    doppler run --project factorylm --config prd -- \
      python3 mira-core/scripts/fix_v1000_ingest.py [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("fix_v1000")

V1000_URL_PATTERN = "%SIEPC71060618%"
EXPECTED_CHUNKS = 4582
INGEST_SERVICE = os.getenv("INGEST_SERVICE_URL", "http://localhost:8002")


def _get_engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ["NEON_DATABASE_URL"]
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def _sql_read(engine, query, params=None):
    from sqlalchemy import text

    with engine.connect() as conn:
        return conn.execute(text(query), params or {}).fetchall()


def _sql_scalar(engine, query, params=None):
    from sqlalchemy import text

    with engine.connect() as conn:
        return conn.execute(text(query), params or {}).scalar()


def _sql_write(engine, query, params=None):
    from sqlalchemy import text

    with engine.connect() as conn:
        result = conn.execute(text(query), params or {})
        conn.commit()
        return result.rowcount


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show what would change, don't write")
    args = parser.parse_args()

    neon_url = os.environ.get("NEON_DATABASE_URL")
    tenant_id = os.environ.get("MIRA_TENANT_ID")
    if not neon_url:
        log.error("NEON_DATABASE_URL not set")
        sys.exit(1)

    engine = _get_engine()

    # Current V1000 chunk count
    current = _sql_scalar(
        engine,
        "SELECT COUNT(*) FROM knowledge_entries WHERE manufacturer = 'Yaskawa' AND model_number = 'V1000'"
        + (" AND tenant_id = :tid" if tenant_id else ""),
        {"tid": tenant_id} if tenant_id else {},
    )
    log.info("Current V1000 chunks: %d (target: %d, gap: %d)", current, EXPECTED_CHUNKS, EXPECTED_CHUNKS - current)

    # Find the V1000 URL in manual_cache
    rows = _sql_read(
        engine,
        "SELECT id, manual_url, pdf_stored FROM manual_cache WHERE manual_url LIKE :pattern",
        {"pattern": V1000_URL_PATTERN},
    )

    if not rows:
        log.warning("No V1000 URL found in manual_cache matching %s", V1000_URL_PATTERN)
        sys.exit(1)

    for row in rows:
        row_id, url, pdf_stored = row
        log.info("Found: id=%d url=%s pdf_stored=%s", row_id, url[:80], pdf_stored)

    if args.dry_run:
        log.info("DRY RUN — would reset pdf_stored=false for %d row(s)", len(rows))
        return

    # Reset pdf_stored flag
    updated = _sql_write(
        engine,
        "UPDATE manual_cache SET pdf_stored = false WHERE manual_url LIKE :pattern",
        {"pattern": V1000_URL_PATTERN},
    )
    log.info("Reset pdf_stored=false for %d row(s)", updated)

    # Trigger ingest via mira-ingest API
    ingest_url = f"{INGEST_SERVICE}/admin/ingest-pending"
    try:
        resp = httpx.post(ingest_url, timeout=30)
        resp.raise_for_status()
        log.info("Ingest triggered: %s", resp.json())
    except httpx.ConnectError:
        log.warning("mira-ingest not reachable at %s — run ingest manually:", INGEST_SERVICE)
        log.warning("  doppler run -- python3 mira-crawler/tasks/ingest.py")
    except Exception as e:
        log.warning("Ingest trigger failed (%s) — flag was reset, run ingest manually", e)

    log.info("Done. Re-check chunk count after ingest completes:")
    log.info(
        "  SELECT COUNT(*) FROM knowledge_entries "
        "WHERE manufacturer='Yaskawa' AND model_number='V1000';"
    )
    log.info("  Expected: ~%d", EXPECTED_CHUNKS)


if __name__ == "__main__":
    main()
