"""ctx_enrichment — query approved PLC signals from kg_entities for prompt injection.

Called from engine.py's _build_ctx_signals_context() via asyncio.to_thread
(psycopg2 is synchronous). Never raises — returns [] on any miss.
"""

from __future__ import annotations

import json
import logging
import os

import psycopg2

logger = logging.getLogger("mira-gsd")

_SIGNAL_LIMIT = int(os.getenv("MIRA_CTX_SIGNALS_LIMIT", "20"))


def fetch_ctx_approved_signals(tenant_id: str, ltree_prefix: str) -> list[dict]:
    """Return approved kg_entity signals whose uns_path is a descendant of ltree_prefix.

    Queries entity_type='signal', approval_state = 'verified' (deployed answers cite verified only — train-before-deploy).
    ltree_prefix is a dot-notation path (e.g. 'enterprise.site1.area1').

    Returns a list of dicts with keys: name, uns_path, roles, confidence.
    Returns [] if NEON_DATABASE_URL is unset, on DB errors, or when no rows match.
    """
    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not db_url:
        return []
    try:
        conn = psycopg2.connect(db_url)
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT name,
                           entity_id,
                           properties->'roles' AS roles_json,
                           (properties->>'confidence')::text AS confidence
                      FROM kg_entities
                     WHERE tenant_id = %s::uuid
                       AND entity_type = 'signal'
                       AND approval_state = 'verified'
                       AND uns_path <@ %s::ltree
                     ORDER BY uns_path
                     LIMIT %s
                    """,
                    (tenant_id, ltree_prefix, _SIGNAL_LIMIT),
                )
                rows = cur.fetchall()
        conn.close()
        result = []
        for name, uns_path, roles_json, confidence in rows:
            try:
                roles = json.loads(roles_json) if roles_json else []
            except (TypeError, ValueError):
                roles = []
            result.append(
                {
                    "name": name,
                    "uns_path": uns_path,
                    "roles": roles,
                    "confidence": confidence,
                }
            )
        return result
    except Exception as exc:  # noqa: BLE001
        logger.debug("ctx_enrichment miss tenant=%r prefix=%r: %s", tenant_id, ltree_prefix, exc)
        return []
