"""Read-back of FactoryLM live machine state for the serving path (PRD #3048, PR 4).

The FactoryLM machine snapshot enters MIRA through the canonical ingress
(`POST /api/v1/tags/ingest` → `ingest_batch`), which **persists** it to
``tag_events`` + ``live_signal_cache``. It does NOT hand a request-scoped object
to the engine, and the ingest POST and the technician's turn are unrelated
requests, usually seconds to minutes apart. So this module reads *current* state
for the turn's asset back **at answer time** and builds a ``LiveStateOverlay``
from it — it never threads the accepted snapshot through from the ingress.

Consequences honored here (PRD PR-4, amended 2026-08-02):

- **Freshness comes from the stored cache row, never ``now()``.** The source
  observation timestamp comes from the matching append-only
  ``tag_events.event_timestamp`` row; ``live_signal_cache.last_seen_at`` is
  deliberately a server-receipt timestamp and must not be presented as when a
  PLC observation occurred. The freshness band starts from the relay-computed
  ``freshness_status`` in the cache — no ``now()`` at read time.
- **A degraded ``latest_quality`` downgrades the band.** ``freshness_status``
  answers "is the collector reporting?"; ``latest_quality`` is the producer's
  verdict on the value. The writer stamps the former ``'live'`` for any
  non-simulated row, so without re-applying the latter a reading the producer
  marked ``stale`` rendered as ``LIVE``. See ``_freshness_for``.
- **A stale row maps to ``STALE``, never dropped silently.**
- **A ``simulated`` row is never presented as real telemetry** — it maps to
  ``SIMULATED`` regardless of its freshness band (same rule as PR-1's
  ``overlay_from_factorylm_snapshot``).

Read-only: a cache row is observation data; no command is ever executed. Mirrors
the ``ctx_enrichment.fetch_ctx_approved_signals`` engine-enrichment shape
(psycopg2, own tenant-scoped WHERE, ``[]`` / ``None`` on any miss, never raises).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("mira-gsd")

# Bound the read like the other enrichment SELECTs — one asset's live tags, not a
# whole plant. The overlay records the truncation via ``dropped_tag_count``.
_TAG_LIMIT = 64

# These wire values are shared with ``mira-relay/factorylm_snapshot.py``. The
# relay package is deployed as a separate service and is not importable here, so
# the serving reader keeps the transport contract explicit at its DB boundary.
_FACTORYLM_SNAPSHOT_SCHEMA = "factorylm.machine-snapshot.v1"
_FACTORYLM_SOURCE_SYSTEM = "plc_bridge"


def _display_value(text: Any, numeric: Any, boolean: Any) -> Any:
    """The single value a cache row carries, matching historian ``_display_value``."""
    if numeric is not None:
        return numeric
    if boolean is not None:
        return boolean
    return text


#: Per-tag qualities that must never be rendered as a live reading. This is the
#: producer's verdict on the VALUE; ``freshness_status`` is a separate fact about
#: the COLLECTOR. See ``_freshness_for``.
_DEGRADED_QUALITIES = frozenset({"stale", "bad", "uncertain"})


def _freshness_for(status: str | None, *, simulated: bool, quality: str | None = None) -> str:
    """Map (freshness_status, simulated, latest_quality) → a ``Freshness`` value.

    Three inputs, because they are three independent facts, and the most
    pessimistic one has to win:

    * ``simulated`` — provenance. Always wins toward *less* real: a simulated row
      is SIMULATED even when its band says "live", so it can never be presented
      as real telemetry.
    * ``status`` (``freshness_status``) — **collector liveness**: "is the
      collector still reporting?" Stamped at ingest, so no ``now()`` is needed.
    * ``quality`` (``latest_quality``) — the **producer's verdict on the value**:
      "is this reading trustworthy?"

    ``quality`` was previously ignored, and that lost the producer's caveat on
    the deployed path. The ingest writer stamps
    ``freshness_status = 'simulated' if simulated else 'live'`` — correctly, since
    that column means collector liveness and a tag whose *value* is stale is
    still arriving on time. But nothing downstream re-applied the per-tag
    quality, so a reading the producer explicitly marked ``stale`` rendered as
    ``LIVE`` and the summary counted it as live. Both facts are true and both
    belong in the band the technician sees, so the READER combines them rather
    than the writer conflating two different meanings into one column.

    Direction is downgrade-only, matching PR 1's ``overlay_from_factorylm_snapshot``
    (which maps quality→freshness for the direct path): an unknown band is
    UNKNOWN and is never upgraded.
    """
    if simulated:
        return "simulated"
    if (quality or "").strip().lower() in _DEGRADED_QUALITIES:
        # The producer flagged the VALUE. Downgrade however healthy the collector
        # looks — showing a reading the producer already doubted as "live" is the
        # overclaim this exists to prevent.
        return "stale"
    s = (status or "").strip().lower()
    if s in ("live", "fresh", "good"):
        return "live"
    if s == "stale":
        return "stale"
    return "unknown"


def _snapshot_evidence(
    properties: Any,
) -> tuple[tuple[str, str, str, str, tuple[str, ...]], str, list[str]] | None:
    """Validate the persisted snapshot metadata and return its identity + state.

    Every cache row produced from one FactoryLM snapshot carries the same
    ``metadata.factorylm_snapshot`` object. Requiring that identity before
    building an overlay prevents a state claim from one snapshot being combined
    with tags from another (or from generic PLC cache rows).
    """
    if isinstance(properties, (str, bytes, bytearray)):
        try:
            properties = json.loads(properties)
        except (TypeError, json.JSONDecodeError):
            return None
    if not isinstance(properties, dict):
        return None
    snapshot = properties.get("factorylm_snapshot")
    if not isinstance(snapshot, dict):
        return None

    schema = snapshot.get("schema_version")
    snapshot_id = snapshot.get("snapshot_id")
    captured_at = snapshot.get("captured_at")
    machine_state = snapshot.get("machine_state")
    active_conditions = snapshot.get("active_conditions")
    if (
        schema != _FACTORYLM_SNAPSHOT_SCHEMA
        or not isinstance(snapshot_id, str)
        or not snapshot_id.strip()
        or not isinstance(captured_at, str)
        or not captured_at.strip()
        or not isinstance(machine_state, str)
        or not machine_state.strip()
        or not isinstance(active_conditions, list)
        or any(not isinstance(condition, str) for condition in active_conditions)
    ):
        return None

    normalized_conditions = [condition.strip() for condition in active_conditions]
    if any(not condition for condition in normalized_conditions):
        return None
    normalized_state = machine_state.strip().lower()
    identity = (
        schema,
        snapshot_id.strip(),
        captured_at.strip(),
        normalized_state,
        tuple(normalized_conditions),
    )
    return identity, normalized_state, normalized_conditions


def _timestamp_text(value: Any) -> str | None:
    """Keep an already-stored source timestamp verbatim enough for the contract."""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def overlay_from_cache_rows(rows: list[dict[str, Any]]) -> Any | None:
    """Build a ``LiveStateOverlay`` from ``live_signal_cache`` rows. Pure + deterministic.

    ``rows`` are dicts with the keys ``fetch_live_signal_cache`` returns. Returns
    ``None`` when there are no rows (no asset-specific live evidence this turn) or
    the contract package is unavailable. Tags are sorted by ``tag_path`` so the
    overlay — and therefore the manifest hash — is identical for the same rows
    regardless of read order. A row must retain v1 FactoryLM snapshot metadata
    and a matching source ``event_timestamp``; otherwise the reader fails open
    by returning ``None`` rather than relabeling generic cache data as FactoryLM
    evidence. All rows must agree on the same persisted snapshot identity.
    """
    if not rows:
        return None
    try:
        from materialized_evidence.context_contract import (  # noqa: PLC0415
            Freshness,
            LiveStateOverlay,
            LiveTag,
        )
    except Exception as exc:  # noqa: BLE001 — no contract package → no overlay, never fail the turn
        logger.debug("FACTORYLM_LIVE contract unavailable: %s", exc)
        return None

    ordered = sorted(rows, key=lambda r: str(r.get("tag_path") or ""))
    snapshot_parts = [_snapshot_evidence(row.get("properties")) for row in ordered]
    if not snapshot_parts:
        return None
    first = snapshot_parts[0]
    if first is None:
        return None
    first_identity, machine_state, active_conditions = first
    for part in snapshot_parts[1:]:
        if part is None or part[0] != first_identity:
            return None
    if any(not _timestamp_text(row.get("event_timestamp")) for row in ordered):
        return None

    kept = ordered[:_TAG_LIMIT]
    dropped = max(0, len(ordered) - len(kept))

    tags: list[Any] = []
    summary: dict[str, int] = {}
    for r in kept:
        simulated = bool(r.get("simulated"))
        fresh_value = _freshness_for(
            r.get("freshness_status"),
            simulated=simulated,
            quality=r.get("latest_quality"),
        )
        observed_at = _timestamp_text(r.get("event_timestamp"))
        tags.append(
            LiveTag(
                tag_path=str(r.get("tag_path") or ""),
                value=_display_value(
                    r.get("last_value_text"), r.get("last_value_numeric"), r.get("last_value_bool")
                ),
                quality=str(r.get("latest_quality") or "unknown"),
                freshness=Freshness(fresh_value),
                observed_at=observed_at,
            )
        )
        summary[fresh_value] = summary.get(fresh_value, 0) + 1

    return LiveStateOverlay(
        machine_state=machine_state,
        freshness_summary=summary,
        tags=tags,
        dropped_tag_count=dropped,
        active_conditions=active_conditions,
    )


def fetch_live_signal_cache(tenant_id: str, ltree_prefix: str) -> list[dict[str, Any]]:
    """Read current ``live_signal_cache`` rows for one asset subtree. Never raises.

    ``ltree_prefix`` is a dot-notation UNS path (e.g. ``enterprise.site1.line1``);
    only rows whose ``uns_path`` is a descendant are returned, so a turn surfaces
    the live state of the asset the technician is on, never the whole tenant.
    Returns ``[]`` when ``NEON_DATABASE_URL`` is unset, on any DB error, or when
    nothing matches. Mirrors ``ctx_enrichment.fetch_ctx_approved_signals``.
    """
    db_url = os.getenv("NEON_DATABASE_URL", "")
    if not db_url or not tenant_id or not ltree_prefix:
        return []
    try:
        import psycopg2  # noqa: PLC0415 — lazy so the module imports without a DB driver
    except ImportError:
        return []
    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.plc_tag,
                           c.last_value_text,
                           c.last_value_numeric,
                           c.last_value_bool,
                           c.last_seen_at,
                           c.latest_quality,
                           c.freshness_status,
                           c.simulated,
                           c.properties,
                           source_event.event_timestamp
                      FROM live_signal_cache AS c
                 LEFT JOIN LATERAL (
                           SELECT e.event_timestamp
                             FROM tag_events AS e
                            WHERE e.tenant_id = c.tenant_id
                              AND e.tag_path = c.plc_tag
                              AND e.uns_path = c.uns_path
                              AND e.source_system = c.source_system
                              AND (e.metadata -> 'factorylm_snapshot' ->> 'snapshot_id')
                                  = (c.properties -> 'factorylm_snapshot' ->> 'snapshot_id')
                            ORDER BY e.ingested_at DESC, e.event_timestamp DESC
                            LIMIT 1
                 ) AS source_event ON TRUE
                     WHERE c.tenant_id = %s::uuid
                       AND c.uns_path <@ %s::ltree
                       AND c.source_system = %s
                       AND c.properties ? 'factorylm_snapshot'
                       AND c.properties -> 'factorylm_snapshot' ->> 'schema_version' = %s
                     ORDER BY plc_tag
                     LIMIT %s
                    """,
                    (
                        tenant_id,
                        ltree_prefix,
                        _FACTORYLM_SOURCE_SYSTEM,
                        _FACTORYLM_SNAPSHOT_SCHEMA,
                        _TAG_LIMIT,
                    ),
                )
                rows = cur.fetchall()
        finally:
            conn.close()
        return [
            {
                "tag_path": plc_tag,
                "last_value_text": text,
                "last_value_numeric": numeric,
                "last_value_bool": boolean,
                "last_seen_at": last_seen_at,
                "latest_quality": latest_quality,
                "freshness_status": freshness_status,
                "simulated": simulated,
                "properties": properties,
                "event_timestamp": event_timestamp,
            }
            for (
                plc_tag,
                text,
                numeric,
                boolean,
                last_seen_at,
                latest_quality,
                freshness_status,
                simulated,
                properties,
                event_timestamp,
            ) in rows
        ]
    except Exception as exc:  # noqa: BLE001 — enrichment must never block diagnosis
        logger.debug(
            "FACTORYLM_LIVE readback miss tenant=%r prefix=%r: %s", tenant_id, ltree_prefix, exc
        )
        return []
