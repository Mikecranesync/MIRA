"""wo_evidence — recall CMMS work-order history for a confirmed asset as citable evidence.

Reads the Hub NeonDB ``work_orders`` JOIN ``cmms_equipment`` tables (same store
``integrations/hub_neon.py`` writes to; CMMS family — ``tenant_id`` is TEXT, no
uuid cast). Equipment is matched by UNS-path descendant (``uns_path <@ prefix``)
or by ``equipment_number ILIKE`` the asset label, mirroring hub_neon's lookup.

Called from engine.py's _build_wo_evidence_context() (flag ENABLE_WO_EVIDENCE,
default off). psycopg2 is synchronous, so ``recall_work_orders`` wraps the query
in ``asyncio.to_thread`` — same pattern as ctx_enrichment.py. Never raises —
returns [] on any miss (unset NEON_DATABASE_URL, DB error, no rows). Every
returned field comes straight from a table column; nothing is invented.
"""

from __future__ import annotations

import asyncio
import logging
import os

import psycopg2

logger = logging.getLogger("mira-gsd")

_WO_FIELDS = (
    "work_order_number",
    "title",
    "status",
    "priority",
    "created_at",
    "closed_at",
    "fault_description",
    "resolution",
)


def _fetch_work_orders(
    tenant_id: str,
    asset_name: str,
    ltree_prefix: str | None,
    limit: int,
) -> list[dict]:
    """Synchronous Hub-NeonDB read. Returns [] on any miss; never raises."""
    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not db_url or not tenant_id or not asset_name:
        return []
    match_clauses = ["eq.equipment_number ILIKE %s"]
    params: list = [tenant_id, tenant_id, f"%{asset_name[:80]}%"]
    if ltree_prefix:
        match_clauses.append("(eq.uns_path IS NOT NULL AND eq.uns_path <@ %s::ltree)")
        params.append(ltree_prefix)
    params.append(limit)
    sql = f"""
        SELECT wo.work_order_number,
               wo.title,
               wo.status::text,
               wo.priority::text,
               wo.created_at,
               wo.closed_at,
               wo.fault_description,
               wo.resolution
          FROM work_orders wo
          JOIN cmms_equipment eq ON eq.id = wo.equipment_id
         WHERE wo.tenant_id = %s
           AND eq.tenant_id = %s
           AND ({" OR ".join(match_clauses)})
         ORDER BY wo.created_at DESC
         LIMIT %s
    """
    try:
        conn = psycopg2.connect(db_url)
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        conn.close()
        return [dict(zip(_WO_FIELDS, row)) for row in rows]
    except Exception as exc:  # noqa: BLE001 -- evidence recall must never block diagnosis
        logger.debug(
            "wo_evidence miss tenant=%r asset=%r prefix=%r: %s",
            tenant_id,
            asset_name,
            ltree_prefix,
            exc,
        )
        return []


async def recall_work_orders(
    tenant_id: str,
    asset_name: str,
    uns_path: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """Recent work orders for the confirmed asset, newest first. Never raises.

    ``uns_path`` is a dot-notation ltree prefix (e.g. ``enterprise.site1.line2``);
    optional — when absent the match falls back to equipment_number ILIKE only.
    """
    try:
        return await asyncio.to_thread(
            _fetch_work_orders, tenant_id, asset_name, uns_path or None, limit
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("wo_evidence recall failed asset=%r: %s", asset_name, exc)
        return []
