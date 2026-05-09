#!/usr/bin/env python3
"""Tag KB chunks that are missing manufacturer metadata.

Companion to ``tools/kb_backfill_metadata.py`` (which only handles
Rockwell catalog prefixes). This script infers the manufacturer from
the ``source_url`` host for everything else.

Run inside the bot container or wherever NEON_DATABASE_URL +
MIRA_TENANT_ID resolve:

    doppler run -- python3 tools/kb_label_unlabeled.py
"""
from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

# Host fragment → canonical manufacturer label.
HOST_TO_MANUFACTURER: dict[str, str] = {
    "rockwellautomation.com":   "Rockwell Automation",
    "ab.com":                   "Rockwell Automation",
    "literature.rockwellautomation.com": "Rockwell Automation",
    "siemens.com":              "Siemens",
    "support.industry.siemens.com": "Siemens",
    "automationdirect.com":     "AutomationDirect",
    "schneider-electric.com":   "Schneider Electric",
    "se.com":                   "Schneider Electric",
    "mitsubishielectric.com":   "Mitsubishi Electric",
    "abb.com":                  "ABB",
    "new.abb.com":              "ABB",
    "yaskawa.com":              "Yaskawa",
    "fanuc.com":                "FANUC",
    "omron.com":                "Omron",
    "phoenixcontact.com":       "Phoenix Contact",
    "wago.com":                 "WAGO",
    "danfoss.com":              "Danfoss",
    "honeywell.com":            "Honeywell",
    "emerson.com":              "Emerson",
    "ge.com":                   "GE",
    "eaton.com":                "Eaton",
    "festo.com":                "Festo",
    "smc.eu":                   "SMC",
    "smcusa.com":               "SMC",
    "parker.com":               "Parker Hannifin",
}


def _manufacturer_from_url(url: str) -> str | None:
    if not url:
        return None
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return None
    if not host:
        return None
    # Longest suffix match wins.
    for fragment in sorted(HOST_TO_MANUFACTURER, key=len, reverse=True):
        if host == fragment or host.endswith("." + fragment) or fragment in host:
            return HOST_TO_MANUFACTURER[fragment]
    return None


def main() -> int:
    url = os.environ.get("NEON_DATABASE_URL")
    tid = os.environ.get("MIRA_TENANT_ID")
    if not url or not tid:
        print("ERROR: NEON_DATABASE_URL and MIRA_TENANT_ID must be set", file=sys.stderr)
        return 1

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

    with engine.connect() as conn:
        orphans_before = conn.execute(text(
            "SELECT count(*) FROM knowledge_entries "
            "WHERE tenant_id = :tid AND (manufacturer IS NULL OR manufacturer = '')"
        ), {"tid": tid}).scalar() or 0
        print(f"Orphan chunks (empty manufacturer): {orphans_before}")

        # Group by source_url so we issue one UPDATE per distinct URL.
        rows = conn.execute(text(
            "SELECT DISTINCT source_url FROM knowledge_entries "
            "WHERE tenant_id = :tid AND (manufacturer IS NULL OR manufacturer = '') "
            "AND source_url IS NOT NULL AND source_url <> ''"
        ), {"tid": tid}).fetchall()

        total_updated = 0
        unmatched_urls: list[str] = []

        for (source_url,) in rows:
            mfr = _manufacturer_from_url(source_url)
            if not mfr:
                unmatched_urls.append(source_url)
                continue
            res = conn.execute(text(
                "UPDATE knowledge_entries "
                "SET manufacturer = :mfr "
                "WHERE tenant_id = :tid AND source_url = :url "
                "AND (manufacturer IS NULL OR manufacturer = '')"
            ), {"mfr": mfr, "tid": tid, "url": source_url})
            if res.rowcount > 0:
                print(f"  {mfr:<26} ← {source_url[:80]}: {res.rowcount} chunks")
                total_updated += res.rowcount

        conn.commit()

        orphans_after = conn.execute(text(
            "SELECT count(*) FROM knowledge_entries "
            "WHERE tenant_id = :tid AND (manufacturer IS NULL OR manufacturer = '')"
        ), {"tid": tid}).scalar() or 0

    print(f"\nTotal updated: {total_updated}")
    print(f"Remaining orphans: {orphans_after}")
    if unmatched_urls:
        print(f"\nUnmatched hosts ({len(unmatched_urls)}) — add to HOST_TO_MANUFACTURER:")
        for u in unmatched_urls[:20]:
            try:
                host = urlparse(u).hostname or "?"
            except ValueError:
                host = "?"
            print(f"  {host:<40} ← {u[:80]}")
        if len(unmatched_urls) > 20:
            print(f"  ... and {len(unmatched_urls) - 20} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
