"""Historian Query API — adapter interface + DTOs + reference in-memory adapter.

Issue Mikecranesync/MIRA#2339. This module is the single read boundary for the
Historian query surface (live values, tag history, trends, fault-window
evidence). It is the swappable seam: PostgresHistorianAdapter
(historian_postgres.py) is prod over the EXISTING Hub tables; a Timescale/Influx
adapter (#2344) can drop in behind the same interface; InMemoryHistorianAdapter
(below) is a pure reference impl used by the route + adapter tests.

Mirrors the relay's logic/store split (tag_ingest.py, tag_diff_logger.py): the
routes are thin (parse → adapter call → JSON), all DB access lives behind the
adapter, and the pure logic is exercised in-memory with no DB.

DTOs are dataclasses; .to_dict() renders JSON-serializable shapes with ISO8601
timestamps.

Source tables (read-only):
  - live_signal_cache (Hub mig 020 + 036)  → list_tags / live values
  - tag_events        (Hub mig 033)        → get_history / get_trends
  - tag_event_diffs   (Hub mig 037)        → get_evidence (by fault_window_id)
  - decision_traces   (Hub mig 032)        → get_evidence (related traces)

Runs (list_runs / GET /api/runs/{id}) are DEFERRED to #2341 — the seam exists
and raises NotImplementedError so callers can wire the 501 today.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

# A value is treated as numeric only if it matches this — the SAME guard the
# Postgres adapter applies (value ~ '^-?[0-9]+(\.[0-9]+)?$'). Deliberately
# rejects scientific notation / inf / nan so the in-memory and SQL paths agree.
_NUMERIC_RE = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")


def _to_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def _is_numeric(value: Optional[str]) -> bool:
    return bool(value is not None and _NUMERIC_RE.match(value.strip()))


# ── DTOs ────────────────────────────────────────────────────────────────────


@dataclass
class TagMeta:
    """Lightweight descriptor of a known tag (no value)."""

    tag_path: str
    uns_path: Optional[str] = None
    source_system: Optional[str] = None
    value_type: Optional[str] = None
    simulated: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Sample:
    """Latest live value for a tag (live_signal_cache row)."""

    tag_path: str
    value: Optional[str]
    value_type: Optional[str] = None
    quality: Optional[str] = None
    uns_path: Optional[str] = None
    source_system: Optional[str] = None
    simulated: bool = False
    freshness_status: Optional[str] = None
    numeric: Optional[float] = None
    bool_value: Optional[bool] = None
    last_seen_at: Optional[datetime] = None
    last_changed_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tag_path": self.tag_path,
            "value": self.value,
            "value_type": self.value_type,
            "quality": self.quality,
            "uns_path": self.uns_path,
            "source_system": self.source_system,
            "simulated": self.simulated,
            "freshness_status": self.freshness_status,
            "numeric": self.numeric,
            "bool_value": self.bool_value,
            "last_seen_at": _to_iso(self.last_seen_at),
            "last_changed_at": _to_iso(self.last_changed_at),
        }


@dataclass
class HistoryPoint:
    """One point of tag history (raw tag_events row, or a bucket aggregate)."""

    tag_path: str
    timestamp: datetime
    value: Optional[str]
    quality: Optional[str] = None
    numeric: Optional[float] = None
    bucketed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "tag_path": self.tag_path,
            "timestamp": _to_iso(self.timestamp),
            "value": self.value,
            "quality": self.quality,
            "numeric": self.numeric,
            "bucketed": self.bucketed,
        }


@dataclass
class TrendBucket:
    """One date_trunc bucket of aggregated history for a tag."""

    tag_path: str
    bucket_start: datetime
    count: int
    min: Optional[float]
    max: Optional[float]
    avg: Optional[float]
    latest: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "tag_path": self.tag_path,
            "bucket_start": _to_iso(self.bucket_start),
            "count": self.count,
            "min": self.min,
            "max": self.max,
            "avg": self.avg,
            "latest": self.latest,
        }


@dataclass
class EvidenceWindow:
    """Everything around a fault window: the meaningful diffs + related traces."""

    fault_window_id: str
    diffs: list[dict[str, Any]] = field(default_factory=list)
    traces: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fault_window_id": self.fault_window_id,
            "diffs": self.diffs,
            "traces": self.traces,
        }


@dataclass
class Run:
    """Production run (DEFERRED to #2341 — DTO placeholder only)."""

    run_id: str
    status: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "started_at": _to_iso(self.started_at),
            "ended_at": _to_iso(self.ended_at),
        }


class TimeAggregation(str, Enum):
    """Allowed bucketing intervals. Values map 1:1 to Postgres date_trunc units."""

    SECOND = "second"
    MINUTE = "minute"
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"

    @classmethod
    def parse(cls, value: Optional[str]) -> Optional["TimeAggregation"]:
        """None/empty → None (raw, no bucketing). Unknown → ValueError."""
        if not value:
            return None
        try:
            return cls(value.strip().lower())
        except ValueError as exc:
            raise ValueError(f"invalid interval: {value}") from exc

    def truncate(self, dt: datetime) -> datetime:
        """Emulate Postgres date_trunc(unit, ts) for the in-memory adapter."""
        if self is TimeAggregation.SECOND:
            return dt.replace(microsecond=0)
        if self is TimeAggregation.MINUTE:
            return dt.replace(second=0, microsecond=0)
        if self is TimeAggregation.HOUR:
            return dt.replace(minute=0, second=0, microsecond=0)
        if self is TimeAggregation.DAY:
            return dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if self is TimeAggregation.WEEK:
            base = dt.replace(hour=0, minute=0, second=0, microsecond=0)
            # ISO week starts Monday, matching Postgres date_trunc('week').
            from datetime import timedelta

            return base - timedelta(days=base.weekday())
        if self is TimeAggregation.MONTH:
            return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        raise ValueError(self)  # pragma: no cover


# ── Adapter interface ────────────────────────────────────────────────────────


class HistorianAdapter(ABC):
    """The swappable Historian read boundary. All methods are tenant-scoped."""

    @abstractmethod
    def list_tags(self, tenant_id: str) -> list[Sample]:
        """Latest live value per tag (live_signal_cache)."""

    @abstractmethod
    def get_history(
        self,
        tenant_id: str,
        tag_path: str,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[HistoryPoint]:
        """Time-ranged tag history (tag_events). Bucketed if interval given."""

    @abstractmethod
    def get_trends(
        self,
        tenant_id: str,
        tag_paths: list[str],
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[TrendBucket]:
        """Aggregated buckets per date_trunc(interval) across tag_paths."""

    @abstractmethod
    def get_evidence(self, tenant_id: str, fault_window_id: str) -> EvidenceWindow:
        """Diffs (tag_event_diffs) for a fault window + related decision_traces."""

    def list_runs(self, tenant_id: str, run_id: Optional[str] = None) -> Run:
        """DEFERRED — runs tables land in #2341."""
        raise NotImplementedError("runs tables land in #2341")


# ── Reference in-memory adapter (tests + WS poll fakery) ──────────────────────


@dataclass
class _Event:
    tag_path: str
    value: Optional[str]
    value_type: str
    quality: str
    timestamp: datetime


class InMemoryHistorianAdapter(HistorianAdapter):
    """Pure reference adapter. Holds everything in memory; no DB. The Postgres
    adapter mirrors this exact aggregation logic in SQL."""

    def __init__(self) -> None:
        self._live: dict[str, dict[str, Sample]] = {}          # tenant → tag → Sample
        self._events: dict[str, list[_Event]] = {}             # tenant → [events]
        self._diffs: dict[str, list[dict[str, Any]]] = {}      # tenant → [diff dicts]
        self._traces: dict[str, list[dict[str, Any]]] = {}     # tenant → [trace dicts]

    # -- seeding helpers (test/fixture use) --

    def add_live(self, tenant_id: str, sample: Sample) -> None:
        self._live.setdefault(tenant_id, {})[sample.tag_path] = sample

    def add_event(
        self,
        tenant_id: str,
        tag_path: str,
        value: Optional[str],
        value_type: str,
        timestamp: datetime,
        quality: str = "good",
    ) -> None:
        self._events.setdefault(tenant_id, []).append(
            _Event(tag_path=tag_path, value=value, value_type=value_type,
                   quality=quality, timestamp=timestamp)
        )

    def add_diff(self, tenant_id: str, fault_window_id: str, **fields: Any) -> None:
        row = {"fault_window_id": fault_window_id, **fields}
        ts = row.get("event_timestamp")
        row["event_timestamp"] = _to_iso(ts) if isinstance(ts, datetime) else ts
        row["_ts"] = ts  # keep raw datetime for window math
        self._diffs.setdefault(tenant_id, []).append(row)

    def add_trace(self, tenant_id: str, ts: datetime, **fields: Any) -> None:
        row = {"ts": _to_iso(ts), **fields}
        row["_ts"] = ts
        self._traces.setdefault(tenant_id, []).append(row)

    # -- adapter interface --

    def list_tags(self, tenant_id: str) -> list[Sample]:
        return list(self._live.get(tenant_id, {}).values())

    def _tag_events(
        self,
        tenant_id: str,
        tag_path: str,
        start: Optional[datetime],
        end: Optional[datetime],
    ) -> list[_Event]:
        out = [
            e
            for e in self._events.get(tenant_id, [])
            if e.tag_path == tag_path
            and (start is None or e.timestamp >= start)
            and (end is None or e.timestamp <= end)
        ]
        out.sort(key=lambda e: e.timestamp)
        return out

    def get_history(
        self,
        tenant_id: str,
        tag_path: str,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[HistoryPoint]:
        agg = TimeAggregation.parse(interval)
        events = self._tag_events(tenant_id, tag_path, start, end)

        if agg is None:
            return [
                HistoryPoint(tag_path=tag_path, timestamp=e.timestamp, value=e.value,
                             quality=e.quality, numeric=float(e.value) if _is_numeric(e.value) else None)
                for e in events
            ]

        # Bucketed: one point per date_trunc bucket; value = latest in bucket,
        # numeric = avg of numeric values in the bucket.
        buckets: dict[datetime, list[_Event]] = {}
        for e in events:
            buckets.setdefault(agg.truncate(e.timestamp), []).append(e)

        points: list[HistoryPoint] = []
        for bstart in sorted(buckets):
            rows = buckets[bstart]
            latest = max(rows, key=lambda e: e.timestamp)
            nums = [float(e.value) for e in rows if _is_numeric(e.value)]
            points.append(
                HistoryPoint(
                    tag_path=tag_path,
                    timestamp=bstart,
                    value=latest.value,
                    quality=latest.quality,
                    numeric=(sum(nums) / len(nums)) if nums else None,
                    bucketed=True,
                )
            )
        return points

    def get_trends(
        self,
        tenant_id: str,
        tag_paths: list[str],
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[TrendBucket]:
        agg = TimeAggregation.parse(interval) or TimeAggregation.MINUTE
        out: list[TrendBucket] = []
        for tag_path in tag_paths:
            events = self._tag_events(tenant_id, tag_path, start, end)
            buckets: dict[datetime, list[_Event]] = {}
            for e in events:
                buckets.setdefault(agg.truncate(e.timestamp), []).append(e)
            for bstart in sorted(buckets):
                rows = buckets[bstart]
                nums = [float(e.value) for e in rows if _is_numeric(e.value)]
                latest = max(rows, key=lambda e: e.timestamp)
                out.append(
                    TrendBucket(
                        tag_path=tag_path,
                        bucket_start=bstart,
                        count=len(rows),
                        min=min(nums) if nums else None,
                        max=max(nums) if nums else None,
                        avg=(sum(nums) / len(nums)) if nums else None,
                        latest=latest.value,
                    )
                )
        return out

    def get_evidence(self, tenant_id: str, fault_window_id: str) -> EvidenceWindow:
        diffs = [
            d
            for d in self._diffs.get(tenant_id, [])
            if d.get("fault_window_id") == fault_window_id
        ]
        diffs.sort(key=lambda d: d.get("_ts") or datetime.min.replace(tzinfo=timezone.utc))

        traces: list[dict[str, Any]] = []
        if diffs:
            ts_values = [d["_ts"] for d in diffs if d.get("_ts") is not None]
            if ts_values:
                lo, hi = min(ts_values), max(ts_values)
                traces = [
                    t
                    for t in self._traces.get(tenant_id, [])
                    if t.get("_ts") is not None and lo <= t["_ts"] <= hi
                ]

        return EvidenceWindow(
            fault_window_id=fault_window_id,
            diffs=[_strip_private(d) for d in diffs],
            traces=[_strip_private(t) for t in traces],
        )


def _strip_private(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if not k.startswith("_")}
