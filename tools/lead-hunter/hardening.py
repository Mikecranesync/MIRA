"""Reusable reliability primitives for lead-hunter and similar batch routines.

Provides:
  singleton_lock(name)          — file-based lock; second invocation exits cleanly
  with_retries(fn, ...)          — exponential backoff with jitter, bounded retries
  hard_timeout(seconds)          — SIGALRM-based deadline (Unix only; no-op on Windows)
  preflight_secrets(required)    — fail fast with actionable error if env missing
  RunReport                       — structured per-step pass/fail/skip + timings
  alert(report, level)            — append JSON line to alert log + optional webhook

Designed for routines that run unattended on cron / launchd / Celery beat where
silent failures and runaway processes are the most damaging failure modes.
"""
from __future__ import annotations

import errno
import fcntl
import json
import logging
import os
import random
import signal
import sys
import time
import traceback
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

log = logging.getLogger("hardening")


# ---------------------------------------------------------------------------
# Singleton lock — prevents overlapping cron runs
# ---------------------------------------------------------------------------

@contextmanager
def singleton_lock(name: str, lock_dir: str | Path | None = None):
    """File-based lock; raises SystemExit(0) if another instance holds it.

    Example:
        with singleton_lock("lead-hunter"):
            run()
    """
    lock_dir = Path(lock_dir or os.getenv("HARDENING_LOCK_DIR", "/tmp"))
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f".{name}.lock"
    fp = open(lock_path, "w")
    try:
        try:
            fcntl.flock(fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                log.warning("Another %s instance is running (lock=%s) — exiting cleanly", name, lock_path)
                fp.close()
                sys.exit(0)
            raise
        fp.write(f"pid={os.getpid()}\nstarted={datetime.now(timezone.utc).isoformat()}\n")
        fp.flush()
        yield
    finally:
        try:
            fcntl.flock(fp, fcntl.LOCK_UN)
        except Exception:
            pass
        fp.close()
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------------------
# Retry with exponential backoff + jitter
# ---------------------------------------------------------------------------

def with_retries(
    fn: Callable[[], Any],
    *,
    name: str = "step",
    retries: int = 3,
    backoff: float = 2.0,
    jitter: bool = True,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
    give_up_on: tuple[type[BaseException], ...] = (KeyboardInterrupt, SystemExit),
) -> Any:
    """Call fn() with bounded retries. Returns fn()'s value or raises last error.

    Backoff schedule: backoff^0, backoff^1, … (with up to ±25% jitter).
    """
    last_exc: BaseException | None = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except give_up_on:
            raise
        except retry_on as e:
            last_exc = e
            if attempt == retries:
                log.error("%s exhausted %d retries: %s", name, retries, e)
                raise
            wait = backoff ** attempt
            if jitter:
                wait *= random.uniform(0.75, 1.25)
            log.warning("%s attempt %d/%d failed (%s) — retrying in %.1fs",
                        name, attempt + 1, retries + 1, e, wait)
            time.sleep(wait)
    if last_exc:
        raise last_exc


# ---------------------------------------------------------------------------
# Hard timeout — kills the routine if it hangs
# ---------------------------------------------------------------------------

@contextmanager
def hard_timeout(seconds: int):
    """SIGALRM-based deadline. Raises TimeoutError on expiry. Unix only.

    Example:
        with hard_timeout(1500):  # 25 min
            do_long_work()
    """
    if not hasattr(signal, "SIGALRM"):
        yield
        return

    def _handler(signum, frame):
        raise TimeoutError(f"hard_timeout({seconds}s) expired")

    old = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


# ---------------------------------------------------------------------------
# Preflight — verify required secrets/state before starting work
# ---------------------------------------------------------------------------

def preflight_secrets(required: Iterable[str], optional: Iterable[str] = ()) -> dict[str, bool]:
    """Verify all `required` env vars are set and non-empty. Exit(2) if any missing.

    Returns a {name: present} map for both required + optional so callers can
    decide what to do about optional gaps (typically: log and skip that path).
    """
    missing = [k for k in required if not os.environ.get(k, "").strip()]
    present = {k: bool(os.environ.get(k, "").strip()) for k in (*required, *optional)}
    if missing:
        log.error("PREFLIGHT FAIL — missing required env: %s", ", ".join(missing))
        log.error("Common causes: launchd lacks Doppler keychain access; "
                  "doppler service token not exported; running with wrong --config")
        sys.exit(2)
    return present


# ---------------------------------------------------------------------------
# Structured run reports
# ---------------------------------------------------------------------------

@dataclass
class StepResult:
    name: str
    status: str  # "ok" | "fail" | "skip"
    duration_s: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass
class RunReport:
    """Captures per-step results for a single routine invocation."""
    routine: str
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    duration_s: float = 0.0
    overall: str = "ok"  # "ok" | "degraded" | "fail"
    steps: list[StepResult] = field(default_factory=list)
    alerts: list[str] = field(default_factory=list)

    def step(self, name: str):
        return _StepCtx(self, name)

    def add_alert(self, msg: str) -> None:
        log.warning("ALERT %s: %s", self.routine, msg)
        self.alerts.append(msg)

    def finalize(self) -> None:
        self.finished_at = datetime.now(timezone.utc).isoformat()
        if self.steps:
            self.duration_s = sum(s.duration_s for s in self.steps)
        if any(s.status == "fail" for s in self.steps):
            self.overall = "fail"
        elif self.alerts or any(s.status == "skip" for s in self.steps):
            self.overall = "degraded" if self.overall == "ok" else self.overall

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, default=str)

    def is_healthy(self) -> bool:
        return self.overall == "ok"


class _StepCtx:
    def __init__(self, report: RunReport, name: str):
        self.report = report
        self.name = name
        self.t0 = 0.0
        self.result = StepResult(name=name, status="ok")

    def __enter__(self):
        self.t0 = time.monotonic()
        return self.result

    def __exit__(self, exc_type, exc, tb):
        self.result.duration_s = time.monotonic() - self.t0
        if exc is not None:
            self.result.status = "fail"
            self.result.error = f"{exc_type.__name__}: {exc}"
            log.error("step=%s FAIL after %.1fs: %s", self.name, self.result.duration_s, exc)
            log.debug("traceback: %s", "".join(traceback.format_tb(tb)))
        else:
            log.info("step=%s %s in %.1fs (%s)", self.name, self.result.status,
                     self.result.duration_s,
                     ", ".join(f"{k}={v}" for k, v in self.result.detail.items()) or "no detail")
        self.report.steps.append(self.result)
        # Swallow exception so the routine can continue to other steps;
        # caller checks report.is_healthy() at the end.
        return True


# ---------------------------------------------------------------------------
# Alerting — append JSONL + optional Discord webhook
# ---------------------------------------------------------------------------

def alert(report: RunReport, alert_log: str | Path | None = None) -> None:
    """Append the report as one JSON line to the alert log if it isn't healthy.

    Discord webhook (optional): set DISCORD_ALERT_WEBHOOK to fire there too.
    """
    if report.is_healthy():
        return
    alert_log = Path(alert_log or os.getenv("HARDENING_ALERT_LOG", "/tmp/hardening-alerts.jsonl"))
    alert_log.parent.mkdir(parents=True, exist_ok=True)
    with open(alert_log, "a") as fh:
        fh.write(json.dumps(asdict(report), default=str) + "\n")
    log.warning("ALERT logged: routine=%s status=%s alerts=%d steps_failed=%d",
                report.routine, report.overall, len(report.alerts),
                sum(1 for s in report.steps if s.status == "fail"))

    webhook = os.getenv("DISCORD_ALERT_WEBHOOK", "").strip()
    if webhook:
        try:
            import httpx
            failed = [s.name for s in report.steps if s.status == "fail"]
            content = (
                f"**{report.routine}** — `{report.overall}`\n"
                f"failed: {failed or '—'}\n"
                f"alerts: {report.alerts or '—'}\n"
                f"duration: {report.duration_s:.1f}s"
            )
            with httpx.Client(timeout=5) as client:
                client.post(webhook, json={"content": content[:1900]})
        except Exception as e:
            log.warning("Discord webhook send failed (non-fatal): %s", e)
