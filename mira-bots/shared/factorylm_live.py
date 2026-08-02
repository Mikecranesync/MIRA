"""Read-back of FactoryLM live machine state for the serving path (PRD #3048, PR 4).

The FactoryLM machine snapshot enters MIRA through the canonical ingress
(`POST /api/v1/tags/ingest` → `ingest_batch`), which **persists** it to
``tag_events`` + ``live_signal_cache``. It does NOT hand a request-scoped object
to the engine, and the ingest POST and the technician's turn are unrelated
requests, usually seconds to minutes apart. So this module reads *current* state
for the turn's asset back **at answer time** and builds a ``LiveStateOverlay``
from it — it never threads the accepted snapshot through from the ingress.

Consequences honored here (PRD PR-4, amended 2026-08-02):

- **Freshness comes from the stored row, never ``now()``.** ``observed_at`` is the
  absolute ``last_seen_at`` timestamp verbatim, and the freshness band is the
  ``freshness_status`` the relay computed at ingest — so two reads of the same
  cache rows produce a byte-identical overlay (and a stable manifest hash).
- **A stale row maps to ``STALE``, never dropped silently.**
- **A ``simulated`` row is never presented as real telemetry** — it maps to
  ``SIMULATED`` regardless of its freshness band (same rule as PR-1's
  ``overlay_from_factorylm_snapshot``).

Read-only: a cache row is observation data; no command is ever executed. Mirrors
the ``ctx_enrichment.fetch_ctx_approved_signals`` engine-enrichment shape
(psycopg2, own tenant-scoped WHERE, ``[]`` / ``None`` on any miss, never raises).
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("mira-gsd")

# Bound the read like the other enrichment SELECTs — one asset's live tags, not a
# whole plant. The overlay records the truncation via ``dropped_tag_count``.
_TAG_LIMIT = 64


def _display_value(text: Any, numeric: Any, boolean: Any) -> Any:
    """The single value a cache row carries, matching historian ``_display_value``."""
    if numeric is not None:
        return numeric
    if boolean is not None:
        return boolean
    return text


def _freshness_for(status: str | None, *, simulated: bool) -> str:
    """Map (stored freshness_status, simulated) → a ``Freshness`` value string.

    ``simulated`` always wins toward *less* real: a simulated row is SIMULATED
    even when its band says "live", so it can never be presented as real
    telemetry. Otherwise the relay's stored band is honored; an unknown band is
    UNKNOWN, never upgraded. No ``now()`` — the band was computed at ingest.
    """
    if simulated:
        return "simulated"
    s = (status or "").strip().lower()
    if s in ("live", "fresh", "good"):
        return "live"
    if s == "stale":
        return "stale"
    return "unknown"


def overlay_from_cache_rows(rows: list[dict[str, Any]]) -> Any | None:
    """Build a ``LiveStateOverlay`` from ``live_signal_cache`` rows. Pure + deterministic.

    ``rows`` are dicts with the keys ``fetch_live_signal_cache`` returns. Returns
    ``None`` when there are no rows (no asset-specific live evidence this turn) or
    the contract package is unavailable. Tags are sorted by ``tag_path`` so the
    overlay — and therefore the manifest hash — is identical for the same rows
    regardless of read order. ``machine_state`` stays ``"unknown"`` and
    ``active_conditions`` empty: the per-tag cache does not carry a snapshot-level
    machine state, and inventing one would be ungrounded.
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
    kept = ordered[:_TAG_LIMIT]
    dropped = max(0, len(ordered) - len(kept))

    tags: list[Any] = []
    summary: dict[str, int] = {}
    for r in kept:
        simulated = bool(r.get("simulated"))
        fresh_value = _freshness_for(r.get("freshness_status"), simulated=simulated)
        observed = r.get("last_seen_at")
        observed_at = (
            observed.isoformat()
            if hasattr(observed, "isoformat")
            else (str(observed) if observed is not None else None)
        )
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
        machine_state="unknown",
        freshness_summary=summary,
        tags=tags,
        dropped_tag_count=dropped,
        active_conditions=[],
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
                    SELECT plc_tag,
                           last_value_text,
                           last_value_numeric,
                           last_value_bool,
                           last_seen_at,
                           latest_quality,
                           freshness_status,
                           simulated
                      FROM live_signal_cache
                     WHERE tenant_id = %s::uuid
                       AND uns_path <@ %s::ltree
                     ORDER BY plc_tag
                     LIMIT %s
                    """,
                    (tenant_id, ltree_prefix, _TAG_LIMIT),
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
            ) in rows
        ]
    except Exception as exc:  # noqa: BLE001 — enrichment must never block diagnosis
        logger.debug(
            "FACTORYLM_LIVE readback miss tenant=%r prefix=%r: %s", tenant_id, ltree_prefix, exc
        )
        return []
