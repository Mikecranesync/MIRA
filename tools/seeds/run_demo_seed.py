#!/usr/bin/env python3
"""Run the demo Conveyor 001 seed against NeonDB.

Plan: docs/plans/2026-05-14-demo-backend-plan.md (Phase 2)
Seed:  tools/seeds/demo-conveyor-001.sql

Usage (dry-run prints the SQL it would execute):
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --dry-run

Apply for real (Conveyor 001 only — won't touch other tenants):
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --commit

Verification only (read counts, no writes):
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --verify
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

import psycopg

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SEED_FILE = REPO_ROOT / "tools" / "seeds" / "demo-conveyor-001.sql"
DEMO_TENANT_ID = "00000000-0000-0000-0000-0000000000d1"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("demo-seed")


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL")
    if not url:
        log.error("DATABASE_URL not set. Run under doppler: `doppler run --project factorylm --config prd -- ...`")
        sys.exit(2)
    return url


_OUTER_BEGIN = re.compile(r"^\s*BEGIN\s*;\s*\n", re.MULTILINE)
_OUTER_COMMIT = re.compile(r"\n\s*COMMIT\s*;\s*\n?\s*\Z")


def _strip_outer_tx(sql: str) -> str:
    """Remove the outermost BEGIN; / COMMIT; from the seed.

    The .sql file is wrapped so it works standalone via `psql -f`. When the
    Python runner owns the transaction (psycopg autocommit=False), leaving the
    file's COMMIT in place would commit the work before our rollback can run —
    silently turning --dry-run into a real write. Strip only the outermost pair;
    PL/pgSQL DO blocks have their own BEGIN/EXCEPTION/END blocks which we leave
    intact.
    """
    stripped, n_begin = _OUTER_BEGIN.subn("", sql, count=1)
    stripped, n_commit = _OUTER_COMMIT.subn("\n", stripped, count=1)
    if not (n_begin and n_commit):
        log.warning("Seed did not have outermost BEGIN/COMMIT (begin=%d commit=%d) — runner will manage tx anyway.", n_begin, n_commit)
    return stripped


def run_seed(commit: bool) -> None:
    raw_sql = SEED_FILE.read_text(encoding="utf-8")
    sql = _strip_outer_tx(raw_sql)
    log.info("Connecting to NeonDB...")
    with psycopg.connect(get_database_url(), autocommit=False) as conn:
        with conn.cursor() as cur:
            log.info("Applying %s (%d bytes, outer BEGIN/COMMIT stripped)...", SEED_FILE.name, len(sql))
            cur.execute(sql)
            for diag in conn.notices or []:
                log.info("PG NOTICE: %s", diag.strip())
        if commit:
            conn.commit()
            log.info("✔ Seed committed.")
        else:
            conn.rollback()
            log.info("✔ Seed validated (dry-run, rolled back).")


def verify() -> None:
    """Read-only counts for the demo tenant — confirms the seed landed."""
    queries = [
        ("component_templates (PE-001 + GS10 + 3 placeholders)",
         "SELECT COUNT(*) FROM component_templates WHERE id IN ("
         "'11111111-0001-0001-0001-000000000001'::uuid,"
         "'11111111-0001-0001-0002-000000000001'::uuid,"
         "'11111111-0001-0001-0003-000000000001'::uuid,"
         "'11111111-0001-0001-0004-000000000001'::uuid,"
         "'11111111-0001-0001-0005-000000000001'::uuid)"),
        ("installed_component_instances (demo tenant)",
         f"SELECT COUNT(*) FROM installed_component_instances WHERE tenant_id = '{DEMO_TENANT_ID}'"),
        ("kg_entities (demo tenant)",
         f"SELECT COUNT(*) FROM kg_entities WHERE tenant_id = '{DEMO_TENANT_ID}'"),
        ("relationship_proposals (demo tenant)",
         f"SELECT COUNT(*) FROM relationship_proposals WHERE tenant_id = '{DEMO_TENANT_ID}'"),
        ("relationship_evidence (demo tenant)",
         "SELECT COUNT(*) FROM relationship_evidence re "
         "JOIN relationship_proposals rp ON rp.id = re.proposal_id "
         f"WHERE rp.tenant_id = '{DEMO_TENANT_ID}'"),
        ("kg_relationships (demo tenant)",
         f"SELECT COUNT(*) FROM kg_relationships WHERE tenant_id = '{DEMO_TENANT_ID}'"),
    ]
    log.info("Verifying demo tenant %s...", DEMO_TENANT_ID)
    with psycopg.connect(get_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SET app.current_tenant_id = '{DEMO_TENANT_ID}'")
            for label, q in queries:
                cur.execute(q)
                (n,) = cur.fetchone()
                marker = "✔" if n > 0 else "✗"
                log.info("  %s %-50s %d", marker, label, n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="Apply the seed in a transaction, then rollback.")
    g.add_argument("--commit", action="store_true", help="Apply the seed and commit.")
    g.add_argument("--verify", action="store_true", help="Read-only count check against the demo tenant.")
    args = ap.parse_args()

    if not SEED_FILE.exists():
        log.error("Seed file missing: %s", SEED_FILE)
        return 2

    if args.verify:
        verify()
    else:
        run_seed(commit=args.commit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
