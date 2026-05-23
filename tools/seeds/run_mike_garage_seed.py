#!/usr/bin/env python3
"""Run the Mike-garage-tenant seed against the staging NeonDB branch.

Seed: tools/seeds/mike-garage-tenant.sql
Tenant: 78917b56-f85f-43bb-9a08-1bb98a6cd6c3 (Mike Harper's real tenant)
Target: Doppler `factorylm/stg` — never prod.

Usage:
  doppler run --project factorylm --config stg -- python3 tools/seeds/run_mike_garage_seed.py --dry-run
  doppler run --project factorylm --config stg -- python3 tools/seeds/run_mike_garage_seed.py --commit
  doppler run --project factorylm --config stg -- python3 tools/seeds/run_mike_garage_seed.py --verify
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

try:
    import psycopg2  # /opt/homebrew Python 3.12 has this preinstalled
except ImportError:
    sys.stderr.write(
        "psycopg2 not available — run with /opt/homebrew/bin/python3.12\n"
    )
    raise

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SEED_FILE = REPO_ROOT / "tools" / "seeds" / "mike-garage-tenant.sql"
TENANT_ID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
EQUIPMENT_ID_CV001 = "af5ecc20-e5a2-4c35-bda3-3acc251522f7"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mike-garage-seed")


def get_database_url() -> str:
    url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        log.error(
            "NEON_DATABASE_URL not set. Run under doppler stg: "
            "`doppler run --project factorylm --config stg -- ...`"
        )
        sys.exit(2)
    return url


_OUTER_BEGIN = re.compile(r"^\s*BEGIN\s*;\s*\n", re.MULTILINE)
_OUTER_COMMIT = re.compile(r"\n\s*COMMIT\s*;\s*\n?")
_PSQL_META = re.compile(r"^\\\w.*$", re.MULTILINE)


def _strip_psql_only(sql: str) -> str:
    """Strip psql meta-commands (\\set, \\if etc.) that psycopg2 can't run."""
    return _PSQL_META.sub("", sql)


def _strip_outer_tx(sql: str) -> str:
    """Remove the outermost BEGIN; / COMMIT; so the Python runner owns the tx
    (otherwise --dry-run can't roll back because the SQL COMMITs itself)."""
    stripped, _ = _OUTER_BEGIN.subn("", sql, count=1)
    stripped, _ = _OUTER_COMMIT.subn("\n", stripped, count=1)
    return stripped


def run_seed(commit: bool) -> None:
    sql = SEED_FILE.read_text(encoding="utf-8")
    sql = _strip_psql_only(sql)
    sql = _strip_outer_tx(sql)
    log.info(
        "Applying %s (%d bytes, outer BEGIN/COMMIT stripped, %s)",
        SEED_FILE.name, len(sql), "COMMIT" if commit else "DRY-RUN (rollback)",
    )
    with psycopg2.connect(get_database_url(), sslmode="require") as conn:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(sql)
        if commit:
            conn.commit()
            log.info("✔ Committed.")
        else:
            conn.rollback()
            log.info("✔ Dry-run rolled back (SQL parsed + executed without error).")


def verify() -> None:
    queries = [
        ("kg_entities (Mike's tenant, full)",
         f"SELECT count(*) FROM kg_entities WHERE tenant_id = '{TENANT_ID}'"),
        ("kg_entities under garage path",
         f"SELECT count(*) FROM kg_entities WHERE tenant_id = '{TENANT_ID}' "
         f"AND uns_path <@ 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3'::ltree"),
        ("installed_component_instances",
         f"SELECT count(*) FROM installed_component_instances WHERE tenant_id = '{TENANT_ID}'"),
        ("relationship_proposals (verified, this seed)",
         f"SELECT count(*) FROM relationship_proposals WHERE tenant_id = '{TENANT_ID}' "
         f"AND reviewed_by = 'mike-garage-tenant.sql v1'"),
        ("relationship_evidence (this seed)",
         f"SELECT count(*) FROM relationship_evidence re "
         f"JOIN relationship_proposals rp ON rp.id = re.proposal_id "
         f"WHERE rp.tenant_id = '{TENANT_ID}' "
         f"AND rp.reviewed_by = 'mike-garage-tenant.sql v1'"),
        ("kg_relationships (this seed)",
         f"SELECT count(*) FROM kg_relationships WHERE tenant_id = '{TENANT_ID}' "
         f"AND proposed_by = 'mike-garage-tenant.sql v1'"),
        ("cmms_equipment under CV-001",
         f"SELECT count(*) FROM cmms_equipment WHERE tenant_id = '{TENANT_ID}' "
         f"AND (id = '{EQUIPMENT_ID_CV001}' OR parent_asset_id = '{EQUIPMENT_ID_CV001}')"),
    ]
    detail_queries = [
        ("kg_entities by type (garage path)",
         f"SELECT entity_type, count(*) FROM kg_entities WHERE tenant_id = '{TENANT_ID}' "
         f"AND uns_path <@ 'enterprise.78917b56_f85f_43bb_9a08_1bb98a6cd6c3'::ltree "
         f"GROUP BY entity_type ORDER BY entity_type"),
        ("cmms_equipment rows under CV-001",
         f"SELECT equipment_number, manufacturer, model_number, uns_path::text "
         f"FROM cmms_equipment WHERE tenant_id = '{TENANT_ID}' "
         f"AND (id = '{EQUIPMENT_ID_CV001}' OR parent_asset_id = '{EQUIPMENT_ID_CV001}') "
         f"ORDER BY equipment_number"),
        ("kg_relationships by type (this seed)",
         f"SELECT relationship_type, count(*) FROM kg_relationships "
         f"WHERE tenant_id = '{TENANT_ID}' AND proposed_by = 'mike-garage-tenant.sql v1' "
         f"GROUP BY relationship_type ORDER BY relationship_type"),
    ]
    log.info("Verifying tenant %s on staging...", TENANT_ID)
    with psycopg2.connect(get_database_url(), sslmode="require") as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f"SET app.current_tenant_id = '{TENANT_ID}'")
            cur.execute(f"SET app.tenant_id = '{TENANT_ID}'")
            log.info("--- counts ---")
            for label, q in queries:
                cur.execute(q)
                (n,) = cur.fetchone()
                marker = "✔" if n > 0 else "✗"
                log.info("  %s %-50s %d", marker, label, n)
            for label, q in detail_queries:
                log.info("--- %s ---", label)
                cur.execute(q)
                for row in cur.fetchall():
                    log.info("  %s", row)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true",
                   help="Apply in a transaction, then rollback.")
    g.add_argument("--commit", action="store_true",
                   help="Apply and commit.")
    g.add_argument("--verify", action="store_true",
                   help="Read-only count check.")
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
