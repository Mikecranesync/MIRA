#!/usr/bin/env python3
"""Atlas <-> NeonDB asset sync.

Two-way last-write-wins by updated_at. Match key: Atlas.bar_code = NeonDB.equipment_number.

Synced fields (bidirectional):
    Atlas.name              <-> NeonDB.description
    Atlas.manufacturer      <-> NeonDB.manufacturer
    Atlas.model             <-> NeonDB.model_number
    Atlas.serial_number     <-> NeonDB.serial_number
    Atlas.area              <-> NeonDB.location

System-specific fields are NOT synced (Atlas: status/downtime/work_orders; NeonDB:
equipment_type/criticality/PLC tag/UNS path).

Env vars (all required for --loop, NEON_DATABASE_URL + ATLAS_DATABASE_URL for --once):
    NEON_DATABASE_URL       NeonDB connection string
    ATLAS_DATABASE_URL      Atlas Postgres connection string (postgresql://user:pw@host:port/db)
    ATLAS_COMPANY_ID        Atlas company.id to scope (default 2)
    HUB_TENANT_ID           NeonDB tenants.id (UUID) for the same logical tenant
    SYNC_INTERVAL_SECONDS   loop sleep (default 60)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from typing import Any

import psycopg2
import psycopg2.extras

# Match key + fields we copy in both directions.
# (atlas_col, neon_col)
SYNC_FIELDS: list[tuple[str, str]] = [
    ("name", "description"),
    ("manufacturer", "manufacturer"),
    ("model", "model_number"),
    ("serial_number", "serial_number"),
    ("area", "location"),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("atlas-hub-sync")


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        sys.exit(f"{name} not set")
    return v


def fetch_atlas(conn, company_id: int) -> dict[str, dict[str, Any]]:
    """Return {bar_code: row} for non-archived assets in this company that have a bar_code."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT id, name, manufacturer, model, serial_number, area, bar_code,
               updated_at, company_id
          FROM asset
         WHERE company_id = %s AND archived = false AND bar_code IS NOT NULL AND bar_code <> ''
        """,
        (company_id,),
    )
    return {r["bar_code"]: dict(r) for r in cur.fetchall()}


def fetch_neon(conn, tenant_id: str) -> dict[str, dict[str, Any]]:
    """Return {equipment_number: row} for this tenant."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT id, equipment_number, manufacturer, model_number, serial_number,
               location, description, updated_at, atlas_id, cmms_synced_at
          FROM cmms_equipment
         WHERE tenant_id = %s
        """,
        (tenant_id,),
    )
    return {r["equipment_number"]: dict(r) for r in cur.fetchall()}


def atlas_payload(neon_row: dict[str, Any]) -> dict[str, Any]:
    """Translate NeonDB row -> Atlas column values."""
    return {
        "name": neon_row.get("description") or neon_row["equipment_number"],
        "manufacturer": neon_row.get("manufacturer") or "Unknown",
        "model": neon_row.get("model_number"),
        "serial_number": neon_row.get("serial_number"),
        "area": neon_row.get("location"),
    }


def neon_payload(atlas_row: dict[str, Any]) -> dict[str, Any]:
    """Translate Atlas row -> NeonDB column values."""
    return {
        "description": atlas_row.get("name"),
        "manufacturer": atlas_row.get("manufacturer") or "Unknown",
        "model_number": atlas_row.get("model"),
        "serial_number": atlas_row.get("serial_number"),
        "location": atlas_row.get("area"),
    }


def update_neon_from_atlas(neon_conn, neon_id: str, atlas_row: dict[str, Any], winning_ts) -> None:
    p = neon_payload(atlas_row)
    cur = neon_conn.cursor()
    cur.execute(
        """
        UPDATE cmms_equipment
           SET description = %s,
               manufacturer = %s,
               model_number = %s,
               serial_number = %s,
               location = %s,
               updated_at = %s,
               atlas_id = %s,
               cmms_synced_at = NOW()
         WHERE id = %s
        """,
        (
            p["description"], p["manufacturer"], p["model_number"],
            p["serial_number"], p["location"],
            winning_ts, str(atlas_row["id"]), neon_id,
        ),
    )


def update_atlas_from_neon(atlas_conn, atlas_id: int, neon_row: dict[str, Any], winning_ts) -> None:
    p = atlas_payload(neon_row)
    cur = atlas_conn.cursor()
    cur.execute(
        """
        UPDATE asset
           SET name = %s,
               manufacturer = %s,
               model = %s,
               serial_number = %s,
               area = %s,
               updated_at = %s
         WHERE id = %s
        """,
        (
            p["name"], p["manufacturer"], p["model"],
            p["serial_number"], p["area"],
            winning_ts, atlas_id,
        ),
    )


def insert_into_neon(neon_conn, tenant_id: str, bar_code: str, atlas_row: dict[str, Any]) -> None:
    p = neon_payload(atlas_row)
    cur = neon_conn.cursor()
    cur.execute(
        """
        INSERT INTO cmms_equipment
            (tenant_id, equipment_number, manufacturer, model_number, serial_number,
             location, description, updated_at, atlas_id, cmms_synced_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (equipment_number) DO NOTHING
        """,
        (
            tenant_id, bar_code,
            p["manufacturer"], p["model_number"], p["serial_number"],
            p["location"], p["description"],
            atlas_row["updated_at"], str(atlas_row["id"]),
        ),
    )


def insert_into_atlas(atlas_conn, company_id: int, equipment_number: str, neon_row: dict[str, Any]) -> int:
    """Insert new Atlas asset; return its id. Uses asset_seq + custom_sequence.asset_sequence."""
    p = atlas_payload(neon_row)
    cur = atlas_conn.cursor()
    # Get next asset id from Hibernate sequence
    cur.execute("SELECT nextval('asset_seq')")
    new_id = cur.fetchone()[0]
    # Bump per-company custom_sequence.asset_sequence and use it for custom_id
    cur.execute(
        "UPDATE custom_sequence SET asset_sequence = asset_sequence + 1 "
        "WHERE company_id = %s RETURNING asset_sequence",
        (company_id,),
    )
    row = cur.fetchone()
    custom_seq = row[0] if row else new_id
    custom_id = f"A{custom_seq:06d}"
    cur.execute(
        """
        INSERT INTO asset
            (id, created_at, updated_at, archived, name, custom_id, manufacturer, model,
             serial_number, area, bar_code, company_id, is_demo, status)
        VALUES (%s, %s, %s, false, %s, %s, %s, %s, %s, %s, %s, %s, false, 0)
        """,
        (
            new_id, neon_row["updated_at"], neon_row["updated_at"],
            p["name"], custom_id, p["manufacturer"], p["model"],
            p["serial_number"], p["area"], equipment_number, company_id,
        ),
    )
    return new_id


def reconcile(atlas_conn, neon_conn, company_id: int, tenant_id: str) -> dict[str, int]:
    atlas_rows = fetch_atlas(atlas_conn, company_id)
    neon_rows = fetch_neon(neon_conn, tenant_id)

    stats = {"a_to_n": 0, "n_to_a": 0, "new_to_n": 0, "new_to_a": 0, "unchanged": 0}

    keys = set(atlas_rows) | set(neon_rows)
    for key in keys:
        a = atlas_rows.get(key)
        n = neon_rows.get(key)

        if a and not n:
            insert_into_neon(neon_conn, tenant_id, key, a)
            stats["new_to_n"] += 1
            log.info("INSERT -> NeonDB: %s (from Atlas id=%s)", key, a["id"])
            continue

        if n and not a:
            new_id = insert_into_atlas(atlas_conn, company_id, key, n)
            # Backfill atlas_id on the NeonDB row so future cycles match
            cur = neon_conn.cursor()
            cur.execute(
                "UPDATE cmms_equipment SET atlas_id = %s, cmms_synced_at = NOW() WHERE id = %s",
                (str(new_id), n["id"]),
            )
            stats["new_to_a"] += 1
            log.info("INSERT -> Atlas: %s (new id=%s)", key, new_id)
            continue

        # Both sides exist — check if synced fields actually differ. This makes the
        # sync trigger-safe: NeonDB's BEFORE UPDATE trigger bumps updated_at on every
        # write (including our own sync writes), so we can't trust timestamps alone.
        # Compare the values we care about.
        differs = False
        for atlas_col, neon_col in SYNC_FIELDS:
            av = (a.get(atlas_col) or "").strip() if isinstance(a.get(atlas_col), str) else a.get(atlas_col)
            nv = (n.get(neon_col) or "").strip() if isinstance(n.get(neon_col), str) else n.get(neon_col)
            if av != nv:
                differs = True
                break

        if not differs:
            stats["unchanged"] += 1
            if not n.get("atlas_id"):
                cur = neon_conn.cursor()
                cur.execute(
                    "UPDATE cmms_equipment SET atlas_id = %s, cmms_synced_at = NOW() WHERE id = %s",
                    (str(a["id"]), n["id"]),
                )
                log.info("LINKED: %s neon=%s <-> atlas=%s", key, n["id"], a["id"])
            continue

        # Real divergence — pick winner by updated_at (LWW). Strip tz for comparison.
        a_ts = a["updated_at"]
        n_ts = n["updated_at"]
        n_ts_cmp = n_ts.replace(tzinfo=None) if n_ts and n_ts.tzinfo else n_ts

        if a_ts >= n_ts_cmp:
            update_neon_from_atlas(neon_conn, n["id"], a, a_ts)
            stats["a_to_n"] += 1
            log.info("Atlas -> Neon: %s (atlas=%s neon=%s)", key, a_ts, n_ts_cmp)
        else:
            update_atlas_from_neon(atlas_conn, a["id"], n, n_ts_cmp)
            stats["n_to_a"] += 1
            log.info("Neon -> Atlas: %s (neon=%s atlas=%s)", key, n_ts_cmp, a_ts)

    atlas_conn.commit()
    neon_conn.commit()
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="Atlas <-> NeonDB asset sync")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="Run one sync pass and exit")
    mode.add_argument("--loop", action="store_true", help="Loop forever with SYNC_INTERVAL_SECONDS")
    args = ap.parse_args()

    neon_url = env("NEON_DATABASE_URL")
    atlas_url = env("ATLAS_DATABASE_URL")
    company_id = int(env("ATLAS_COMPANY_ID", "2"))
    tenant_id = env("HUB_TENANT_ID")
    interval = int(env("SYNC_INTERVAL_SECONDS", "60"))

    log.info("starting (company_id=%s tenant=%s mode=%s)",
             company_id, tenant_id, "loop" if args.loop else "once")

    heartbeat = os.environ.get("SYNC_HEARTBEAT_FILE", "/tmp/last-sync")

    while True:
        try:
            atlas_conn = psycopg2.connect(atlas_url)
            neon_conn = psycopg2.connect(neon_url)
            try:
                stats = reconcile(atlas_conn, neon_conn, company_id, tenant_id)
                log.info("cycle complete: %s", stats)
                try:
                    with open(heartbeat, "w") as f:
                        f.write(str(int(time.time())))
                except OSError:
                    pass
            finally:
                atlas_conn.close()
                neon_conn.close()
        except Exception as e:  # noqa: BLE001
            log.exception("sync cycle failed: %s", e)

        if args.once:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
