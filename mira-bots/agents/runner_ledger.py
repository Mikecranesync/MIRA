"""Append-only evidence ledger for scheduled dogfood/ops runners."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_LEDGER_PATH = Path(os.environ.get("MIRA_RUNNER_LEDGER_PATH", "/data/runner-ledger.jsonl"))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc_timestamp(value: Any) -> datetime | None:
    """Parse ISO or SQLite CURRENT_TIMESTAMP strings as UTC-aware datetimes."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def append_event(
    *,
    runner: str,
    status: str,
    checked: list[str],
    evidence_path: str = "",
    counts: dict[str, int] | None = None,
    personas: list[str] | None = None,
    unable_sources: list[str] | None = None,
    next_action: str = "",
    path: str | Path | None = None,
    run_id: str | None = None,
    started_at: str | None = None,
    finished_at: str | None = None,
) -> Path:
    target = Path(path) if path is not None else Path(
        os.environ.get("MIRA_RUNNER_LEDGER_PATH", str(DEFAULT_LEDGER_PATH))
    )
    payload: dict[str, Any] = {
        "runner": runner,
        "status": status,
        "checked": checked,
        "evidence_path": evidence_path,
        "counts": counts or {},
        "personas": personas or [],
        "unable_sources": unable_sources or [],
        "next_action": next_action,
        "run_id": run_id or os.environ.get("MIRA_RUN_ID", ""),
        "started_at": started_at or "",
        "finished_at": finished_at or utc_now_iso(),
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")
    return target
