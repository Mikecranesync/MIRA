"""Post-deploy schema verification for Phase 0 (migrations 025/026/027).

Checks that the three Phase 0 tables, their indexes, RLS policies, CHECK
constraints, and factorylm_app grants exist as declared in
`mira-hub/db/migrations/02{5,6,7}_*.sql`. Connects via NEON_DATABASE_URL
(typically supplied by Doppler: `factorylm/dev`, `/stg`, or `/prd`).

Usage
-----
    NEON_DATABASE_URL=... python tools/verify_phase0_deploy.py
    doppler run --project factorylm --config stg -- python tools/verify_phase0_deploy.py

Exit codes
----------
    0 — every check passed
    1 — one or more checks failed (see the table on stdout)
    2 — could not connect to the database / NEON_DATABASE_URL unset

Output is a single PASS/FAIL banner plus a checklist table. Designed to
be run as a step in a GitHub Actions workflow with `set -e` so the job
fails on any drift.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

import psycopg2

# Expected schema. Mirrors `mira-hub/db/migrations/025-027*.sql`.
#
# Keeping this hand-written rather than introspected lets the script catch
# accidental schema drift (column removed, RLS policy dropped, grant
# stripped) — exactly what a re-apply against a half-migrated branch could
# silently cause if the source SQL was edited without bumping the migration.

EXPECTED_TABLES = ("tag_entities", "wiring_connections", "ai_suggestions")

EXPECTED_COLUMNS: dict[str, set[str]] = {
    "tag_entities": {
        "id",
        "tenant_id",
        "uns_path",
        "sparkplug_topic",
        "opcua_node_id",
        "symbolic_name",
        "data_type",
        "units",
        "scaling",
        "source_kind",
        "source_address",
        "component_instance_id",
        "expected_envelope",
        "approval_state",
        "proposed_by",
        "evidence_summary",
        "created_at",
        "updated_at",
    },
    "wiring_connections": {
        "id",
        "tenant_id",
        "source_entity_id",
        "source_terminal",
        "dest_entity_id",
        "dest_terminal",
        "wire_number",
        "cable_id",
        "gauge_awg",
        "color",
        "function_class",
        "drawing_reference",
        "approval_state",
        "proposed_by",
        "evidence_summary",
        "created_at",
        "updated_at",
    },
    "ai_suggestions": {
        "id",
        "tenant_id",
        "suggestion_type",
        "source_kind",
        "source_document_id",
        "source_page",
        "source_id",
        "extracted_data",
        "confidence",
        "status",
        "risk_level",
        "proposed_by",
        "reviewed_by",
        "reviewed_at",
        "review_note",
        "title",
        "body",
        "created_at",
        "updated_at",
    },
}

EXPECTED_INDEXES = (
    # tag_entities (025)
    "idx_tag_entities_uns_path_gist",
    "idx_tag_entities_source_address",
    "idx_tag_entities_sparkplug_topic",
    "idx_tag_entities_component",
    "idx_tag_entities_pending",
    # wiring_connections (026)
    "idx_wiring_connections_source",
    "idx_wiring_connections_dest",
    "idx_wiring_connections_wire_number",
    "idx_wiring_connections_cable",
    "idx_wiring_connections_pending",
    # ai_suggestions (027)
    "idx_ai_suggestions_pending",
    "idx_ai_suggestions_risk",
    "idx_ai_suggestions_source_doc",
    "idx_ai_suggestions_reviewer",
)

EXPECTED_POLICIES = {
    "tag_entities": "tag_entities_tenant",
    "wiring_connections": "wiring_connections_tenant",
    "ai_suggestions": "ai_suggestions_tenant",
}

EXPECTED_GRANTS = {
    "tag_entities": {"SELECT", "INSERT", "UPDATE"},
    "wiring_connections": {"SELECT", "INSERT", "UPDATE"},
    "ai_suggestions": {"SELECT", "INSERT", "UPDATE"},
}


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""


def _check_tables(cur) -> list[CheckResult]:
    out: list[CheckResult] = []
    for tbl in EXPECTED_TABLES:
        cur.execute("SELECT to_regclass(%s)", (f"public.{tbl}",))
        exists = cur.fetchone()[0] is not None
        out.append(
            CheckResult(
                f"table {tbl}",
                exists,
                "exists" if exists else "MISSING",
            )
        )
    return out


def _check_columns(cur) -> list[CheckResult]:
    out: list[CheckResult] = []
    for tbl, expected in EXPECTED_COLUMNS.items():
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=%s",
            (tbl,),
        )
        present = {r[0] for r in cur.fetchall()}
        missing = expected - present
        out.append(
            CheckResult(
                f"columns {tbl}",
                not missing,
                "all present" if not missing else f"MISSING: {sorted(missing)}",
            )
        )
    return out


def _check_indexes(cur) -> list[CheckResult]:
    out: list[CheckResult] = []
    for idx in EXPECTED_INDEXES:
        cur.execute("SELECT to_regclass(%s)", (f"public.{idx}",))
        exists = cur.fetchone()[0] is not None
        out.append(
            CheckResult(
                f"index {idx}",
                exists,
                "exists" if exists else "MISSING",
            )
        )
    return out


def _check_rls(cur) -> list[CheckResult]:
    out: list[CheckResult] = []
    for tbl in EXPECTED_TABLES:
        # Look up by name rather than ::regclass cast — the cast raises if
        # the table is absent, which would crash this script before it
        # could report the failure cleanly.
        cur.execute(
            "SELECT c.relrowsecurity FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relname = %s",
            (tbl,),
        )
        row = cur.fetchone()
        if row is None:
            out.append(CheckResult(f"RLS enabled {tbl}", False, "TABLE MISSING"))
            continue
        enabled = bool(row[0])
        out.append(
            CheckResult(
                f"RLS enabled {tbl}",
                enabled,
                "enabled" if enabled else "DISABLED",
            )
        )
    for tbl, pol in EXPECTED_POLICIES.items():
        cur.execute(
            "SELECT 1 FROM pg_policies WHERE schemaname='public' "
            "AND tablename=%s AND policyname=%s",
            (tbl, pol),
        )
        exists = cur.fetchone() is not None
        out.append(
            CheckResult(
                f"policy {pol}",
                exists,
                "present" if exists else "MISSING",
            )
        )
    return out


def _check_grants(cur) -> list[CheckResult]:
    out: list[CheckResult] = []
    for tbl, expected in EXPECTED_GRANTS.items():
        cur.execute(
            "SELECT privilege_type FROM information_schema.role_table_grants "
            "WHERE grantee='factorylm_app' AND table_schema='public' "
            "AND table_name=%s",
            (tbl,),
        )
        granted = {r[0] for r in cur.fetchall()}
        missing = expected - granted
        out.append(
            CheckResult(
                f"grants {tbl} factorylm_app",
                not missing,
                f"{sorted(expected)}" if not missing else f"MISSING: {sorted(missing)}",
            )
        )
    return out


def _check_check_constraints(cur) -> list[CheckResult]:
    """Spot-check the CHECK constraints that gate writer typos at INSERT time."""
    out: list[CheckResult] = []
    checks = [
        ("tag_entities", "data_type", {"BOOL", "REAL", "INT16", "STRING"}),
        ("tag_entities", "source_kind", {"plc_address", "modbus_register", "sparkplug_metric"}),
        ("tag_entities", "approval_state", {"proposed", "verified", "rejected", "needs_review"}),
        (
            "ai_suggestions",
            "suggestion_type",
            {
                "kg_edge",
                "kg_entity",
                "tag_mapping",
                "component_profile",
                "uns_confirmation",
                "namespace_move",
            },
        ),
        ("ai_suggestions", "status", {"pending", "accepted", "rejected", "deferred", "superseded"}),
        ("ai_suggestions", "risk_level", {"low", "medium", "high", "safety_critical"}),
    ]
    for tbl, col, must_include in checks:
        cur.execute(
            """SELECT pg_get_constraintdef(con.oid)
                 FROM pg_constraint con
                 JOIN pg_class cls ON cls.oid = con.conrelid
                WHERE cls.relname = %s
                  AND con.contype = 'c'
                  AND pg_get_constraintdef(con.oid) ILIKE %s""",
            (tbl, f"%{col}%"),
        )
        defs = [r[0] for r in cur.fetchall()]
        joined = " | ".join(defs)
        missing_values = [v for v in must_include if v not in joined]
        out.append(
            CheckResult(
                f"CHECK {tbl}.{col}",
                not missing_values and bool(defs),
                "ok"
                if not missing_values and defs
                else ("NO CHECK FOUND" if not defs else f"MISSING values: {missing_values}"),
            )
        )
    return out


def _print_table(results: list[CheckResult]) -> None:
    width_name = max(len(r.name) for r in results)
    print(f"{'CHECK'.ljust(width_name)}  STATUS  DETAIL")
    print(f"{'-' * width_name}  ------  ------")
    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"{r.name.ljust(width_name)}  {status:<6}  {r.detail}")


def main() -> int:
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        print("ERROR: NEON_DATABASE_URL not set", file=sys.stderr)
        return 2

    try:
        conn = psycopg2.connect(url)
    except Exception as e:
        print(f"ERROR: connect failed: {e}", file=sys.stderr)
        return 2

    try:
        with conn:
            with conn.cursor() as cur:
                # Print which DB host we're against — useful for log triage.
                cur.execute("SELECT current_database(), inet_server_addr()")
                row = cur.fetchone() or ("?", None)
                db, host = row[0], row[1]
                print(f"Verifying Phase 0 schema against db={db} host={host or 'pooler'}")
                print()

                results: list[CheckResult] = []
                results.extend(_check_tables(cur))
                results.extend(_check_columns(cur))
                results.extend(_check_indexes(cur))
                results.extend(_check_rls(cur))
                results.extend(_check_grants(cur))
                results.extend(_check_check_constraints(cur))
    finally:
        conn.close()

    _print_table(results)

    failed = [r for r in results if not r.passed]
    print()
    if failed:
        print(f"RESULT: FAIL  ({len(failed)}/{len(results)} checks failed)")
        return 1
    print(f"RESULT: PASS  ({len(results)} checks passed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
