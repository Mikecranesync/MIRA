"""Nightly cron: abandon troubleshooting sessions idle > 24 h.

Usage:
    python mira-bots/scripts/nightly_close_sessions.py [--cutoff-hours N]

Run via crontab:
    0 3 * * *  doppler run --project factorylm --config prd -- \
        python /opt/mira/mira-bots/scripts/nightly_close_sessions.py
"""

from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff-hours", type=int, default=24)
    args = parser.parse_args()

    sys.path.insert(0, "mira-bots")
    from shared.troubleshooting_session import close_idle_sessions

    closed = close_idle_sessions(cutoff_hours=args.cutoff_hours)
    print(f"Closed {closed} idle troubleshooting session(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
