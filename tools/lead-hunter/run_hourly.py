#!/usr/bin/env python3
"""Standalone entry point for launchd hourly execution.

Called by: com.mira.lead-hunter.plist (launchd)
Doppler injects secrets automatically via the plist EnvironmentVariables.
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            Path(__file__).parent.parent.parent / "marketing" / "prospects" / "lead-hunter.log",
            mode="a",
        ),
    ],
)

from celery_tasks import run_discover_and_enrich  # noqa: E402

if __name__ == "__main__":
    result = run_discover_and_enrich()
    sys.exit(0 if result else 1)
