#!/usr/bin/env python3
"""Run a namespace seed against NeonDB.

Usage — original demo (fixed tenant UUID):
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --dry-run
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --commit
  doppler run --project factorylm --config prd -- python3 tools/seeds/run_demo_seed.py --verify

Usage — real projects (provide your tenant UUID from the Hub):
  doppler run --project factorylm --config prd -- \
    python3 tools/seeds/run_demo_seed.py \
      --tenant epic-universe --tenant-id <UUID> --commit

  doppler run --project factorylm --config prd -- \
    python3 tools/seeds/run_demo_seed.py \
      --tenant garage-conveyor --tenant-id <UUID> --commit

Find your tenant UUID:
  doppler run --project factorylm --config prd -- \
    psql "$DATABASE_URL" -c "SELECT id, name FROM hub_tenants ORDER BY created_at DESC LIMIT 5;"
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
DEMO_TENANT_ID = "00000000-0000-0000-0000-0000000000d1"

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

TENANTS: dict[str, dict] = {
    "demo": {
        "seed_file": REPO_ROOT / "tools" / "seeds" / "demo-conveyor-001.sql",
        "tenant_id": DEMO_TENANT_ID,
        "verify_entities": [],  # legacy verify() handles this
    },
    "epic-universe": {
        "seed_file": REPO_ROOT / "tools" / "seeds" / "epic-universe-stardust-racers.sql",
        "tenant_id": None,  # must be supplied via --tenant-id
        "verify_entities": [
            "celestial_park", "stardust_racers", "launch_1", "launch_2",
            "station_load", "station_unload",
        ],
    },
    "garage-conveyor": {
        "seed_file": REPO_ROOT / "tools" / "seeds" / "factorylm-garage-conveyor.sql",
        "tenant_id": None,  # must be supplied via --tenant-id
        "verify_entities": [
            "home_garage", "conveyor_lab", "conveyor_1",
            "micro820_plc", "gs10_vfd", "photoeye_1",
        ],
    },
}

# Kept for reference — used by the old SEED_FILE path
SEED_FILE = TENANTS["demo"]["seed_file"]

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


def run_seed(commit: bool, seed_file: Path = SEED_FILE, tenant_id: str = DEMO_TENANT_ID) -> None:
    raw_sql = seed_file.read_text(encoding="utf-8")
    # Substitute tenant placeholder for real-project seeds.
    if "__TENANT_ID__" in raw_sql:
        if not _UUID_RE.match(tenant_id):
            log.error("--tenant-id must be a valid UUID; got: %s", tenant_id)
            sys.exit(2)
        raw_sql = raw_sql.replace("__TENANT_ID__", tenant_id)
        log.info("Substituted tenant_id=%s into seed.", tenant_id)
    sql = _strip_outer_tx(raw_sql)
    log.info("Connecting to NeonDB...")
    notices: list[str] = []
    with psycopg.connect(get_database_url(), autocommit=False) as conn:
        conn.add_notice_handler(lambda diag: notices.append(diag.message_primary or ""))
        with conn.cursor() as cur:
            log.info("Applying %s (%d bytes, outer BEGIN/COMMIT stripped)...", seed_file.name, len(sql))
            cur.execute(sql)
            for msg in notices:
                log.info("PG NOTICE: %s", msg.strip())
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


def verify_real(tenant_id: str, entity_ids: list[str]) -> None:
    log.info("Verifying tenant %s...", tenant_id)
    with psycopg.connect(get_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SET app.current_tenant_id = '{tenant_id}'")
            for eid in entity_ids:
                cur.execute(
                    "SELECT COUNT(*) FROM kg_entities WHERE tenant_id = %s AND entity_id = %s",
                    (tenant_id, eid),
                )
                (n,) = cur.fetchone()
                log.info("  %s kg_entities[%s]  %d", "✔" if n > 0 else "✗", eid, n)
            cur.execute(
                "SELECT COUNT(*) FROM relationship_proposals WHERE tenant_id = %s AND status = 'proposed'",
                (tenant_id,),
            )
            (n,) = cur.fetchone()
            log.info("  %s relationship_proposals pending  %d", "✔" if n > 0 else "✗", n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--tenant",
        choices=list(TENANTS),
        default="demo",
        help="Which seed to run (default: demo).",
    )
    ap.add_argument(
        "--tenant-id",
        metavar="UUID",
        help="Tenant UUID to inject into real-project seeds (required for epic-universe, garage-conveyor).",
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="Apply in a transaction, then rollback.")
    g.add_argument("--commit", action="store_true", help="Apply and commit.")
    g.add_argument("--verify", action="store_true", help="Read-only count check.")
    args = ap.parse_args()

    cfg = TENANTS[args.tenant]
    seed_file: Path = cfg["seed_file"]
    tenant_id: str = args.tenant_id or cfg["tenant_id"] or ""

    if args.tenant != "demo" and not tenant_id:
        ap.error(f"--tenant-id UUID is required for --tenant {args.tenant}")

    if not seed_file.exists():
        log.error("Seed file missing: %s", seed_file)
        return 2

    if args.verify:
        if args.tenant == "demo":
            verify()
        else:
            verify_real(tenant_id, cfg["verify_entities"])
    else:
        run_seed(commit=args.commit, seed_file=seed_file, tenant_id=tenant_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
