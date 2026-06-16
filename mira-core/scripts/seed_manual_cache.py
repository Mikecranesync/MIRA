#!/usr/bin/env python3
"""Manually seed manual_cache with known direct PDF URLs.

Bypasses Apify discovery for vendors whose portals block crawlers.
Targets the 4 vendors that returned 0 results in the April 2026 ingest run
(Yaskawa, Danfoss, SEW, Lenze — issue #374).

Usage:
    doppler run --project factorylm --config prd -- \
      uv run --with psycopg2-binary --with sqlalchemy \
      python mira-core/scripts/seed_manual_cache.py
"""

from __future__ import annotations

import logging
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_INGEST_DIR = os.path.join(os.path.dirname(_SCRIPT_DIR), "mira-ingest")
if _INGEST_DIR not in sys.path:
    sys.path.insert(0, _INGEST_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("seed_manual_cache")

from db.neon import insert_manual_cache_url  # noqa: E402

# fmt: off
MANUALS: list[dict] = [
    # -------------------------------------------------------------------------
    # Yaskawa — delegate links return direct PDFs (verified 200 OK)
    # -------------------------------------------------------------------------
    {
        "manufacturer": "Yaskawa",
        "model": "V1000",
        "url": "https://www.yaskawa.com/delegate/getAttachment?documentId=SIEPC71060618&cmd=documents&openNewTab=true&documentName=SIEPC71060618.pdf",
        "title": "YASKAWA AC Drive-V1000 Compact Vector Control Drive Technical Manual",
    },
    {
        "manufacturer": "Yaskawa",
        "model": "J1000",
        "url": "https://www.yaskawa.com/delegate/getAttachment?documentId=SIEPC71060631&cmd=documents&documentName=SIEPC71060631.pdf",
        "title": "YASKAWA AC Drive-J1000 Compact V/f Control Drive Technical Manual",
    },
    {
        "manufacturer": "Yaskawa",
        "model": "GA500",
        "url": "https://www.yaskawa.com/delegate/getAttachment?documentId=SIEPC71061752&cmd=documents&documentName=SIEPC71061752.pdf",
        "title": "GA500 Versatile Compact AC Drive Technical Reference",
    },
    # -------------------------------------------------------------------------
    # Danfoss FC 102 — canonical URL redirects 301 to assets CDN; use final URL
    # -------------------------------------------------------------------------
    {
        "manufacturer": "Danfoss",
        "model": "FC102",
        "url": "https://assets.danfoss.com/documents/276803/AU430028034214en-001701.pdf",
        "title": "VLT HVAC Drive FC 102 Programming Guide",
    },
]
# fmt: on

# These vendors were attempted but returned 403 on their direct CDNs.
# Add their URLs here once publicly accessible mirrors are found.
BLOCKED: list[dict] = [
    {
        "manufacturer": "SEW-Eurodrive",
        "model": "MC07B",
        "note": "https://download.sew-eurodrive.com/download/pdf/16810813.pdf returns 403",
    },
    {
        "manufacturer": "Lenze",
        "model": "i500",
        "note": "http://download.lenze.com/TD/Inverter%20i500%20i510%20i550__v1-0__EN.pdf returns 403",
    },
]


def main() -> None:
    inserted = 0
    skipped = 0

    for entry in MANUALS:
        result = insert_manual_cache_url(
            manufacturer=entry["manufacturer"],
            model=entry["model"],
            manual_url=entry["url"],
            manual_title=entry["title"],
            source="manual_seed",
            confidence=0.95,
        )
        if result:
            log.info("INSERTED  %s %s — %s", entry["manufacturer"], entry["model"], entry["title"])
            inserted += 1
        else:
            log.info("DUPLICATE %s %s — already in cache", entry["manufacturer"], entry["model"])
            skipped += 1

    log.info("Done: %d inserted, %d skipped", inserted, skipped)

    if BLOCKED:
        log.warning("Skipped %d vendors with 403 CDN blocks:", len(BLOCKED))
        for b in BLOCKED:
            log.warning("  %s %s — %s", b["manufacturer"], b["model"], b["note"])


if __name__ == "__main__":
    main()
