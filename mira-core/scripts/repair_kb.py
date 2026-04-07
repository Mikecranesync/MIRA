#!/usr/bin/env python3
"""KB Repair — backfills equipment_type on all NULL rows.

Uses priority-ordered keyword matching on content + source_url + manufacturer.
Idempotent: only touches rows where equipment_type IS NULL.

Usage:
    doppler run --project factorylm --config prd -- \
      python3 mira-core/scripts/repair_kb.py [--dry-run] [--batch-size N]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("repair-kb")

# Priority-ordered: first match wins per row.
# Each entry: (equipment_type, [keyword_fragments_any_of])
# Matched against LOWER(content || ' ' || COALESCE(source_url,'') || ' ' || COALESCE(manufacturer,''))
EQUIPMENT_TYPE_RULES: list[tuple[str, list[str]]] = [
    ("vfd", [
        "variable frequency drive", "variable-frequency", "powerflex", "altivar",
        "sinamics g", "sinamics s", "acs880", "acs800", "acs550", "acs310",
        "gs10", "gs20", "gs30", "durapulse", "a1000", "v1000", "l1000",
        "inverter drive", "vfd fault", "drive fault", "drive parameter",
        "output frequency", "output current limit", "motor overload fault",
    ]),
    ("motor", [
        "induction motor", "motor winding", "stator winding", "rotor",
        "motor thermal", "motor efficiency", "nema motor", "motor nameplate",
        "motor insulation", "motor bearing", "motor starting", "motor protection",
        "squirrel cage", "wound rotor", "synchronous motor",
    ]),
    ("plc", [
        "programmable logic controller", "controllogix", "compactlogix",
        "micro820", "micro850", "s7-1200", "s7-1500", "s7-300", "s7-400",
        "ladder logic", "structured text", "function block", "plc program",
        "input/output module", "cpu module", "rack slot",
    ]),
    ("contactor", [
        "3rt", "3tf", "iec contactor", "nema contactor", "magnetic contactor",
        "contactor coil", "auxiliary contact", "overload relay",
        "motor starter", "direct-on-line", "dol starter",
    ]),
    ("circuit_breaker", [
        "circuit breaker", "molded case", "mccb", "acb", "air circuit breaker",
        "interrupting capacity", "trip unit", "thermal magnetic",
    ]),
    ("bearing", [
        "rolling element bearing", "deep groove ball bearing", "spherical roller",
        "tapered roller", "bearing lubrication", "regreasing", "bearing failure",
        "bearing fluting", "shaft voltage", "edm bearing", "bearing race",
        "vibration analysis", "bearing defect frequency",
    ]),
    ("hydraulic", [
        "hydraulic cylinder", "hydraulic pump", "hydraulic valve",
        "hydraulic pressure", "hydraulic fluid", "hydraulic system",
        "proportional valve", "directional control valve", "relief valve",
    ]),
    ("pneumatic", [
        "pneumatic cylinder", "air cylinder", "solenoid valve",
        "pneumatic actuator", "compressed air", "frl unit", "air preparation",
    ]),
    ("conveyor", [
        "conveyor belt", "belt conveyor", "roller conveyor",
        "conveyor drive", "take-up", "tail pulley", "head pulley",
    ]),
    ("sensor", [
        "4-20 ma", "4-20ma", "resistance temperature detector", "rtd sensor",
        "thermocouple", "proximity sensor", "photoelectric sensor",
        "pressure transmitter", "level transmitter", "flow transmitter",
        "analog input", "loop-powered", "two-wire transmitter",
    ]),
    ("transformer", [
        "distribution transformer", "dry-type transformer", "kva transformer",
        "transformer winding", "transformer tap", "primary voltage",
        "secondary voltage", "transformer nameplate",
    ]),
    ("compressor", [
        "air compressor", "reciprocating compressor", "screw compressor",
        "centrifugal compressor", "compressor valve", "compressor unloader",
    ]),
    ("hmi", [
        "panelview", "human machine interface", "operator panel",
        "touch screen hmi", "hmi tag", "hmi program",
    ]),
]


def build_case_sql(rules: list[tuple[str, list[str]]], tenant_id: str) -> str:
    """Build a single UPDATE statement with CASE WHEN for all rules."""
    searchable = "LOWER(content || ' ' || COALESCE(source_url, '') || ' ' || COALESCE(manufacturer, ''))"
    when_clauses = []
    for eq_type, keywords in rules:
        conditions = " OR ".join(f"{searchable} LIKE '%{kw}%'" for kw in keywords)
        when_clauses.append(f"    WHEN {conditions} THEN '{eq_type}'")

    case_expr = "CASE\n" + "\n".join(when_clauses) + "\n    ELSE 'general'\n  END"
    return (
        f"UPDATE knowledge_entries\n"
        f"SET equipment_type = {case_expr}\n"
        f"WHERE tenant_id = '{tenant_id}'\n"
        f"  AND equipment_type IS NULL"
    )


def run(dry_run: bool, batch_size: int) -> None:
    url = os.environ.get("NEON_DATABASE_URL")
    tenant_id = os.environ.get("MIRA_TENANT_ID")
    if not url or not tenant_id:
        log.error("NEON_DATABASE_URL and MIRA_TENANT_ID required")
        sys.exit(1)

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except ImportError:
        log.error("sqlalchemy not installed")
        sys.exit(1)

    engine = create_engine(
        url, poolclass=NullPool,
        connect_args={"sslmode": "require"}, pool_pre_ping=True,
    )

    sql = build_case_sql(EQUIPMENT_TYPE_RULES, tenant_id)

    with engine.connect() as conn:
        # Count before
        before = conn.execute(
            text("SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = :tid AND equipment_type IS NULL"),
            {"tid": tenant_id},
        ).scalar()
        log.info("Rows with NULL equipment_type: %d", before)

        if dry_run:
            log.info("DRY RUN — SQL that would run:")
            print(sql[:500] + "...[truncated]")
            return

        log.info("Running equipment_type backfill...")
        result = conn.execute(text(sql))
        conn.commit()
        updated = result.rowcount
        log.info("Updated %d rows", updated)

        # Distribution after
        rows = conn.execute(
            text("SELECT equipment_type, COUNT(*) as n FROM knowledge_entries "
                 "WHERE tenant_id = :tid GROUP BY equipment_type ORDER BY n DESC"),
            {"tid": tenant_id},
        ).fetchall()
        log.info("equipment_type distribution after backfill:")
        for r in rows:
            log.info("  %6d  %s", r[1], r[0] or "NULL")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=5000)
    args = parser.parse_args()
    run(args.dry_run, args.batch_size)
