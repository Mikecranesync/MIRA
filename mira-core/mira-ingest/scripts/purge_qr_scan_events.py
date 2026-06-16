"""Nightly job: delete qr_scan_events older than 90 days.

Invoked from cron or `docker compose run --rm mira-ingest python scripts/purge_qr_scan_events.py`.
"""

from __future__ import annotations

import logging
import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("purge-qr-events")


def main() -> int:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        log.error("NEON_DATABASE_URL not set")
        return 1
    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    with engine.begin() as conn:
        result = conn.execute(
            text("DELETE FROM qr_scan_events WHERE scanned_at < NOW() - INTERVAL '90 days'")
        )
    log.info("purged %d qr_scan_events rows older than 90d", result.rowcount)
    return 0


if __name__ == "__main__":
    sys.exit(main())
