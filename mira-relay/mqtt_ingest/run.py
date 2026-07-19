"""Entrypoint: ``python -m mqtt_ingest`` — build config from env, run the loop.

Reads ``MQTT_INGEST_*`` (see config.py) + ``NEON_DATABASE_URL`` for the store.
Runs the read-only Sparkplug subscriber until SIGINT/SIGTERM.
"""

from __future__ import annotations

import logging
import os
import sys


def main() -> int:
    from .config import ConfigError, SparkplugConfig
    from .subscriber import run_subscriber

    try:
        config = SparkplugConfig.from_env()
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    logging.basicConfig(
        level=logging.DEBUG if config.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("mira-relay.mqtt_ingest")

    neon_url = os.getenv("NEON_DATABASE_URL", "")
    if not neon_url and not config.dry_run and config.write_to_db:
        log.error("NEON_DATABASE_URL not set and not in dry-run — refusing to start.")
        return 2

    from tag_ingest import NeonTagStore

    store = NeonTagStore(neon_url)

    import asyncio

    try:
        asyncio.run(run_subscriber(config, store))
    except KeyboardInterrupt:
        log.info("interrupted; shutting down")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
