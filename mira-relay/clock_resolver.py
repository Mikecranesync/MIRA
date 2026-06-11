"""Real-time event-timestamp resolution for live tag ingestion.

Walker-style UNS doctrine: a live datapoint's timestamp should reflect WHEN the
controller observed the value, not when MIRA happened to receive it. When a
PLC/SCADA clock tag is present in the batch we prefer it; otherwise we fall back
through gateway-stamped time to server-receive time, and ALWAYS record which
clock won (``timestamp_source``) so a downstream consumer can trust or distrust
the timestamp.

Precedence (highest → lowest):
  1. A valid, fresh PLC/SCADA/gateway clock tag in the same batch  → plc/scada/gateway_clock
  2. The reading's own source-stamped ``ts``                       → gateway_clock
  3. The relay's server-receive time                              → server_clock
  4. A clock tag was present but unparseable/stale (degraded)      → unknown + degraded flag

This module is intentionally dependency-free (no DB, no httpx) and PURE: every
function takes an explicit ``server_now``, so behaviour is fully deterministic
and unit-testable. It lives in the relay (the live-ingest owner) and is NOT
imported into the maintenance-KG path — live state and durable maintenance
history are separate branches by design (see
docs/specs/realtime-datapoint-and-clock-source.md).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

# ── timestamp_source values (Walker live-state provenance) ───────────────────
PLC_CLOCK = "plc_clock"
SCADA_CLOCK = "scada_clock"
GATEWAY_CLOCK = "gateway_clock"
SERVER_CLOCK = "server_clock"
UNKNOWN = "unknown"

VALID_TIMESTAMP_SOURCES = {PLC_CLOCK, SCADA_CLOCK, GATEWAY_CLOCK, SERVER_CLOCK, UNKNOWN}

# Clock-tag basenames → the timestamp_source they certify. Matched on the LAST
# path segment of a tag path, lowercased. A controller's own clock is the most
# authoritative; a gateway/system clock is least (it has already left the PLC).
CLOCK_TAG_SOURCES: dict[str, str] = {
    "plc_time": PLC_CLOCK,
    "plc_datetime": PLC_CLOCK,
    "controller_time": PLC_CLOCK,
    "scada_time": SCADA_CLOCK,
    "system_time": GATEWAY_CLOCK,
    "gateway_time": GATEWAY_CLOCK,
}

# Rank for choosing among multiple clock tags in one batch (lower = preferred).
_SOURCE_RANK = {PLC_CLOCK: 0, SCADA_CLOCK: 1, GATEWAY_CLOCK: 2}

# A PLC/SCADA clock more than this far from server_now (in either direction) is
# treated as stale/implausible and NOT trusted as authoritative — the reading
# falls back and is marked degraded.
DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300.0

# Epoch values above this are interpreted as milliseconds, not seconds
# (~ year 5138 in seconds; any real second-epoch is far below it).
_EPOCH_MS_THRESHOLD = 1e11

_SEP_SPLIT = re.compile(r"[\\/.:]+")


# ── parsing helpers ──────────────────────────────────────────────────────────


def _basename(tag_path: str) -> str:
    """Last path segment of a tag path, lowercased ('A/B/PLC_Time' -> 'plc_time')."""
    if not tag_path:
        return ""
    parts = _SEP_SPLIT.split(tag_path.strip())
    return parts[-1].strip().lower() if parts and parts[-1] else ""


def clock_source_for_tag(tag_path: str) -> Optional[str]:
    """Return the timestamp_source a tag certifies if it is a known clock tag, else None."""
    return CLOCK_TAG_SOURCES.get(_basename(tag_path))


def _from_epoch(n: float) -> Optional[datetime]:
    """Epoch seconds (or milliseconds) → tz-aware UTC datetime; None if implausible."""
    if n <= 0:
        return None
    if n > _EPOCH_MS_THRESHOLD:
        n = n / 1000.0
    try:
        return datetime.fromtimestamp(n, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def parse_clock_value(value: Any) -> Optional[datetime]:
    """Parse a clock-tag value to a tz-aware UTC datetime, or None if unparseable.

    Accepts: ISO-8601 (with or without offset; a naive value is assumed UTC),
    epoch seconds, and epoch milliseconds — as int/float or numeric string.
    The original local offset, if any, is consumed here; callers that need the
    raw form keep it separately as ``source_timestamp_local``.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _from_epoch(float(value))
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # Numeric string → epoch.
        try:
            return _from_epoch(float(s))
        except ValueError:
            pass
        # ISO-8601 (tolerate a trailing 'Z').
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    return None


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# ── result types ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BatchClock:
    """A trusted PLC/SCADA/gateway clock discovered in a batch."""

    source: str  # PLC_CLOCK | SCADA_CLOCK | GATEWAY_CLOCK
    when: datetime  # tz-aware UTC
    raw: str  # original value, verbatim


@dataclass(frozen=True)
class ResolvedTimestamp:
    """The authoritative event timestamp for one reading + its provenance."""

    timestamp: str  # UTC ISO-8601 — what gets stored as event_timestamp
    timestamp_source: str  # one of VALID_TIMESTAMP_SOURCES
    sample_age_seconds: Optional[float]  # server_now - source_time, if known
    source_timestamp_local: Optional[str]  # original value as received, if any
    degraded: bool = False  # a clock tag was present but rejected (stale/bad)


# ── resolution ───────────────────────────────────────────────────────────────


def find_batch_clock(
    raw_tags: list,
    server_now: datetime,
    max_skew_seconds: float = DEFAULT_MAX_CLOCK_SKEW_SECONDS,
) -> tuple[Optional[BatchClock], bool]:
    """Scan a batch for a usable clock tag.

    Returns ``(BatchClock | None, degraded)``. ``degraded`` is True when a clock
    tag WAS present but every candidate was unparseable or stale — so the caller
    marks readings degraded rather than silently behaving as if no clock existed.
    When multiple valid clock tags appear, the most authoritative wins
    (PLC > SCADA > gateway).
    """
    best: Optional[BatchClock] = None
    saw_clock = False
    for tag in raw_tags:
        if not isinstance(tag, dict):
            continue
        tag_path = tag.get("tag_path")
        if not tag_path:
            continue
        src = clock_source_for_tag(tag_path)
        if src is None:
            continue
        saw_clock = True
        when = parse_clock_value(tag.get("value"))
        if when is None:
            continue  # unparseable → contributes to degraded
        if abs((server_now - when).total_seconds()) > max_skew_seconds:
            continue  # stale / implausibly future → not trusted
        cand = BatchClock(source=src, when=when, raw=str(tag.get("value")))
        if best is None or _SOURCE_RANK[cand.source] < _SOURCE_RANK[best.source]:
            best = cand
    degraded = saw_clock and best is None
    return best, degraded


def resolve_event_timestamp(
    reading_ts: Any,
    batch_clock: Optional[BatchClock],
    server_now: datetime,
    clock_degraded: bool = False,
) -> ResolvedTimestamp:
    """Pick the authoritative timestamp for one reading and record its source.

    See module docstring for the precedence rules. All returned timestamps are
    UTC ISO-8601.
    """
    # 1. A trusted PLC/SCADA/gateway clock tag in the batch wins.
    if batch_clock is not None:
        age = (server_now - batch_clock.when).total_seconds()
        return ResolvedTimestamp(
            timestamp=_iso(batch_clock.when),
            timestamp_source=batch_clock.source,
            sample_age_seconds=age,
            source_timestamp_local=batch_clock.raw,
            degraded=False,
        )

    # 2. The reading's own source-stamped ts (gateway-stamped).
    if reading_ts:
        when = parse_clock_value(reading_ts)
        if when is not None:
            return ResolvedTimestamp(
                timestamp=_iso(when),
                timestamp_source=GATEWAY_CLOCK,
                sample_age_seconds=(server_now - when).total_seconds(),
                source_timestamp_local=str(reading_ts),
                degraded=clock_degraded,
            )

    # 3/4. Fall back to server-receive time. If a clock tag was present but
    # rejected, we cannot trust the event time at all → mark it unknown.
    src = UNKNOWN if clock_degraded else SERVER_CLOCK
    return ResolvedTimestamp(
        timestamp=_iso(server_now),
        timestamp_source=src,
        sample_age_seconds=0.0 if src == SERVER_CLOCK else None,
        source_timestamp_local=str(reading_ts) if reading_ts else None,
        degraded=clock_degraded,
    )
