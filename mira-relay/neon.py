"""mira-relay/neon.py — thin NeonDB writer for the tag_events append-only stream.

Provides:
- insert_tag_events(rows)  — batch-insert into tag_events; fail-soft on any DB error.
- load_approved_tags(tenant_id) — load allowlist + per-tag metadata from approved_tags;
  returns a dict keyed by tag_id → {uns_path, data_type, threshold}. Fail-soft.

Connection is shared (module-level) and re-created on failure. NullPool per
.claude/rules/python-standards.md — Neon's PgBouncer handles connection pooling.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

logger = logging.getLogger("mira-relay.neon")

_engine = None  # module-level SQLAlchemy engine; lazy-init

# ---------------------------------------------------------------------------
# Engine factory (lazy, fail-soft)
# ---------------------------------------------------------------------------


def _get_engine():
    global _engine
    if _engine is not None:
        return _engine

    db_url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        logger.warning("No NEON_DATABASE_URL / DATABASE_URL set — NeonDB writes disabled")
        return None

    try:
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool

        _engine = create_engine(
            db_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        logger.info("NeonDB engine initialised (NullPool)")
        return _engine
    except Exception as exc:
        logger.warning("Failed to initialise NeonDB engine: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Public write API
# ---------------------------------------------------------------------------


insert_sql = """
    INSERT INTO tag_events (
        event_id, tenant_id, ts, uns_path, tag_id, event_type,
        prev_value, new_value, delta, threshold,
        window_start, window_end, fault_code, severity,
        raw_quality, relay_batch_id
    ) VALUES (
        :event_id, :tenant_id, :ts, CAST(:uns_path AS ltree), :tag_id, :event_type,
        CAST(:prev_value AS jsonb), CAST(:new_value AS jsonb), :delta, :threshold,
        :window_start, :window_end, :fault_code, :severity,
        :raw_quality, :relay_batch_id
    )
    ON CONFLICT (event_id) DO NOTHING
"""


def insert_tag_events(rows: list[dict[str, Any]]) -> int:
    """Batch-insert rows into tag_events. Returns count inserted.

    Rows must match the 033_tag_events.sql schema. UUIDs should be pre-assigned
    by the caller (see diff_logger.process_batch). Uses UUIDv4 (TODO: upgrade to
    UUIDv7 for k-sortable time-ordered primary keys once a v7 library is available).

    Fail-soft: any DB error is logged as a WARNING and 0 is returned. The relay
    ingest path MUST remain up even when Neon is unreachable.
    """
    if not rows:
        return 0

    engine = _get_engine()
    if engine is None:
        return 0

    # SQL is the module-level `insert_sql` constant (testable without a live DB
    # — see tests/test_neon_sql.py, which guards the ltree/jsonb cast forms).

    # Normalise + validate each row before sending to DB.
    prepped: list[dict[str, Any]] = []
    for r in rows:
        try:
            row = _normalise_row(r)
        except ValueError as exc:
            logger.warning("Skipping malformed tag_event row: %s — row=%r", exc, r)
            continue
        prepped.append(row)

    if not prepped:
        return 0

    try:
        from sqlalchemy import text

        with engine.begin() as conn:
            conn.execute(text(insert_sql), prepped)
        logger.debug("Inserted %d tag_events", len(prepped))
        return len(prepped)
    except Exception as exc:
        logger.warning("tag_events insert failed: %s", exc)
        return 0


def _normalise_row(r: dict[str, Any]) -> dict[str, Any]:
    """Validate mandatory fields and coerce types. Raises ValueError on bad input."""
    # event_id must be a valid UUID
    event_id = r.get("event_id")
    if event_id is None:
        event_id = str(uuid.uuid4())
    else:
        try:
            uuid.UUID(str(event_id))
            event_id = str(event_id)
        except ValueError as exc:
            raise ValueError(f"invalid event_id: {event_id!r}") from exc

    # tenant_id must be a valid UUID string
    tenant_id = r.get("tenant_id")
    if tenant_id is None:
        raise ValueError("tenant_id is required")
    try:
        uuid.UUID(str(tenant_id))
        tenant_id = str(tenant_id)
    except ValueError as exc:
        raise ValueError(f"invalid tenant_id: {tenant_id!r}") from exc

    # uns_path must be non-empty (Postgres will validate ltree syntax)
    uns_path = r.get("uns_path")
    if not uns_path:
        raise ValueError("uns_path is required")
    # ltree uses '.' separator; relay payload arrives with '/' which we normalise.
    uns_path = str(uns_path).replace("/", ".").strip(".")

    # raw_quality: normalise to lowercase; CHECK is good|bad|stale|NULL
    raw_quality = r.get("raw_quality")
    if raw_quality is not None:
        raw_quality = str(raw_quality).lower()
        if raw_quality not in {"good", "bad", "stale"}:
            raw_quality = None  # discard unrecognised quality rather than failing

    return {
        "event_id": event_id,
        "tenant_id": tenant_id,
        "ts": r.get("ts"),
        "uns_path": uns_path,
        "tag_id": r.get("tag_id"),
        "event_type": r.get("event_type"),
        # prev/new_value land in JSONB columns — serialise to a JSON text the
        # CAST(... AS jsonb) in insert_sql can parse (raw floats/bools/None are
        # not jsonb-adaptable by psycopg2).
        "prev_value": json.dumps(r.get("prev_value")),
        "new_value": json.dumps(r.get("new_value")),
        "delta": r.get("delta"),
        "threshold": r.get("threshold"),
        "window_start": r.get("window_start"),
        "window_end": r.get("window_end"),
        "fault_code": r.get("fault_code"),
        "severity": r.get("severity"),
        "raw_quality": raw_quality,
        "relay_batch_id": r.get("relay_batch_id"),
    }


# ---------------------------------------------------------------------------
# Allowlist reader (Phase 4 / B1)
# ---------------------------------------------------------------------------


def load_approved_tags(tenant_id: str) -> dict[str, dict[str, Any]]:
    """Load approved_tags for a tenant from NeonDB (migration 035).

    Returns a dict: tag_id → {uns_path: str, data_type: str, threshold: float|None}
    Returns {} on any DB error or if the table doesn't exist yet.

    This is the single source of truth for:
    - allowlist membership (is_allowlisted)
    - per-tag type (bool/int/float/enum → used to choose event_type)
    - per-tag threshold (value_changed threshold for floats)
    - uns_path (needed for the NOT-NULL column in tag_events)
    """
    engine = _get_engine()
    if engine is None:
        return {}

    try:
        uuid.UUID(str(tenant_id))
    except ValueError:
        logger.warning("load_approved_tags: invalid tenant_id UUID: %r", tenant_id)
        return {}

    try:
        from sqlalchemy import text

        query = text("""
            SELECT tag_id, uns_path::text AS uns_path, data_type, threshold
            FROM approved_tags
            WHERE tenant_id = :tenant_id
        """)
        with engine.connect() as conn:
            result = conn.execute(query, {"tenant_id": str(tenant_id)})
            rows = result.fetchall()

        return {
            row.tag_id: {
                "uns_path": row.uns_path,
                "data_type": row.data_type,
                "threshold": row.threshold,
            }
            for row in rows
        }
    except Exception as exc:
        logger.warning("load_approved_tags failed (tenant=%s): %s", tenant_id, exc)
        return {}
