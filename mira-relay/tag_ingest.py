"""Tag ingestion pipeline for POST /api/v1/tags/ingest.

This is the production-grade successor to relay_server.process_tag_payload()
(which upserts the bench SQLite equipment_status cache). The new endpoint
writes the canonical NeonDB layer the master plan defines:

  - tag_events       (migration 033): append-only RAW stream, one row/reading
  - live_signal_cache(migration 020 + 036): latest-value-per-tag, extended
                     with uns_path / source_system / latest_quality /
                     freshness_status — this IS `current_tag_state`.

Behaviour (per docs/plans/current-state-gap-closure-plan.md §3 G6/G7):
  - Validate the batch (single source_system; HMAC handled by the caller).
  - Enforce the approved_tags allowlist — FAIL-CLOSED. A tag not in the
    allowlist is rejected, never stored. Mirrors the Ignition WebDev
    fail-closed allowlist (api/tags/doGet.py).
  - Normalize the raw source tag path (uns.slug semantics) for matching.
  - Resolve the UNS path WHERE POSSIBLE (from the allowlist row's uns_path).
  - Append every accepted reading to tag_events (the full truth stream).
  - Upsert the latest value into live_signal_cache.
  - Provenance: `simulated` is derived ONCE from source_system==
    "simulator" and stamped on every row in the batch — never per-row, so a
    batch can never silently mix simulated and real telemetry.
  - Cache protection: a simulated reading NEVER overwrites a real
    (simulated=false) cache row. The event is still recorded; only the
    latest-value cache is protected, so a Command-Center "live" read can
    never show fake data over real data.

Design: the pipeline (ingest_batch) is store-agnostic — it takes a TagStore.
NeonTagStore is the prod implementation (SQLAlchemy NullPool, RLS-bound, same
pattern as mira-pipeline/ignition_audit.py). Tests inject an in-memory store,
so the allowlist / normalization / provenance logic is verified without a
live NeonDB.

The slug + sanitize helpers are inlined (not imported from
mira-crawler/ingest/uns) on purpose: the relay is a lightweight Starlette
container that must not pull the heavy ingest package. Same precedent as
ignition_audit._sanitize. The slug semantics mirror uns.slug() (lowercase,
runs of non-alphanumerics → '_'); approved_tags.normalized_tag_path MUST be
produced by the same normalization at seed time.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

logger = logging.getLogger("mira-relay.tag_ingest")

VALID_SOURCE_SYSTEMS = {"ignition", "plc_bridge", "relay", "simulator"}
VALID_VALUE_TYPES = {"bool", "int", "float", "string", "enum"}
VALID_QUALITY = {"good", "bad", "stale", "uncertain"}

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


class IngestError(ValueError):
    """Raised for batch-level validation failures (bad source_system, etc.)."""


def normalize_tag_path(raw: str) -> str:
    """uns.slug-style normalization: lowercase, runs of non-alphanumerics → '_'.

    Path separators ('/', '.', ':') collapse to '_', so
    'Mira_Monitored/Conveyor/Motor_Current' → 'mira_monitored_conveyor_motor_current'.
    Mirrors mira-crawler/ingest/uns.slug() — kept local to avoid importing the
    heavy ingest package into the relay container.
    """
    if not raw:
        return ""
    return _NON_ALNUM.sub("_", raw.strip().lower()).strip("_")


def _canonical_value(value: Any) -> Optional[str]:
    """Canonical TEXT form for the tag_events.value column."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _value_columns(value_type: str, value: Any) -> tuple[Optional[str], Optional[float], Optional[bool]]:
    """Map a typed value to live_signal_cache's (text, numeric, bool) columns."""
    if value is None:
        return (None, None, None)
    if value_type == "bool":
        if isinstance(value, str):
            return (None, None, value.strip().lower() in ("true", "1", "on"))
        return (None, None, bool(value))
    if value_type in ("int", "float"):
        try:
            return (None, float(value), None)
        except (TypeError, ValueError):
            return (str(value), None, None)
    return (str(value), None, None)


@dataclass
class TagEventRow:
    tenant_id: str
    tag_path: str
    value: Optional[str]
    value_type: str
    quality: str
    source_system: str
    simulated: bool
    event_timestamp: str
    uns_path: Optional[str] = None
    equipment_entity_id: Optional[str] = None
    source_connection_id: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class RejectedTag:
    tag_path: str
    reason: str  # not_allowlisted | missing_tag_path | bad_value_type


@dataclass
class IngestResult:
    source_system: str
    simulated: bool
    accepted: int = 0
    events_written: int = 0
    state_upserts: int = 0
    cache_skipped: int = 0  # events recorded but cache NOT updated (sim-over-real)
    rejected: list[RejectedTag] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "source_system": self.source_system,
            "simulated": self.simulated,
            "accepted": self.accepted,
            "events_written": self.events_written,
            "state_upserts": self.state_upserts,
            "cache_skipped": self.cache_skipped,
            "rejected": [{"tag_path": r.tag_path, "reason": r.reason} for r in self.rejected],
        }


class TagStore(Protocol):
    """Persistence boundary for the ingest pipeline. NeonTagStore is prod;
    tests inject an in-memory implementation."""

    def load_allowlist(self, tenant_id: str, source_system: str) -> dict[str, Optional[str]]:
        """Return {normalized_tag_path: uns_path|None} for enabled rows only."""
        ...

    def current_state_simulated(self, tenant_id: str, tag_paths: list[str]) -> dict[str, bool]:
        """Return {tag_path: simulated} for existing live_signal_cache rows."""
        ...

    def persist_batch(
        self, event_rows: list[TagEventRow], state_rows: list[TagEventRow]
    ) -> tuple[int, int]:
        """Append event_rows to tag_events AND upsert state_rows into
        live_signal_cache in ONE atomic transaction. Returns
        (events_written, state_upserts)."""
        ...


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ingest_batch(payload: dict, tenant_id: str, store: TagStore) -> IngestResult:
    """Run the full ingest pipeline for one batch. Pure orchestration over the
    injected store — see module docstring for behaviour."""
    if not tenant_id:
        raise IngestError("tenant_required")

    source_system = payload.get("source_system")
    if source_system not in VALID_SOURCE_SYSTEMS:
        raise IngestError("invalid_source_system")

    source_connection_id = payload.get("source_connection_id")
    raw_tags = payload.get("tags")
    if not isinstance(raw_tags, list):
        raise IngestError("tags_must_be_list")

    # Provenance derived ONCE from the source — never per-row. This is what
    # guarantees a batch cannot silently mix simulated and real telemetry.
    simulated = source_system == "simulator"

    result = IngestResult(source_system=source_system, simulated=simulated)

    allowlist = store.load_allowlist(tenant_id, source_system)
    now = _now_iso()

    parsed: list[TagEventRow] = []
    for tag in raw_tags:
        if not isinstance(tag, dict):
            result.rejected.append(RejectedTag(tag_path=str(tag), reason="malformed_entry"))
            continue
        tag_path = tag.get("tag_path")
        if not tag_path:
            result.rejected.append(RejectedTag(tag_path="", reason="missing_tag_path"))
            continue

        norm = normalize_tag_path(tag_path)
        if norm not in allowlist:
            # Fail-closed: not on the allowlist → rejected, never stored.
            result.rejected.append(RejectedTag(tag_path=tag_path, reason="not_allowlisted"))
            continue

        value_type = tag.get("value_type", "string")
        if value_type not in VALID_VALUE_TYPES:
            result.rejected.append(RejectedTag(tag_path=tag_path, reason="bad_value_type"))
            continue

        quality = tag.get("quality", "good")
        if quality not in VALID_QUALITY:
            quality = "uncertain"  # tolerate unknown quality codes, downgrade

        canonical = _canonical_value(tag.get("value"))
        if canonical is None:
            # A reading with no value (e.g. a Bad-quality read that carries no
            # value) is not storable: live_signal_cache requires a value, and a
            # valueless event is noise. Reject — never store. (0 / false are
            # valid values: _canonical_value renders them "0" / "false".)
            result.rejected.append(RejectedTag(tag_path=tag_path, reason="null_value"))
            continue

        parsed.append(
            TagEventRow(
                tenant_id=tenant_id,
                tag_path=tag_path,
                value=canonical,
                value_type=value_type,
                quality=quality,
                source_system=source_system,
                simulated=simulated,
                event_timestamp=tag.get("ts") or now,
                uns_path=allowlist.get(norm),  # resolve UNS where possible
                equipment_entity_id=tag.get("equipment_entity_id"),
                source_connection_id=source_connection_id,
                metadata=tag.get("metadata") or {},
            )
        )

    result.accepted = len(parsed)
    if not parsed:
        return result

    # Cache protection: a simulated reading must not overwrite a real cache row.
    # (Read current state first so we know which tags are real before deciding
    # what to upsert.)
    existing_sim = store.current_state_simulated(tenant_id, [p.tag_path for p in parsed])
    state_rows: list[TagEventRow] = []
    for p in parsed:
        prev_sim = existing_sim.get(p.tag_path)
        if prev_sim is False and p.simulated:
            # Real data already cached; do NOT clobber it with a simulated value.
            result.cache_skipped += 1
            logger.info(
                "CACHE_SKIP sim-over-real tenant=%s tag=%s", tenant_id, p.tag_path
            )
            continue
        state_rows.append(p)

    # Persist events + cache in ONE transaction. If the cache write fails, the
    # events are NOT committed either — so a 5xx + collector retry can never
    # duplicate rows in the append-only tag_events stream.
    result.events_written, result.state_upserts = store.persist_batch(parsed, state_rows)
    return result


# ──────────────────────────────────────────────────────────────────────────
# NeonTagStore — prod persistence. SQLAlchemy NullPool + RLS tenant binding,
# the same pattern as mira-pipeline/ignition_audit.py. NeonDB's PgBouncer
# handles pooling, so the app uses NullPool (no app-side pool).
# ──────────────────────────────────────────────────────────────────────────


class NeonTagStore:
    """Writes tag_events + live_signal_cache to NeonDB (Hub schema)."""

    def __init__(self, neon_url: str) -> None:
        self.neon_url = neon_url

    def _engine(self):
        from sqlalchemy import NullPool, create_engine

        return create_engine(
            self.neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    def load_allowlist(self, tenant_id: str, source_system: str) -> dict[str, Optional[str]]:
        from sqlalchemy import text

        engine = self._engine()
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            rows = conn.execute(
                text(
                    """
                    SELECT normalized_tag_path, uns_path::text AS uns_path
                      FROM approved_tags
                     WHERE tenant_id = :tid
                       AND source_system = :ss
                       AND enabled = true
                       AND normalized_tag_path IS NOT NULL
                    """
                ),
                {"tid": tenant_id, "ss": source_system},
            ).mappings().all()
        return {r["normalized_tag_path"]: r["uns_path"] for r in rows}

    def current_state_simulated(self, tenant_id: str, tag_paths: list[str]) -> dict[str, bool]:
        if not tag_paths:
            return {}
        from sqlalchemy import text

        engine = self._engine()
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            rows = conn.execute(
                text(
                    """
                    SELECT plc_tag, simulated
                      FROM live_signal_cache
                     WHERE tenant_id = :tid AND plc_tag = ANY(:tags)
                    """
                ),
                {"tid": tenant_id, "tags": tag_paths},
            ).mappings().all()
        return {r["plc_tag"]: r["simulated"] for r in rows}

    def persist_batch(
        self, event_rows: list[TagEventRow], state_rows: list[TagEventRow]
    ) -> tuple[int, int]:
        """Append event_rows to tag_events AND upsert state_rows into
        live_signal_cache in ONE transaction. If the cache upsert fails, the
        events roll back too — so a 5xx + collector retry can never duplicate
        rows in the append-only stream."""
        if not event_rows and not state_rows:
            return (0, 0)
        import json

        from sqlalchemy import text

        tenant_id = (event_rows or state_rows)[0].tenant_id

        event_params = [
            {
                "tenant_id": r.tenant_id,
                "equipment_entity_id": r.equipment_entity_id,
                "uns_path": r.uns_path,
                "tag_path": r.tag_path,
                "value": r.value,
                "value_type": r.value_type,
                "quality": r.quality,
                "source_system": r.source_system,
                "source_connection_id": r.source_connection_id,
                "simulated": r.simulated,
                "event_timestamp": r.event_timestamp,
                "metadata": json.dumps(r.metadata),
            }
            for r in event_rows
        ]

        state_params = []
        for r in state_rows:
            # _value_columns coerces the canonical TEXT value by value_type
            # (float("8.3"), bool("true"), etc.).
            vt, vn, vb = _value_columns(r.value_type, r.value)
            state_params.append(
                {
                    "tenant_id": r.tenant_id,
                    "plc_tag": r.tag_path,
                    "uns_path": r.uns_path,
                    "vt": vt,
                    "vn": vn,
                    "vb": vb,
                    "simulated": r.simulated,
                    "source_system": r.source_system,
                    "quality": r.quality,
                    "freshness": "simulated" if r.simulated else "live",
                    "seen": r.event_timestamp,
                    "props": json.dumps(r.metadata),
                }
            )

        with self._engine().begin() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            if event_params:
                conn.execute(
                    text(
                        """
                        INSERT INTO tag_events
                            (tenant_id, equipment_entity_id, uns_path, tag_path,
                             value, value_type, quality, source_system,
                             source_connection_id, simulated, event_timestamp, metadata)
                        VALUES
                            (:tenant_id, :equipment_entity_id,
                             CAST(:uns_path AS LTREE), :tag_path,
                             :value, :value_type, :quality, :source_system,
                             :source_connection_id, :simulated,
                             CAST(:event_timestamp AS TIMESTAMPTZ),
                             CAST(:metadata AS JSONB))
                        """
                    ),
                    event_params,
                )
            # On a value change, roll the old last_value into prev_value and
            # bump last_changed_at; otherwise keep last_changed_at. last_seen_at
            # always advances (we saw a sample). source='relay_ingest' marks the
            # production write path distinctly from the demo simulator default.
            if state_params:
                conn.execute(
                    text(
                        """
                    INSERT INTO live_signal_cache
                        (tenant_id, plc_tag, uns_path,
                         last_value_text, last_value_numeric, last_value_bool,
                         last_seen_at, last_changed_at,
                         simulated, source, source_system, latest_quality,
                         freshness_status, properties, updated_at)
                    VALUES
                        (:tenant_id, :plc_tag, CAST(:uns_path AS LTREE),
                         :vt, :vn, :vb,
                         CAST(:seen AS TIMESTAMPTZ), CAST(:seen AS TIMESTAMPTZ),
                         :simulated, 'relay_ingest', :source_system, :quality,
                         :freshness, CAST(:props AS JSONB), NOW())
                    ON CONFLICT (tenant_id, plc_tag) DO UPDATE SET
                        uns_path = COALESCE(EXCLUDED.uns_path, live_signal_cache.uns_path),
                        prev_value_text = live_signal_cache.last_value_text,
                        prev_value_numeric = live_signal_cache.last_value_numeric,
                        prev_value_bool = live_signal_cache.last_value_bool,
                        last_value_text = EXCLUDED.last_value_text,
                        last_value_numeric = EXCLUDED.last_value_numeric,
                        last_value_bool = EXCLUDED.last_value_bool,
                        last_seen_at = EXCLUDED.last_seen_at,
                        last_changed_at = CASE
                            WHEN live_signal_cache.last_value_text IS DISTINCT FROM EXCLUDED.last_value_text
                              OR live_signal_cache.last_value_numeric IS DISTINCT FROM EXCLUDED.last_value_numeric
                              OR live_signal_cache.last_value_bool IS DISTINCT FROM EXCLUDED.last_value_bool
                            THEN EXCLUDED.last_seen_at
                            ELSE live_signal_cache.last_changed_at
                        END,
                        simulated = EXCLUDED.simulated,
                        source = EXCLUDED.source,
                        source_system = EXCLUDED.source_system,
                        latest_quality = EXCLUDED.latest_quality,
                        freshness_status = EXCLUDED.freshness_status,
                        properties = EXCLUDED.properties,
                        updated_at = NOW()
                    """
                    ),
                    state_params,
                )
        return (len(event_rows), len(state_rows))
