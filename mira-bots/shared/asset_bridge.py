"""Python mirror of the Hub asset bridge (#3708).

Canonical writer: ``mira-hub/src/lib/knowledge-graph/asset-bridge.ts``
(``mintAssetBridgeNode`` → ``backfillAssetUnsPath``). ``POST /api/assets`` has
minted a whole machine since #3382: the ``cmms_equipment`` row, its
``kg_entities`` equipment node, and ``cmms_equipment.uns_path``. Every Hub
consumer that needs a machine's location — the notebook, V3's scope picker,
machine memory / history / signal-history via ``resolveAssetUnsPath`` —
anchors on the ``kg_entities`` node, so a ``cmms_equipment`` row inserted
without this bridge is unplaced by construction: the register shows it and
MIRA refuses to talk about it.

Three Python writers insert ``cmms_equipment`` (bot conversations, PM
scheduling, the Atlas sync). They cannot call the TypeScript bridge, so this
module mirrors it statement for statement. Parity with the TS source is
guarded by ``mira-bots/tests/test_asset_bridge.py`` (it reads the ``.ts``
files), and ``tests/test_architecture.py`` Contract 7 refuses any Python
``cmms_equipment`` insert that bypasses ``bridge_asset``.

Works on any DB-API cursor (psycopg2 ``%s`` params). From a SQLAlchemy
connection hand over ``conn.connection.cursor()`` — same DBAPI connection,
same transaction.

Path grammar is the Hub's compact one (``enterprise.<site>.<asset>``), not the
ISA-95 form ``tools/cmms_equipment_uns_backfill.py`` writes — the bridge must
produce the same node the Hub would have.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol

from .uns_paths import slug

logger = logging.getLogger("mira-gsd")

# Mirrors asset-bridge.ts — the parity test asserts these literals match.
DEFAULT_SITE_NAME = "Main Site"
SLUG_MAX_LEN = 64
_UNIQUE_VIOLATION = "23505"
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def is_uuid_tenant(tenant_id: str | None) -> bool:
    """kg_entities.tenant_id is UUID; cmms_equipment.tenant_id is TEXT and still holds
    legacy slugs ('mike' — the HUB_TENANT_ID default in the compose files, and what
    pm_scheduler normalises a tenantless schedule to). A slug can never own a node."""
    return bool(tenant_id) and bool(_UUID_RE.match(tenant_id))


class DbCursor(Protocol):
    def execute(self, sql: str, params: Any = ...) -> Any: ...

    def fetchone(self) -> Any: ...


@dataclass(frozen=True)
class BridgeResult:
    ok: bool
    uns_path: str | None = None
    node_id: str | None = None
    created: bool = False
    reason: str | None = None


def hub_slug(value: str | None) -> str | None:
    """``uns.ts::slugify`` — ``uns_paths.slug`` capped at 64 chars, ``None`` when empty."""
    cleaned = slug(value or "")[:SLUG_MAX_LEN]
    return cleaned or None


def site_path(site: str) -> str | None:
    s = hub_slug(site)
    return f"enterprise.{s}" if s else None


def equipment_path(parent_path: str | None, tag: str) -> str | None:
    s = hub_slug(tag)
    return f"{parent_path}.{s}" if parent_path and s else None


def _resolve_tenant_parent_path(cur: DbCursor, tenant_id: str) -> str | None:
    """``cmms-sync.ts::resolveTenantParentPath`` — the tenant's deepest structural node."""
    cur.execute(
        """SELECT uns_path::text AS uns_path
             FROM kg_entities
            WHERE tenant_id = %s::uuid
              AND entity_type IN ('site', 'plant', 'line', 'production_line')
              AND uns_path IS NOT NULL
            ORDER BY nlevel(uns_path) DESC, updated_at DESC
            LIMIT 1""",
        (tenant_id,),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] else None


def _create_default_site(cur: DbCursor, tenant_id: str) -> str | None:
    path = site_path(DEFAULT_SITE_NAME)
    if not path:
        return None
    cur.execute(
        """INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state)
           VALUES (%s::uuid, 'site', %s, %s, %s::jsonb, %s::ltree, 'verified')
           ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
              SET uns_path = COALESCE(kg_entities.uns_path, EXCLUDED.uns_path),
                  updated_at = now()""",
        (
            tenant_id,
            hub_slug(DEFAULT_SITE_NAME),
            DEFAULT_SITE_NAME,
            json.dumps({"source": "asset_create_default_site"}),
            path,
        ),
    )
    return path


def resolve_or_create_asset_uns_path(cur: DbCursor, tenant_id: str, tag: str) -> str | None:
    parent = _resolve_tenant_parent_path(cur, tenant_id) or _create_default_site(cur, tenant_id)
    if not parent:
        return None
    return equipment_path(parent, tag)


def _insert_with_unique_fallback(
    cur: DbCursor, sql: str, first: tuple[Any, ...], second: tuple[Any, ...]
) -> Any:
    """``pg-unique-retry.ts::insertWithUniqueFallback`` — retry once on 23505."""
    cur.execute("SAVEPOINT sp_uniq")
    try:
        cur.execute(sql, first)
    except Exception as exc:
        cur.execute("ROLLBACK TO SAVEPOINT sp_uniq")
        if getattr(exc, "pgcode", None) != _UNIQUE_VIOLATION:
            cur.execute("RELEASE SAVEPOINT sp_uniq")
            raise
        cur.execute(sql, second)
    row = cur.fetchone()
    cur.execute("RELEASE SAVEPOINT sp_uniq")
    return row


def mint_asset_bridge_node(
    cur: DbCursor,
    tenant_id: str,
    asset_id: str,
    tag: str,
    *,
    description: str | None = None,
    manufacturer: str | None = None,
    model: str | None = None,
) -> BridgeResult:
    """``asset-bridge.ts::mintAssetBridgeNode`` — idempotent on (tenant, 'equipment', asset_id)."""
    uns_path = resolve_or_create_asset_uns_path(cur, tenant_id, tag)
    if not uns_path:
        return BridgeResult(ok=False, reason="no_uns_path")

    cur.execute(
        """SELECT id::text AS id FROM kg_entities
            WHERE tenant_id = %s::uuid AND entity_type = 'equipment' AND entity_id = %s
            LIMIT 1""",
        (tenant_id, asset_id),
    )
    existing = cur.fetchone()
    if existing:
        return BridgeResult(ok=True, uns_path=uns_path, node_id=str(existing[0]), created=False)

    base = (description or "").strip()
    properties = json.dumps(
        {
            "source": "asset_create",
            "asset_tag": tag,
            "equipment_number": tag,
            "manufacturer": manufacturer,
            "model_number": model,
        }
    )
    preferred = base or tag
    fallback = f"{base} ({tag})" if base else tag
    sql = """INSERT INTO kg_entities
               (tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state)
             VALUES (%s::uuid, 'equipment', %s, %s, %s::jsonb, %s::ltree, 'verified')
             RETURNING id::text AS id"""
    row = _insert_with_unique_fallback(
        cur,
        sql,
        (tenant_id, asset_id, preferred, properties, uns_path),
        (tenant_id, asset_id, fallback, properties, uns_path),
    )
    return BridgeResult(ok=True, uns_path=uns_path, node_id=str(row[0]), created=True)


def backfill_asset_uns_path(cur: DbCursor, tenant_id: str, asset_id: str, uns_path: str) -> None:
    """``asset-bridge.ts::backfillAssetUnsPath`` — only fills a NULL column, never overwrites."""
    cur.execute(
        """UPDATE cmms_equipment
              SET uns_path = %s::ltree, updated_at = now()
            WHERE tenant_id = %s AND id = %s AND uns_path IS NULL""",
        (uns_path, tenant_id, asset_id),
    )


def bridge_asset(
    cur: DbCursor,
    tenant_id: str,
    asset_id: str,
    tag: str,
    *,
    description: str | None = None,
    manufacturer: str | None = None,
    model: str | None = None,
) -> BridgeResult:
    """The whole bridge for one freshly inserted ``cmms_equipment`` row.

    Runs inside a SAVEPOINT so a bridge failure rolls back to the caller's
    state and never aborts the enclosing transaction (a bot work order must
    still land when the KG write fails). A failure is logged, exactly as the
    Hub route warns, and reported in the result — never raised.

    A legacy (non-UUID) tenant is refused BEFORE any SQL: the ``::uuid`` cast
    would fail inside the savepoint and read like a transient error, when it
    is a structural one — that machine stays unplaced until its tenant
    migrates (Codex F1 on #3715). The repair path for rows already written
    this way is tools/cmms_equipment_uns_backfill.py, which reports them.
    """
    if not is_uuid_tenant(tenant_id):
        logger.warning(
            "asset_bridge: asset %s under legacy tenant %r cannot be bridged — "
            "kg_entities.tenant_id is UUID-only; the row stays UNPLACED until the tenant "
            "migrates (#3708)",
            asset_id,
            tenant_id,
        )
        return BridgeResult(ok=False, reason="legacy_tenant")
    cur.execute("SAVEPOINT asset_bridge")
    try:
        result = mint_asset_bridge_node(
            cur,
            tenant_id,
            asset_id,
            tag,
            description=description,
            manufacturer=manufacturer,
            model=model,
        )
        if result.ok and result.uns_path:
            backfill_asset_uns_path(cur, tenant_id, asset_id, result.uns_path)
        cur.execute("RELEASE SAVEPOINT asset_bridge")
    except Exception as exc:
        cur.execute("ROLLBACK TO SAVEPOINT asset_bridge")
        cur.execute("RELEASE SAVEPOINT asset_bridge")
        logger.warning(
            "asset_bridge: asset %s bridge failed (%s: %s)", asset_id, type(exc).__name__, exc
        )
        return BridgeResult(ok=False, reason=f"error:{type(exc).__name__}")
    if not result.ok:
        logger.warning(
            "asset_bridge: asset %s created without a UNS path (%s) — notebook will refuse it",
            asset_id,
            result.reason,
        )
    return result
