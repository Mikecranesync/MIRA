"""Append-only latency recorder for document ingest.

Records one JSONL row per delivered document or wrapped command. The module is
deliberately small and dependency-free so it can be imported from cron jobs,
folder watchers, one-off parser experiments, or production pipelines.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

DEFAULT_LOG_PATH = "mira-crawler/data/ingest_latency.jsonl"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="milliseconds") if dt else None


def _default_log_path() -> Path:
    return Path(os.getenv("MIRA_INGEST_LATENCY_LOG", DEFAULT_LOG_PATH))


def _coerce_time(value: datetime | float | int | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (float, int)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    raise TypeError(f"Unsupported timestamp type: {type(value).__name__}")


class IngestLatencyRecorder:
    """Collect stage timings and append a single JSONL record."""

    def __init__(
        self,
        *,
        source_id: str,
        parser: str,
        source_url: str = "",
        source_file: str = "",
        delivered_at: datetime | float | int | str | None = None,
        log_path: str | Path | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.event_id = str(uuid.uuid4())
        self.source_id = source_id
        self.parser = parser
        self.source_url = source_url
        self.source_file = source_file
        self.delivered_at = _coerce_time(delivered_at) or _utc_now()
        self.started_at = _utc_now()
        self._started_mono = time.perf_counter()
        self.log_path = Path(log_path) if log_path is not None else _default_log_path()
        self.metadata: dict[str, Any] = dict(metadata or {})
        self.stages: dict[str, dict[str, Any]] = {}
        self.metrics: dict[str, Any] = {}

    @contextmanager
    def stage(self, name: str, **details: Any) -> Iterator[None]:
        """Measure one named stage.

        Stage names should be stable: `read`, `dedup`, `parse`, `chunk`, `embed`,
        `store`, `kg`, `quality_gate`, or `command`.
        """
        start = _utc_now()
        start_mono = time.perf_counter()
        status = "ok"
        error = ""
        try:
            yield
        except Exception as exc:
            status = "error"
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            end = _utc_now()
            record = {
                "started_at": _iso(start),
                "completed_at": _iso(end),
                "duration_ms": round((time.perf_counter() - start_mono) * 1000, 3),
                "status": status,
            }
            if details:
                record["details"] = details
            if error:
                record["error"] = error
            self.stages[name] = record

    def set_metric(self, key: str, value: Any) -> None:
        self.metrics[key] = value

    def update_metrics(self, **metrics: Any) -> None:
        self.metrics.update(metrics)

    def finish(self, *, status: str = "ok", error: str = "") -> dict[str, Any]:
        completed_at = _utc_now()
        total_ms = round((time.perf_counter() - self._started_mono) * 1000, 3)
        delivery_to_start_ms = round(
            (self.started_at - self.delivered_at).total_seconds() * 1000,
            3,
        )
        delivery_to_done_ms = round(
            (completed_at - self.delivered_at).total_seconds() * 1000,
            3,
        )
        record = {
            "schema_version": 1,
            "event_id": self.event_id,
            "source_id": self.source_id,
            "source_url": self.source_url,
            "source_file": self.source_file,
            "parser": self.parser,
            "status": status,
            "delivered_at": _iso(self.delivered_at),
            "started_at": _iso(self.started_at),
            "completed_at": _iso(completed_at),
            "delivery_to_start_ms": delivery_to_start_ms,
            "delivery_to_done_ms": delivery_to_done_ms,
            "total_ms": total_ms,
            "stages": self.stages,
            "metrics": self.metrics,
            "metadata": self.metadata,
        }
        if error:
            record["error"] = error
        append_record(record, self.log_path)
        return record


def append_record(record: dict[str, Any], log_path: str | Path | None = None) -> None:
    """Append a JSON record to the configured metrics log."""
    path = Path(log_path) if log_path is not None else _default_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")

