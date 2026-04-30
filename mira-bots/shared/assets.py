"""UNS-style asset hierarchy queries (Unit 5 of 90-day MVP).

Schema lives in mira-core/mira-ingest/db/migrations/011_assets_uns.sql.

These helpers back the Telegram /asset command and (later) the QR
pre-load context flow (Unit 7). They never raise on infra error — same
contract as neon_recall.py: missing NEON_DATABASE_URL or sqlalchemy
returns [] / None and logs a warning. The bot must keep running.

Connection pattern follows neon_recall.py: NullPool + sslmode=require.
NeonDB's PgBouncer handles pooling; we never pool application-side.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("mira-gsd")

# ltree label rules: [A-Za-z0-9_], at least 1 char, max 256.
# Reject anything else BEFORE building SQL — defense in depth on top of
# parameterized queries.
_LTREE_LABEL_RE = re.compile(r"^[A-Za-z0-9_]{1,256}$")
_LTREE_PATH_RE = re.compile(r"^[A-Za-z0-9_]{1,256}(\.[A-Za-z0-9_]{1,256})*$")


def _validate_ltree_path(path: str) -> bool:
    """Return True iff path is a syntactically valid ltree path."""
    if not path:
        return False
    return bool(_LTREE_PATH_RE.fullmatch(path))


def _connect():
    """Return (engine, text) or (None, None) if NeonDB unavailable.

    Mirrors neon_recall._connect pattern. Lazy-imports sqlalchemy so the
    bot still boots in test environments without it.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None, None
    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        return None, None
    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return engine, text


def list_top_levels(tenant_id: str, depth: int = 2) -> list[dict]:
    """Return distinct ltree prefixes up to `depth` levels.

    Used by `/asset` (no-arg) to show the customer's top-level hierarchy
    so they can drill in. Empty list on infra error or no matches.
    """
    if not tenant_id or depth < 1:
        return []
    engine, text = _connect()
    if engine is None or text is None:
        return []
    try:
        sql = """
            SELECT DISTINCT
              subltree(uns_path, 0, LEAST(nlevel(uns_path), :depth))::text AS path,
              MAX(name) FILTER (
                WHERE nlevel(uns_path) = LEAST(nlevel(uns_path), :depth)
              ) AS name
            FROM assets
            WHERE tenant_id = :tid
            GROUP BY subltree(uns_path, 0, LEAST(nlevel(uns_path), :depth))
            ORDER BY path
            LIMIT 50
        """
        with engine.connect() as conn:
            rows = conn.execute(text(sql), {"tid": tenant_id, "depth": depth}).mappings().fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("assets.list_top_levels failed: %s", e)
        return []


def list_children(tenant_id: str, parent_path: str) -> list[dict]:
    """Return assets exactly one level below `parent_path`.

    Uses ltree lquery `parent.*{1}` for "one level deeper". Empty list on
    invalid path, infra error, or no matches.
    """
    if not tenant_id or not _validate_ltree_path(parent_path):
        return []
    engine, text = _connect()
    if engine is None or text is None:
        return []
    try:
        # ltree's `~` operator with `parent.*{1}` matches paths that are
        # exactly one level below `parent`. Cast to lquery via explicit
        # bind variable concatenation done server-side.
        sql = """
            SELECT
              id::text AS id,
              name,
              uns_path::text AS path,
              asset_tag,
              atlas_asset_id
            FROM assets
            WHERE tenant_id = :tid
              AND uns_path ~ (:parent || '.*{1}')::lquery
            ORDER BY uns_path
            LIMIT 50
        """
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    text(sql),
                    {"tid": tenant_id, "parent": parent_path},
                )
                .mappings()
                .fetchall()
            )
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("assets.list_children failed parent=%s: %s", parent_path, e)
        return []


def get_asset(tenant_id: str, full_path: str) -> dict | None:
    """Return single asset record by exact uns_path. None if missing."""
    if not tenant_id or not _validate_ltree_path(full_path):
        return None
    engine, text = _connect()
    if engine is None or text is None:
        return None
    try:
        sql = """
            SELECT
              id::text AS id,
              name,
              uns_path::text AS path,
              asset_tag,
              atlas_asset_id,
              created_at
            FROM assets
            WHERE tenant_id = :tid
              AND uns_path = :path::ltree
            LIMIT 1
        """
        with engine.connect() as conn:
            row = (
                conn.execute(
                    text(sql),
                    {"tid": tenant_id, "path": full_path},
                )
                .mappings()
                .fetchone()
            )
        return dict(row) if row else None
    except Exception as e:
        logger.warning("assets.get_asset failed path=%s: %s", full_path, e)
        return None


def format_asset_card(asset: dict) -> str:
    """One-asset Markdown summary for Telegram. Plain text fallback safe."""
    lines = [f"*{asset.get('name') or asset['path']}*"]
    lines.append(f"`{asset['path']}`")
    if asset.get("asset_tag"):
        lines.append(f"QR tag: `{asset['asset_tag']}`")
    if asset.get("atlas_asset_id"):
        lines.append(f"Atlas ID: {asset['atlas_asset_id']}")
    return "\n".join(lines)


def format_hierarchy_list(rows: list[dict], parent_label: str | None = None) -> str:
    """Multi-line listing of children/top-levels for Telegram."""
    if not rows:
        if parent_label:
            return f"No assets under `{parent_label}`."
        return "No assets registered yet."
    header = f"Children of `{parent_label}`:" if parent_label else "Top-level assets:"
    lines = [header]
    for r in rows:
        label = r.get("name") or r["path"].split(".")[-1]
        lines.append(f"  • `{r['path']}` — {label}")
    lines.append("\nUse `/asset <path>` to descend.")
    return "\n".join(lines)
