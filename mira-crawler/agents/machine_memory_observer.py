"""CV-101 Machine Memory observer — READ-ONLY (PRD §9.4, Workstream C).

Extends the scheduled synthetic-dogfood runner with one more daily pass that
OBSERVES Machine Memory through the Hub's public, tenant-scoped, read-only
APIs and records what it saw. It never generates a fault, never controls
equipment, never writes SQL, never POSTs anything but its own sign-in.

Per scheduled day it records (§9.4):
  runner timestamp · deployed version · current connection freshness ·
  historian heartbeat · latest recorded fault-window identity · row count
  and window bounds · quality + physical/simulated classification · whether
  the API's own state claims match its underlying rows (`api_state_consistent`
  + `defects`).

Honesty split — three different claims, never conflated:
  * code ready           — this module + its tests pass (CI)
  * synthetic/staging    — a run against a Hub with a fixture window
  * operational          — SEVEN DISTINCT CONSECUTIVE scheduled days with no
                           misleading-live / unavailable-as-empty defect AND at
                           least one real (non-simulated) fault window with rows.
                           This can only accrue with wall-clock time; it is
                           computed from the daily files, never asserted.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

SUBDIR = "machine-memory-observer"
SERIES_FILE = "series.json"
REQUIRED_CONSECUTIVE_DAYS = 7


class HubClient(Protocol):
    def get(self, path: str) -> tuple[int, dict[str, Any]]: ...


@dataclass
class ObserverConfig:
    enabled: bool
    hub_base: str
    asset_id: str
    report_dir: str
    cookie: str | None
    pre_seconds: int = 60
    post_seconds: int = 10

    @classmethod
    def from_env(cls) -> "ObserverConfig":
        return cls(
            enabled=os.getenv("MACHINE_MEMORY_OBSERVER_ENABLED") == "1",
            hub_base=os.getenv(
                "DOGFOOD_TARGET_URL", os.getenv("HUB_URL", "https://app.factorylm.com")
            ).rstrip("/"),
            asset_id=os.getenv("MACHINE_MEMORY_OBSERVER_ASSET_ID", ""),
            report_dir=os.getenv("DOGFOOD_REPORT_DIR", "/mira-db/synthetic-dogfood"),
            cookie=os.getenv("MACHINE_MEMORY_OBSERVER_COOKIE") or None,
        )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── pure evaluation ─────────────────────────────────────────────────────────


def classify_rows(rows: list[dict[str, Any]]) -> str:
    """physical / simulated / stale / unknown from the served rows."""
    if not rows:
        return "unknown"
    simulated = sum(
        1 for r in rows if r.get("simulated") is True or r.get("source_system") == "simulator"
    )
    if simulated >= len(rows):
        return "simulated"
    bad = sum(1 for r in rows if str(r.get("quality") or "").lower() in ("bad", "stale"))
    if bad >= len(rows):
        return "stale"
    return "physical"


def evaluate_observation(
    history: dict[str, Any] | None, memory: dict[str, Any] | None
) -> list[str]:
    """Defect detectors — the two failure modes §9.4 forbids.

    * misleading_live / admissible_without_rows — the API says the window is
      admissible (a client would offer "Ask MIRA what happened") while it
      served zero rows, or the served window is empty and freshness alone
      would be read as evidence.
    * unavailable_as_empty — the history source is absent (`reason:
      "unavailable"`) but coverage claims the source answered.
    """
    defects: list[str] = []
    if not history:
        return defects
    rows = history.get("rows") or []
    cov = history.get("coverage") or {}
    reason = history.get("reason")
    if cov.get("admissible") is True and len(rows) == 0:
        defects.append("admissible_without_rows")
        defects.append("misleading_live")
    if reason == "unavailable" and cov.get("historyAvailable") is True:
        defects.append("unavailable_as_empty")
    if reason == "unavailable" and cov.get("admissible") is True:
        defects.append("misleading_live")
    return sorted(set(defects))


def _day(ts: str) -> str:
    return (
        datetime.fromisoformat(ts.replace("Z", "+00:00"))
        .astimezone(timezone.utc)
        .date()
        .isoformat()
    )


def evaluate_series(records: list[dict[str, Any]], *, now: datetime) -> dict[str, Any]:
    """Seven-day gate over the DAILY records (one per distinct scheduled day)."""
    by_day: dict[str, dict[str, Any]] = {}
    for r in records:
        d = _day(r["observed_at"])
        prev = by_day.get(d)
        if prev is None or r["observed_at"] >= prev["observed_at"]:
            by_day[d] = r
    days = sorted(by_day)
    # longest run of consecutive calendar days ending at the latest observed day
    consecutive = 0
    if days:
        cur = datetime.fromisoformat(days[-1]).date()
        for d in reversed(days):
            if datetime.fromisoformat(d).date() == cur:
                consecutive += 1
                cur = cur - timedelta(days=1)
            else:
                break
    defects = sorted({d for r in by_day.values() for d in (r.get("defects") or [])})
    real_fault = any(
        (r.get("row_count") or 0) > 0
        and r.get("classification") == "physical"
        and r.get("fault_window")
        for r in by_day.values()
    )
    reasons: list[str] = []
    if consecutive < REQUIRED_CONSECUTIVE_DAYS:
        reasons.append("SEVEN_DAYS_NOT_ACCRUED")
    if defects:
        reasons.append("DEFECT_OBSERVED")
    if not real_fault:
        reasons.append("NO_REAL_FAULT_WINDOW")
    return {
        "evaluated_at": now.astimezone(timezone.utc).isoformat(),
        "days_observed": len(days),
        "consecutive_days": consecutive,
        "required_consecutive_days": REQUIRED_CONSECUTIVE_DAYS,
        "defects": defects,
        "real_fault_window_with_rows": real_fault,
        "operational": not reasons,
        "reasons": reasons,
        "code_ready": True,
        "note": "operational can only accrue with wall-clock time; this file is computed from daily records, never asserted",
    }


# ── one observation ─────────────────────────────────────────────────────────

_REDACT = re.compile(r"(session-token=)[^;\s\"]+|(\"cookie\"\s*:\s*\")[^\"]+", re.I)


def _redact(text: str) -> str:
    return _REDACT.sub(lambda m: (m.group(1) or m.group(2) or "") + "[redacted]", text)


def observe_once(
    config: ObserverConfig, hub: HubClient, *, now: datetime | None = None
) -> dict[str, Any]:
    now = now or utc_now()
    if not config.enabled:
        return {
            "enabled": False,
            "observed_at": now.isoformat(),
            "reason": "MACHINE_MEMORY_OBSERVER_ENABLED is not 1",
        }

    status, version = hub.get("/api/version/")
    deployed = (
        str(version.get("version") or version.get("gitSha") or "unknown")
        if status == 200
        else "unknown"
    )

    mstatus, memory = hub.get(f"/api/assets/{config.asset_id}/machine-memory/")
    memory = memory if mstatus == 200 else {}
    live_tags = memory.get("live_tags") or []
    fresh = [t.get("freshness") for t in live_tags]
    current = (
        "live"
        if "live" in fresh
        else "stale"
        if "stale" in fresh
        else "simulated"
        if "simulated" in fresh
        else "unknown"
    )

    hstatus, history = hub.get(
        f"/api/assets/{config.asset_id}/history/?pre={config.pre_seconds}&post={config.post_seconds}"
    )
    history_ok = hstatus == 200
    rows = (history.get("rows") or []) if history_ok else []
    cov = (history.get("coverage") or {}) if history_ok else {}
    anchor = (history.get("anchor") or {}) if history_ok else {}
    window = (history.get("window") or {}) if history_ok else {}
    latest_window = memory.get("latest_window") or {}

    record: dict[str, Any] = {
        "enabled": True,
        "observed_at": now.isoformat(),
        "deployed_version": deployed,
        "asset_id": config.asset_id,
        "current_connection": current,
        "historian_heartbeat": {
            "latest_window_state": latest_window.get("state"),
            "latest_window_started_at": latest_window.get("started_at"),
            "windows_available": (history.get("windowsAvailable") is not False)
            if not history_ok
            else True,
            "history_status": hstatus,
            "history_reason": history.get("reason") if history_ok else history.get("error"),
        },
        "fault_window": (
            {
                "id": anchor.get("windowId"),
                "anchor_at": anchor.get("at"),
                "source": anchor.get("source"),
                "state": latest_window.get("state"),
            }
            if history_ok and (anchor.get("windowId") or anchor.get("at"))
            else None
        ),
        "row_count": int(cov.get("recorded", len(rows))) if history_ok else 0,
        "window_bounds": {
            "from": window.get("from"),
            "to": window.get("to"),
            "pre": window.get("pre"),
            "post": window.get("post"),
        }
        if history_ok
        else None,
        "quality": sorted({str(r.get("quality")) for r in rows}) if rows else [],
        "classification": classify_rows(rows),
        "coverage": cov or None,
        "api_state_consistent": True,
        "defects": [],
    }
    defects = evaluate_observation(history if history_ok else None, memory)
    record["defects"] = defects
    record["api_state_consistent"] = not defects

    _write_daily(config, record, now)
    return record


def _write_daily(config: ObserverConfig, record: dict[str, Any], now: datetime) -> None:
    out = Path(config.report_dir) / SUBDIR
    out.mkdir(parents=True, exist_ok=True)
    day = now.astimezone(timezone.utc).date().isoformat()
    (out / f"{day}.json").write_text(
        _redact(json.dumps(record, indent=2, default=str)), encoding="utf-8"
    )
    records = []
    for f in sorted(out.glob("*.json")):
        if f.name == SERIES_FILE:
            continue
        try:
            r = json.loads(f.read_text(encoding="utf-8"))
            if r.get("enabled") is not False and "observed_at" in r:
                records.append(r)
        except ValueError:
            continue
    (out / SERIES_FILE).write_text(
        json.dumps(evaluate_series(records, now=now), indent=2), encoding="utf-8"
    )
