#!/usr/bin/env python3
"""Re-run the db-inspect.yml artifact-presence check against staging Neon.

Mirrors the SELECT block in .github/workflows/db-inspect.yml so the
output format matches. Read-only.
"""
from __future__ import annotations

import os
import sys

import psycopg2

ARTIFACTS = [
    ("troubleshooting_sessions (019)", "table", "troubleshooting_sessions"),
    ("live_signal_events (019)", "table", "live_signal_events"),
    ("live_signal_cache (020)", "table", "live_signal_cache"),
    ("diagnostic_trend_sessions (020)", "table", "diagnostic_trend_sessions"),
    ("diagnostic_trend_signals (020)", "table", "diagnostic_trend_signals"),
    ("namespace_versions (021_namespace_builder)", "table", "namespace_versions"),
    ("pm_schedules.updated_at (021_pm)", "column", ("pm_schedules", "updated_at")),
    ("guest_reports (022)", "table", "guest_reports"),
    ("kg_entities.source_chunk_id (024)", "column", ("kg_entities", "source_chunk_id")),
    ("kg_entities_tenant_type_name_key idx (025/026)", "index",
     ("kg_entities", "kg_entities_tenant_type_name_key")),
    ("kg_entities_tenant_id_entity_type_entity_id_key DROPPED (025/026)",
     "no_constraint", ("kg_entities", "kg_entities_tenant_id_entity_type_entity_id_key")),
]


def main() -> int:
    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        print("ERROR: NEON_DATABASE_URL not set", file=sys.stderr)
        return 1
    host = url.split("@", 1)[-1].split("/", 1)[0]
    print(f"target host: {host}")
    print()
    print(f"{'artifact':<70} | present")
    print("-" * 70 + "-+-------")

    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        for label, kind, ref in ARTIFACTS:
            if kind == "table":
                cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_name=%s)", (ref,))
            elif kind == "column":
                tbl, col = ref
                cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name=%s AND column_name=%s)",
                    (tbl, col))
            elif kind == "index":
                tbl, idx = ref
                cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM pg_indexes "
                    "WHERE schemaname='public' AND tablename=%s AND indexname=%s)",
                    (tbl, idx))
            elif kind == "no_constraint":
                tbl, conname = ref
                cur.execute(
                    "SELECT NOT EXISTS(SELECT 1 FROM pg_constraint c "
                    "JOIN pg_class t ON t.oid = c.conrelid "
                    "WHERE t.relname=%s AND c.conname=%s)", (tbl, conname))
            else:
                continue
            present = cur.fetchone()[0]
            mark = "t" if present else "f"
            print(f"{label:<70} | {mark}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
