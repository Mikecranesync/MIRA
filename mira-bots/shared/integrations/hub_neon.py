"""Direct NeonDB write for Hub work_orders + cmms_equipment tables.

Writes MIRA-created WOs into the Hub's NeonDB so they appear in the
Hub UI work-orders page.  Uses psycopg2 (already in requirements.txt).

The Hub work_orders table requires a valid equipment_id FK into
cmms_equipment.  When no matching equipment exists, a minimal record
is created so the WO insert succeeds.

Call create_hub_work_order() after a successful Atlas CMMS creation.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

logger = logging.getLogger("mira-gsd")

_PRIORITY_MAP = {
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
    "CRITICAL": "critical",
}

_SOURCE_DEFAULT = "telegram_text"


def _wo_number() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"MIRA-{ts}-{str(uuid.uuid4())[:4].upper()}"


def _get_or_create_equipment_id(
    cur: "psycopg2.extensions.cursor",
    tenant_id: str,
    asset_name: str,
) -> str:
    """Return equipment UUID for asset_name, creating a minimal record if missing."""
    search_name = (asset_name or "Unknown Equipment")[:80]

    cur.execute(
        """SELECT id FROM cmms_equipment
           WHERE tenant_id = %s AND equipment_number ILIKE %s
           LIMIT 1""",
        (tenant_id, f"%{search_name}%"),
    )
    row = cur.fetchone()
    if row:
        return str(row[0])

    eq_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO cmms_equipment
           (id, equipment_number, manufacturer, tenant_id)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (id) DO NOTHING
           RETURNING id""",
        (eq_id, search_name, "Unknown", tenant_id),
    )
    created = cur.fetchone()
    return str(created[0]) if created else eq_id


def create_hub_work_order(
    tenant_id: str,
    user_id: str,
    title: str,
    description: str,
    priority: str,
    asset_name: str,
    wo_number: str = "",
    source: str = _SOURCE_DEFAULT,
) -> dict:
    """Insert a work order into the Hub NeonDB work_orders table.

    Returns {"id": "...", "work_order_number": "..."} on success.
    Returns {"error": "..."} on any failure — never raises.
    """
    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        logger.warning("HUB_WO_SKIP: NEON_DATABASE_URL not set")
        return {"error": "NEON_DATABASE_URL not set"}

    priority_norm = _PRIORITY_MAP.get(priority.upper(), "medium")
    wo_num = wo_number or _wo_number()

    try:
        conn = psycopg2.connect(url)
        psycopg2.extras.register_uuid(conn)
        cur = conn.cursor()

        eq_id = _get_or_create_equipment_id(cur, tenant_id, asset_name or "Unknown Equipment")

        cur.execute(
            """INSERT INTO work_orders
               (work_order_number, user_id, source, equipment_id, title, description,
                priority, status, created_by_agent, tenant_id)
               VALUES (%s, %s, %s::sourcetype, %s::uuid, %s, %s,
                       %s::prioritylevel, 'open'::workorderstatus, 'MIRA', %s)
               RETURNING id, work_order_number""",
            (
                wo_num,
                str(user_id),
                source,
                eq_id,
                title[:200],
                description[:2000],
                priority_norm,
                tenant_id,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        result = {"id": str(row[0]), "work_order_number": str(row[1])}
        logger.info(
            "HUB_WO_CREATED wo_number=%s eq_id=%s tenant_id=%s",
            result["work_order_number"],
            eq_id,
            tenant_id,
        )
        return result

    except Exception as exc:
        logger.error("Hub NeonDB WO insert failed: %s", exc)
        return {"error": str(exc)}
