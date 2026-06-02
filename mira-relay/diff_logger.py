"""mira-relay/diff_logger.py — GitHub-diff-style tag change detector.

Pure-function core (detect_events) is unit-testable without any DB or relay
dependency. Stateful wrapper (DiffLogger) holds the prev-snapshot map and
the fault-window-open map per (tenant_id, tag_id).

Event types match 033_tag_events.sql CHECK constraint exactly:
  rising_edge | falling_edge | value_changed |
  trend_segment | fault_window_open | fault_window_close

Vocabulary follows tools/demo_plc_poller.py:detect_events as the reference
implementation. Key differences vs the poller's version:
  - Multi-tenant: keyed by (tenant_id, tag_id)
  - Approved-tag allowlist drop (Phase 4 / B1)
  - Per-tag thresholds (from approved_tags.threshold)
  - Fault-window tracking with window_start back-reference
  - tag_id is "equipment_id.tag_name" composite key to match approved_tags keying

Per-tag threshold source (§a):
  Thresholds come from approved_tags.threshold (NeonDB migration 035), loaded
  once per batch by diff_logger.process_batch via neon.load_approved_tags.
  The `approved` dict is keyed tag_id → {data_type, threshold, uns_path}.
  If approved_tags is empty (table not yet populated / DB unreachable), every
  numeric tag falls back to DEFAULT_NUMERIC_THRESHOLD (0.0 = any change).
  Float-only threshold; bools and fault tags ignore it.

Fault-window state map (§b):
  DiffLogger._fault_windows is an in-memory dict keyed (tenant_id, tag_id)
  → datetime. It stores the window_start timestamp for any open fault window.
  On fault_window_close the stored start is attached to the close event, then
  the key is removed.
  Limitations:
  - Lost on process restart (uvicorn reload, container restart).
  - Assumes single-worker deployment (concurrent same-tenant POSTs could race).
  - If a close event arrives with no stored start (relay restarted mid-fault,
    or first observation was already faulted), window_start is None — the row
    is still inserted with window_start=NULL rather than crashing.
  These limitations are noted here for the staging integration test (§c).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("mira-relay.diff_logger")

# Default threshold for numeric value_changed detection.
# 0.0 means any change (no dead-band). Override per-tag via approved_tags.threshold.
DEFAULT_NUMERIC_THRESHOLD: float = 0.0

# Tag names that carry fault codes (mirrors relay_server.FAULT_TAG_NAMES plus
# the poller's "error_code" label).
FAULT_TAG_NAMES: frozenset[str] = frozenset(
    {"faultCode", "fault_code", "errorCode", "alarmCode", "error_code"}
)

# ---------------------------------------------------------------------------
# Pure helper — allowlist check
# ---------------------------------------------------------------------------


def is_allowlisted(tag_id: str, approved: dict[str, dict[str, Any]]) -> bool:
    """Return True if tag_id is in the approved set, or if the approved set is empty.

    When approved is empty (table not populated / Neon unreachable), we treat all
    tags as allowlisted (fail-open) so the bench bridge is unaffected.
    """
    if not approved:
        return True
    return tag_id in approved


# ---------------------------------------------------------------------------
# Pure core — event detection
# ---------------------------------------------------------------------------


def detect_events(
    prev_snapshot: dict[str, Any] | None,
    curr_snapshot: dict[str, Any],
    approved: dict[str, dict[str, Any]],
    thresholds: dict[str, float],
    fault_windows: dict[tuple[str, str], datetime],
    tenant_id: str,
    ts: datetime,
) -> list[dict[str, Any]]:
    """Compare prev/curr snapshots and emit meaningful-change events.

    Args:
        prev_snapshot: tag_id → value (float | bool-as-float | str | None)
                       from the previous POST for this tenant. None on first call.
        curr_snapshot:  tag_id → value for this POST.
        approved:       tag_id → {data_type, threshold, uns_path}. Empty = pass-all.
        thresholds:     tag_id → threshold override (takes precedence over approved).
        fault_windows:  Mutable dict (tenant_id, tag_id) → window_start datetime.
                        Updated in-place: opened on fault_window_open, removed on close.
        tenant_id:      Tenant UUID string (for fault_windows key + row fields).
        ts:             Timestamp for this batch (datetime with tz).

    Returns:
        List of event dicts ready for neon.insert_tag_events (minus event_id and
        relay_batch_id, which are added by process_batch).
    """
    if prev_snapshot is None:
        return []

    events: list[dict[str, Any]] = []

    for tag_id, new_val in curr_snapshot.items():
        if not is_allowlisted(tag_id, approved):
            continue

        old_val = prev_snapshot.get(tag_id)
        if old_val is None:
            # First time we see this tag — no diff to emit.
            continue

        meta = approved.get(tag_id, {})
        uns_path = meta.get("uns_path") or _uns_path_from_tag_id(tag_id)
        data_type = meta.get("data_type") or _infer_data_type(tag_id, new_val)

        # ---- Fault code tags ------------------------------------------------
        if data_type == "fault" or _is_fault_tag(tag_id):
            ev = _detect_fault_event(
                tag_id, old_val, new_val, uns_path, tenant_id, ts, fault_windows,
                meta
            )
            if ev is not None:
                events.append(ev)
            continue

        # ---- Boolean tags ---------------------------------------------------
        if data_type == "bool":
            if old_val == new_val:
                continue
            event_type = "rising_edge" if _is_truthy(new_val) else "falling_edge"
            events.append({
                "ts": ts,
                "uns_path": uns_path,
                "tag_id": tag_id,
                "event_type": event_type,
                "prev_value": _jsonb(old_val),
                "new_value": _jsonb(new_val),
                "delta": None,
                "threshold": None,
                "window_start": None,
                "window_end": None,
                "fault_code": None,
                "severity": None,
                "raw_quality": None,
            })
            continue

        # ---- Numeric tags (int / float / enum treated as numeric) -----------
        try:
            old_f = float(old_val)
            new_f = float(new_val)
        except (TypeError, ValueError):
            # Non-numeric, non-bool — skip (no sensible diff).
            continue

        delta = new_f - old_f
        threshold = thresholds.get(tag_id, meta.get("threshold") or DEFAULT_NUMERIC_THRESHOLD)

        if abs(delta) <= threshold:
            continue

        events.append({
            "ts": ts,
            "uns_path": uns_path,
            "tag_id": tag_id,
            "event_type": "value_changed",
            "prev_value": _jsonb(old_f),
            "new_value": _jsonb(new_f),
            "delta": delta,
            "threshold": threshold,
            "window_start": None,
            "window_end": None,
            "fault_code": None,
            "severity": None,
            "raw_quality": None,
        })

    return events


# ---------------------------------------------------------------------------
# Fault-window helpers
# ---------------------------------------------------------------------------


def _detect_fault_event(
    tag_id: str,
    old_val: Any,
    new_val: Any,
    uns_path: str,
    tenant_id: str,
    ts: datetime,
    fault_windows: dict[tuple[str, str], datetime],
    meta: dict[str, Any],
) -> dict[str, Any] | None:
    """Detect fault_window_open / fault_window_close transitions.

    old 0 → new nonzero : fault_window_open  (store window_start)
    old nonzero → new 0 : fault_window_close (attach stored window_start)
    no change             : None
    """
    key = (tenant_id, tag_id)
    was_faulted = _is_nonzero(old_val)
    is_faulted = _is_nonzero(new_val)

    if was_faulted == is_faulted:
        return None  # No change — not an event.

    fault_code = str(new_val) if is_faulted else str(old_val)

    if is_faulted:
        # Opening a fault window.
        fault_windows[key] = ts
        return {
            "ts": ts,
            "uns_path": uns_path,
            "tag_id": tag_id,
            "event_type": "fault_window_open",
            "prev_value": _jsonb(old_val),
            "new_value": _jsonb(new_val),
            "delta": None,
            "threshold": None,
            "window_start": ts,
            "window_end": None,
            "fault_code": fault_code,
            "severity": meta.get("severity", "warning"),
            "raw_quality": None,
        }
    else:
        # Closing a fault window.
        window_start = fault_windows.pop(key, None)
        if window_start is None:
            logger.debug(
                "fault_window_close for %s but no open window tracked "
                "(relay restarted mid-fault or first observation was already faulted); "
                "window_start will be NULL",
                tag_id,
            )
        return {
            "ts": ts,
            "uns_path": uns_path,
            "tag_id": tag_id,
            "event_type": "fault_window_close",
            "prev_value": _jsonb(old_val),
            "new_value": _jsonb(new_val),
            "delta": None,
            "threshold": None,
            "window_start": window_start,
            "window_end": ts,
            "fault_code": fault_code,
            "severity": meta.get("severity", "warning"),
            "raw_quality": None,
        }


# ---------------------------------------------------------------------------
# Stateful wrapper
# ---------------------------------------------------------------------------


class DiffLogger:
    """Maintains per-tenant prev-snapshot and fault-window maps.

    Usage:
        logger = DiffLogger()
        rows = logger.process_batch(tenant_id, approved, tags, relay_batch_id, ts)
        neon.insert_tag_events(rows)

    Thread-safety: NOT thread-safe. Relay is single-worker (uvicorn default).
    Concurrent same-tenant POSTs could race the snapshot/fault_windows maps.
    For multi-worker deployment, promote these maps to Redis or Postgres
    advisory locks.
    """

    def __init__(self) -> None:
        # tenant_id → {tag_id: value}
        self._prev_snapshots: dict[str, dict[str, Any]] = {}
        # (tenant_id, tag_id) → window_start datetime
        self._fault_windows: dict[tuple[str, str], datetime] = {}

    def process_batch(
        self,
        tenant_id: str,
        approved: dict[str, dict[str, Any]],
        tags: dict[str, dict[str, Any]],
        relay_batch_id: str | uuid.UUID,
        ts: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Process a batch of tags for one tenant.

        Args:
            tenant_id:       Tenant UUID string.
            approved:        Output of neon.load_approved_tags(tenant_id).
                             Empty dict = allowlist disabled (bench mode).
            tags:            {tag_id: {v, q, t}} dict from the relay payload,
                             already flattened to the composite key
                             "equipment_id.tag_name" by the caller
                             (relay_server.ingest).
            relay_batch_id:  UUID of this POST (for provenance).
            ts:              Batch timestamp. Defaults to utcnow().

        Returns:
            List of rows ready for neon.insert_tag_events.
        """
        if ts is None:
            ts = datetime.now(timezone.utc)

        # Extract scalar values from the tag dicts.
        curr_snapshot: dict[str, Any] = {}
        qualities: dict[str, str | None] = {}
        for tag_id, tag_data in tags.items():
            if isinstance(tag_data, dict):
                curr_snapshot[tag_id] = tag_data.get("v")
                qualities[tag_id] = tag_data.get("q")
            else:
                curr_snapshot[tag_id] = tag_data
                qualities[tag_id] = None

        prev_snapshot = self._prev_snapshots.get(tenant_id)

        # Detect events (pure function — no side effects on self).
        events = detect_events(
            prev_snapshot=prev_snapshot,
            curr_snapshot=curr_snapshot,
            approved=approved,
            thresholds={},        # Use approved_tags.threshold via meta lookup inside detect_events.
            fault_windows=self._fault_windows,  # Mutated in-place by detect_events.
            tenant_id=tenant_id,
            ts=ts,
        )

        # Update snapshot only after events are detected.
        self._prev_snapshots[tenant_id] = curr_snapshot

        # Attach per-event identifiers and provenance.
        batch_id_str = str(relay_batch_id)
        rows: list[dict[str, Any]] = []
        for ev in events:
            tag_id = ev["tag_id"]
            qual = qualities.get(tag_id)
            row = {
                "event_id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "relay_batch_id": batch_id_str,
                "raw_quality": qual.lower() if qual else None,
                **ev,
            }
            rows.append(row)

        if rows:
            logger.info(
                "Batch %s: %d events for tenant %s",
                batch_id_str[:8], len(rows), tenant_id,
            )

        return rows


# ---------------------------------------------------------------------------
# Private utilities
# ---------------------------------------------------------------------------


def _is_truthy(val: Any) -> bool:
    """Coerce any value to bool (1.0/True/"1"/"true" = True)."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        return val.lower() in {"1", "true", "yes"}
    return bool(val)


def _is_nonzero(val: Any) -> bool:
    """Return True if a fault-code value is active (nonzero / non-empty / non-null)."""
    if val is None:
        return False
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        return val not in {"", "0", "0.0", "none", "null"}
    return bool(val)


def _is_fault_tag(tag_id: str) -> bool:
    """Return True if tag_id ends with a known fault-tag name fragment."""
    # Composite keys are "EQUIP_ID.tag_name" — check the suffix.
    suffix = tag_id.split(".")[-1] if "." in tag_id else tag_id
    return suffix in FAULT_TAG_NAMES


def _infer_data_type(tag_id: str, value: Any) -> str:
    """Best-effort type inference when approved_tags metadata is absent.

    IMPORTANT: The poller casts coil bits to float (1.0/0.0), so value alone
    cannot distinguish bool from numeric. This inference falls back to "float"
    for any value that looks numeric. For correct bool classification, populate
    approved_tags.data_type="bool" for coil tags.
    """
    if _is_fault_tag(tag_id):
        return "fault"
    if isinstance(value, bool):
        return "bool"
    return "float"


def _uns_path_from_tag_id(tag_id: str) -> str:
    """Derive a best-effort UNS path from tag_id when approved_tags has no record.

    tag_id = "CONV-001.motor_running" → "CONV-001.motor_running"
    Slashes are normalised to dots; hyphens are kept (ltree allows alphanumeric + _).
    This is a fallback only — real UNS paths should come from approved_tags.uns_path.
    """
    return tag_id.replace("/", ".").replace("-", "_")


def _jsonb(val: Any) -> Any:
    """Wrap a value for JSONB storage (Postgres driver handles serialisation)."""
    if isinstance(val, float):
        # Preserve numeric precision; avoid storing 1.0 as the string "1.0".
        return val
    return val
