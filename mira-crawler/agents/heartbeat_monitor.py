"""Heartbeat Monitor — runs every 15 min, checks health of every critical surface.

Architecture
------------
This script is designed to run **on the VPS itself** under cron (see
`scripts/install_crons.sh`). All checks are local to the VPS:

  * `docker ps`                  → container liveness
  * `curl http://localhost:…`    → API endpoint health
  * `docker logs … --since 5m`   → bot poll evidence
  * `psycopg2`/SQLAlchemy        → NeonDB SELECT 1
  * stat(manual_queue.json)      → KB cron freshness
  * `df -h /`, `free -m`         → host resource pressure

Every probe returns a structured `HealthCheck` (service / status / latency /
details). Results are persisted to NeonDB `system_health_log` for trend
analysis, and surfaced via Telegram **only when something is wrong** so Mike
isn't spammed when everything is green.

Behaviour
---------
- DOWN  → immediate Telegram alert, also triggers self_healer (separate agent)
- DEGRADED > 30 min  → escalating Telegram warning (state held in NeonDB)
- HEALTHY  → silent, except for the 08:00 UTC daily roll-up

Usage
-----
    python3 mira-crawler/agents/heartbeat_monitor.py
    python3 mira-crawler/agents/heartbeat_monitor.py --json    # machine-readable
    python3 mira-crawler/agents/heartbeat_monitor.py --dry-run # no DB write, no Telegram
    python3 mira-crawler/agents/heartbeat_monitor.py --daily-summary  # 08:00 UTC roll-up

Schedule (see scripts/install_crons.sh)
    */15 * * * *    heartbeat_monitor.py
    0 8 * * *       heartbeat_monitor.py --daily-summary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow `python3 mira-crawler/agents/heartbeat_monitor.py` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] heartbeat: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("heartbeat_monitor")

# Where the prod compose project lives; also where deploy-vps.yml drops its
# in-progress sentinel. Kept in sync with self_healer.MIRA_DIR.
MIRA_DIR = os.environ.get("MIRA_DIR", "/opt/mira")
# A deploy shouldn't outlast this; a sentinel older than it is treated as stale
# (a crashed deploy that never cleaned up) so a stuck file can't disable
# monitoring forever.
DEPLOY_SENTINEL_TTL_SEC = int(os.environ.get("DEPLOY_SENTINEL_TTL_SEC", "1800"))
# While a service stays DOWN, re-alert at most this often instead of on every
# 15-min run — the heartbeat is the bell, but hourly is enough for a sustained
# outage (2026-07-08: every-15-min for hours). First detection always alerts.
DOWN_RENOTIFY_MIN = int(os.environ.get("HEARTBEAT_DOWN_RENOTIFY_MIN", "60"))


def deploy_in_progress() -> bool:
    """True while a VPS deploy is running.

    ``deploy-vps.yml`` touches ``$MIRA_DIR/.deploy-in-progress`` at the start of
    the remote block and removes it on exit (trap). The heartbeat and self-healer
    check this to STAND DOWN instead of racing the deploy's own container
    recreate — the 2026-07-08 incident, where the healer crash-looped
    ``compose up`` against a deploy and fired a Telegram escalation every 15 min
    for the transient 502 window. A sentinel older than DEPLOY_SENTINEL_TTL_SEC
    is ignored as stale.
    """
    sentinel = Path(os.environ.get("MIRA_DIR", MIRA_DIR)) / ".deploy-in-progress"
    try:
        if not sentinel.exists():
            return False
        return (time.time() - sentinel.stat().st_mtime) < DEPLOY_SENTINEL_TTL_SEC
    except OSError:
        return False


def is_retryable_db_error(exc: Exception) -> bool:
    """True for transient Postgres errors worth one more attempt — deadlock
    (SQLSTATE 40P01) and serialization failure (40001). These surface through
    SQLAlchemy as OperationalError with the code/text in the message."""
    s = str(exc).lower()
    return any(t in s for t in ("deadlock detected", "40p01", "could not serialize", "40001"))


def _load_notify():
    """Import telegram_notify resiliently — the parent dir is `mira-crawler`
    (hyphen, not a valid Python package name), so the dotted import only works
    if a setup.py/pyproject installed it. We fall back to importing the file
    by absolute path."""
    try:
        from mira_crawler.reporting.telegram_notify import notify as _n  # type: ignore

        return _n
    except ImportError:
        pass
    import importlib.util

    tn_path = Path(__file__).resolve().parent.parent / "reporting" / "telegram_notify.py"
    if tn_path.exists():
        spec = importlib.util.spec_from_file_location("telegram_notify", tn_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.notify

    def _stub(agent_key: str, message: str, **_: Any) -> bool:
        print(f"[{agent_key}] {message}")
        return True

    return _stub


notify = _load_notify()


# ── Status taxonomy ───────────────────────────────────────────────────────────

STATUS_HEALTHY = "healthy"
STATUS_DEGRADED = "degraded"
STATUS_DOWN = "down"
STATUS_UNKNOWN = "unknown"

# How slow before a working service is "degraded" (per-check, can override)
DEFAULT_DEGRADED_LATENCY_MS = 2_000
# After this long in DEGRADED, escalate to Mike (single alert, then quiet)
DEGRADED_ALERT_AFTER_MIN = 30


# ── Critical surface inventory ────────────────────────────────────────────────
# Add/remove entries here — the inventory is the contract. Every other agent
# consumes this list (self-healer remediations key off `service`).

CRITICAL_CONTAINERS = [
    "mira-hub",
    "mira-pipeline-saas",
    "mira-bot-telegram",
    "mira-scan-backend",
    "cmms-backend",
    # mira-docling-saas removed 2026-07-07: docling was decommissioned 2026-06-06
    # (OOM — docs/known-issues/2026-06-06-hub-upload-failures-docling-oom.md) and is
    # no longer in docker-compose.saas.yml. Keeping it here made the self-healer
    # try to recreate a non-existent container every 15 min. Ingest now extracts
    # in-process (mira-crawler/ingest/pdf_extract.py), no docling service.
    "mira-web",
    "mira-mcp-saas",
]

HTTP_ENDPOINTS = [
    # (label, url, expect_status, timeout_s)
    ("app.factorylm.com/api/health", "https://app.factorylm.com/api/health", 200, 10),
    (
        "app.factorylm.com/api/scanbe/healthz",
        "https://app.factorylm.com/api/scanbe/healthz",
        200,
        10,
    ),
    ("factorylm.com", "https://factorylm.com", 200, 10),
]

# Container we expect to be polling Telegram. We grep its recent log for the
# pattern emitted by python-telegram-bot's getUpdates loop.
TELEGRAM_BOT_CONTAINER = "mira-bot-telegram"
TELEGRAM_POLL_PATTERN = "getUpdates"
TELEGRAM_LOG_WINDOW_MIN = 5

# KB Growth cron freshness — `manual_queue.json` mtime should be < 24h on a
# healthy node (cron runs every 6h). The probe MUST resolve the SAME path the
# cron writes, or it reads a perpetually-stale orphan and reports DOWN forever
# (#2782): the cron writes `MIRA_MANUAL_QUEUE_PATH` (default
# `/var/lib/mira/manual_queue.json`, relocated 2026-07-11 #2562/#2639 to survive
# `git checkout --force`), while this probe historically read a hard-coded
# `/opt/mira/...` path (#1015) that nothing writes. Keep in sync with
# `kb_growth_cron._QUEUE_PATH_DEFAULT` / `QUEUE_FILE`.
_KB_QUEUE_DEFAULT = "/var/lib/mira/manual_queue.json"
KB_QUEUE_PATHS = [
    os.environ.get("MIRA_MANUAL_QUEUE_PATH", _KB_QUEUE_DEFAULT),
]
KB_STALE_AFTER_HOURS = 24

# Resource thresholds
DISK_WARN_PCT = 80
DISK_DOWN_PCT = 90
MEM_WARN_PCT = 90
MEM_DOWN_PCT = 95


# ── Probe result type ─────────────────────────────────────────────────────────


@dataclass
class HealthCheck:
    service: str
    status: str
    latency_ms: int
    details: str = ""
    category: str = "service"  # service | endpoint | resource | data
    extra: dict[str, Any] = field(default_factory=dict)


# ── Probes ────────────────────────────────────────────────────────────────────


def _run_cmd(cmd: list[str], timeout: int = 15) -> tuple[int, str, str]:
    """Run a shell command, return (returncode, stdout, stderr). Never raises."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as exc:
        return 127, "", f"binary not found: {exc}"
    except Exception as exc:  # noqa: BLE001
        return 1, "", str(exc)


def check_container(name: str) -> HealthCheck:
    """Container is healthy if `docker ps` lists it AND state is `running`."""
    start = time.perf_counter()
    rc, out, err = _run_cmd(
        ["docker", "ps", "--filter", f"name=^{name}$", "--format", "{{.Names}} {{.Status}}"],
        timeout=10,
    )
    latency = int((time.perf_counter() - start) * 1000)

    if rc == 127:
        return HealthCheck(name, STATUS_UNKNOWN, latency, "docker not on PATH", "service")
    if rc != 0:
        return HealthCheck(
            name, STATUS_DOWN, latency, f"docker ps failed: {err.strip()[:120]}", "service"
        )

    line = out.strip()
    if not line:
        return HealthCheck(
            name,
            STATUS_DOWN,
            latency,
            "container not running",
            "service",
            extra={"remediation_hint": "container_missing"},
        )

    # `Up 3 hours (healthy)` is the normal status. Anything starting with `Restarting` or
    # `Exited` is degraded/down.
    status_line = line.partition(" ")[2]
    if status_line.startswith("Up"):
        if "(unhealthy)" in status_line:
            return HealthCheck(
                name,
                STATUS_DEGRADED,
                latency,
                status_line,
                "service",
                extra={"remediation_hint": "container_unhealthy"},
            )
        return HealthCheck(name, STATUS_HEALTHY, latency, status_line, "service")
    if status_line.startswith("Restarting"):
        return HealthCheck(
            name,
            STATUS_DEGRADED,
            latency,
            status_line,
            "service",
            extra={"remediation_hint": "container_restarting"},
        )
    return HealthCheck(
        name,
        STATUS_DOWN,
        latency,
        status_line,
        "service",
        extra={"remediation_hint": "container_exited"},
    )


def check_http(label: str, url: str, expect: int, timeout: int) -> HealthCheck:
    start = time.perf_counter()
    try:
        import httpx

        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
        latency = int((time.perf_counter() - start) * 1000)
        if resp.status_code == expect:
            status = STATUS_DEGRADED if latency > DEFAULT_DEGRADED_LATENCY_MS else STATUS_HEALTHY
            return HealthCheck(label, status, latency, f"HTTP {resp.status_code}", "endpoint")
        if 500 <= resp.status_code < 600:
            return HealthCheck(
                label,
                STATUS_DOWN,
                latency,
                f"HTTP {resp.status_code}",
                "endpoint",
                extra={"remediation_hint": "api_5xx", "url": url},
            )
        return HealthCheck(
            label,
            STATUS_DEGRADED,
            latency,
            f"HTTP {resp.status_code} (expected {expect})",
            "endpoint",
        )
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - start) * 1000)
        return HealthCheck(
            label,
            STATUS_DOWN,
            latency,
            f"{type(exc).__name__}: {str(exc)[:120]}",
            "endpoint",
            extra={"remediation_hint": "endpoint_unreachable", "url": url},
        )


def check_telegram_polling() -> HealthCheck:
    """Look for `getUpdates` in the bot container's last 5 minutes of logs."""
    start = time.perf_counter()
    rc, out, err = _run_cmd(
        ["docker", "logs", "--since", f"{TELEGRAM_LOG_WINDOW_MIN}m", TELEGRAM_BOT_CONTAINER],
        timeout=15,
    )
    latency = int((time.perf_counter() - start) * 1000)

    if rc == 127:
        return HealthCheck(
            "telegram_polling", STATUS_UNKNOWN, latency, "docker not on PATH", "service"
        )
    if rc != 0:
        return HealthCheck(
            "telegram_polling",
            STATUS_DOWN,
            latency,
            f"docker logs failed: {err.strip()[:120]}",
            "service",
        )

    if TELEGRAM_POLL_PATTERN.lower() in (out + err).lower():
        return HealthCheck(
            "telegram_polling",
            STATUS_HEALTHY,
            latency,
            f"poll evidence in last {TELEGRAM_LOG_WINDOW_MIN}m",
            "service",
        )

    # No evidence of polling — bot may be alive but stuck.
    return HealthCheck(
        "telegram_polling",
        STATUS_DOWN,
        latency,
        f"no '{TELEGRAM_POLL_PATTERN}' in last {TELEGRAM_LOG_WINDOW_MIN}m",
        "service",
        extra={"remediation_hint": "bot_not_polling"},
    )


def check_neondb() -> HealthCheck:
    """Open an engine, run SELECT 1, return latency."""
    start = time.perf_counter()
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return HealthCheck("neondb", STATUS_UNKNOWN, 0, "NEON_DATABASE_URL not set", "data")

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency = int((time.perf_counter() - start) * 1000)
        status = STATUS_DEGRADED if latency > 3_000 else STATUS_HEALTHY
        return HealthCheck("neondb", status, latency, "SELECT 1 ok", "data")
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - start) * 1000)
        return HealthCheck(
            "neondb",
            STATUS_DOWN,
            latency,
            f"{type(exc).__name__}: {str(exc)[:120]}",
            "data",
            extra={"remediation_hint": "neondb_connection"},
        )


def check_kb_cron_freshness() -> HealthCheck:
    """KB growth cron writes manual_queue.json every 6h. >24h = stale."""
    start = time.perf_counter()
    for path in KB_QUEUE_PATHS:
        p = Path(path)
        if p.exists():
            age_h = (time.time() - p.stat().st_mtime) / 3600
            latency = int((time.perf_counter() - start) * 1000)
            if age_h > KB_STALE_AFTER_HOURS:
                return HealthCheck(
                    "kb_cron",
                    STATUS_DOWN,
                    latency,
                    f"manual_queue.json {age_h:.1f}h old",
                    "data",
                    extra={"remediation_hint": "kb_cron_stale", "path": path},
                )
            return HealthCheck(
                "kb_cron", STATUS_HEALTHY, latency, f"manual_queue.json {age_h:.1f}h old", "data"
            )

    latency = int((time.perf_counter() - start) * 1000)
    return HealthCheck(
        "kb_cron",
        STATUS_UNKNOWN,
        latency,
        f"no manual_queue.json found at {KB_QUEUE_PATHS}",
        "data",
    )


def check_disk() -> HealthCheck:
    start = time.perf_counter()
    try:
        usage = shutil.disk_usage("/")
        pct = int(100 * usage.used / usage.total)
        latency = int((time.perf_counter() - start) * 1000)
        details = f"{pct}% used ({usage.used // 2**30}G / {usage.total // 2**30}G)"
        if pct >= DISK_DOWN_PCT:
            return HealthCheck(
                "disk",
                STATUS_DOWN,
                latency,
                details,
                "resource",
                extra={"remediation_hint": "disk_full", "pct": pct},
            )
        if pct >= DISK_WARN_PCT:
            return HealthCheck(
                "disk", STATUS_DEGRADED, latency, details, "resource", extra={"pct": pct}
            )
        return HealthCheck("disk", STATUS_HEALTHY, latency, details, "resource", extra={"pct": pct})
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - start) * 1000)
        return HealthCheck("disk", STATUS_UNKNOWN, latency, str(exc), "resource")


def check_memory() -> HealthCheck:
    """Parse `free -m`. Linux-only — silently UNKNOWN on macOS."""
    start = time.perf_counter()
    rc, out, _ = _run_cmd(["free", "-m"], timeout=5)
    latency = int((time.perf_counter() - start) * 1000)

    if rc != 0 or not out:
        return HealthCheck("memory", STATUS_UNKNOWN, latency, "free not available", "resource")

    try:
        lines = out.strip().splitlines()
        # `Mem: total used free shared buff/cache available`
        mem_line = next(line for line in lines if line.lower().startswith("mem"))
        parts = mem_line.split()
        total = int(parts[1])
        used = int(parts[2])
        pct = int(100 * used / total) if total else 0
        details = f"{pct}% used ({used}M / {total}M)"
    except Exception as exc:  # noqa: BLE001
        return HealthCheck("memory", STATUS_UNKNOWN, latency, f"parse error: {exc}", "resource")

    if pct >= MEM_DOWN_PCT:
        return HealthCheck("memory", STATUS_DOWN, latency, details, "resource", extra={"pct": pct})
    if pct >= MEM_WARN_PCT:
        return HealthCheck(
            "memory", STATUS_DEGRADED, latency, details, "resource", extra={"pct": pct}
        )
    return HealthCheck("memory", STATUS_HEALTHY, latency, details, "resource", extra={"pct": pct})


# ── Aggregator ───────────────────────────────────────────────────────────────


def run_all_checks() -> list[HealthCheck]:
    """Run every probe sequentially. Probes are cheap and cron-driven, so the
    extra complexity of asyncio isn't worth it here."""
    checks: list[HealthCheck] = []

    for c in CRITICAL_CONTAINERS:
        checks.append(check_container(c))

    for label, url, expect, timeout in HTTP_ENDPOINTS:
        checks.append(check_http(label, url, expect, timeout))

    checks.append(check_telegram_polling())
    checks.append(check_neondb())
    checks.append(check_kb_cron_freshness())
    checks.append(check_disk())
    checks.append(check_memory())

    return checks


def health_score(checks: list[HealthCheck]) -> int:
    """0-100 score. UNKNOWN doesn't penalise (we couldn't tell)."""
    weights = {STATUS_HEALTHY: 1.0, STATUS_DEGRADED: 0.5, STATUS_DOWN: 0.0}
    scored = [c for c in checks if c.status in weights]
    if not scored:
        return 0
    return int(round(100 * sum(weights[c.status] for c in scored) / len(scored)))


# ── Persistence ──────────────────────────────────────────────────────────────

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS system_health_log (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    service      TEXT NOT NULL,
    status       TEXT NOT NULL,
    latency_ms   INTEGER NOT NULL DEFAULT 0,
    details      TEXT,
    category     TEXT,
    score        INTEGER,
    action_taken TEXT,
    extra        JSONB
);
CREATE INDEX IF NOT EXISTS ix_health_log_ts ON system_health_log (ts DESC);
CREATE INDEX IF NOT EXISTS ix_health_log_service_ts ON system_health_log (service, ts DESC);
"""


def persist(checks: list[HealthCheck], score: int, dry_run: bool = False) -> bool:
    """Insert one row per check. Returns True on success, False on any error."""
    if dry_run:
        logger.info("dry-run: skipping persist (%d checks, score=%d)", len(checks), score)
        return True

    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        logger.warning("NEON_DATABASE_URL not set — skipping persist")
        return False

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except Exception as exc:  # noqa: BLE001
        logger.warning("persist failed (sqlalchemy import): %s", exc)
        return False

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

    # Deadlock root cause (2026-07-08): running the DDL (CREATE TABLE + two
    # CREATE INDEX IF NOT EXISTS) inside the same transaction as the INSERTs, on
    # EVERY call, made concurrent runs take a SHARE lock (DDL) and RowExclusive
    # lock (INSERT) in interleaved order → deadlock on system_health_log. Fix:
    # only touch DDL when the table is actually missing (a one-time cold start),
    # so the steady-state hot path is INSERT-only and can't self-deadlock. Retry
    # once more on the off chance of a transient deadlock/serialization failure.
    for attempt in range(3):
        try:
            with engine.begin() as conn:
                exists = conn.execute(
                    text("SELECT to_regclass('system_health_log')")
                ).scalar()
                if exists is None:
                    for stmt in CREATE_TABLE_SQL.strip().split(";"):
                        stmt = stmt.strip()
                        if stmt:
                            conn.execute(text(stmt))
                for c in checks:
                    conn.execute(
                        text(
                            "INSERT INTO system_health_log "
                            "(service, status, latency_ms, details, category, score, extra) "
                            "VALUES (:service, :status, :latency_ms, :details, :category, :score, :extra)"
                        ),
                        {
                            "service": c.service,
                            "status": c.status,
                            "latency_ms": c.latency_ms,
                            "details": c.details[:500],
                            "category": c.category,
                            "score": score,
                            "extra": json.dumps(c.extra) if c.extra else None,
                        },
                    )
            return True
        except Exception as exc:  # noqa: BLE001
            if is_retryable_db_error(exc) and attempt < 2:
                logger.warning("persist: retryable DB error (attempt %d) — %s", attempt + 1, exc)
                time.sleep(0.2 * (attempt + 1))
                continue
            logger.warning("persist failed: %s", exc)
            return False
    return False


def degraded_for_minutes(service: str) -> int | None:
    """How many minutes has `service` been DEGRADED in a row? None on DB error."""
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT MIN(ts) FROM ("
                    "  SELECT ts FROM system_health_log "
                    "  WHERE service = :svc "
                    "  ORDER BY ts DESC LIMIT 200"
                    ") recent "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM system_health_log h2 "
                    "  WHERE h2.service = :svc AND h2.ts > recent.ts AND h2.status != 'degraded'"
                    ")"
                ),
                {"svc": service},
            ).first()
        if not row or not row[0]:
            return None
        delta = datetime.now(timezone.utc) - row[0]
        return int(delta.total_seconds() // 60)
    except Exception:  # noqa: BLE001
        return None


def _should_send_down_alert(mins_since_last: float | None, renotify_min: int) -> bool:
    """First DOWN detection (no prior alert) always alerts; while a service stays
    down we re-alert at most once per renotify_min instead of every run — so a
    sustained outage pages hourly, not every 15 min."""
    return mins_since_last is None or mins_since_last >= renotify_min


def _minutes_since_last_down_alert() -> float | None:
    """Minutes since the last DOWN alert marker, or None if never / on DB error
    (fail toward alerting)."""
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        with engine.connect() as conn:
            val = conn.execute(
                text(
                    "SELECT EXTRACT(EPOCH FROM (NOW() - MAX(ts)))/60 "
                    "FROM system_health_log WHERE status = 'down_alert' AND category = 'alert'"
                )
            ).scalar()
        return float(val) if val is not None else None
    except Exception:  # noqa: BLE001
        return None


def _record_down_alert() -> None:
    """Stamp that we sent a DOWN alert, so the next runs can throttle. Marker row
    (category='alert', score NULL) is excluded from funnel_tracker's uptime avg."""
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
        for attempt in range(3):
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO system_health_log (service, status, latency_ms, category) "
                            "VALUES ('heartbeat', 'down_alert', 0, 'alert')"
                        )
                    )
                return
            except Exception as exc:  # noqa: BLE001
                if is_retryable_db_error(exc) and attempt < 2:
                    time.sleep(0.2 * (attempt + 1))
                    continue
                logger.warning("_record_down_alert failed: %s", exc)
                return
    except Exception as exc:  # noqa: BLE001
        logger.warning("_record_down_alert failed: %s", exc)


# ── Reporting ────────────────────────────────────────────────────────────────

_STATUS_EMOJI = {
    STATUS_HEALTHY: "🟢",
    STATUS_DEGRADED: "🟡",
    STATUS_DOWN: "🔴",
    STATUS_UNKNOWN: "⚪",
}


def format_alert(checks: list[HealthCheck], score: int) -> str:
    down = [c for c in checks if c.status == STATUS_DOWN]
    degraded = [c for c in checks if c.status == STATUS_DEGRADED]
    lines = [f"*Health: {score}/100*"]
    if down:
        lines.append(f"\n🔴 *{len(down)} DOWN*")
        for c in down[:8]:
            lines.append(f"  • `{c.service}` — {c.details[:80]}")
    if degraded:
        lines.append(f"\n🟡 *{len(degraded)} degraded*")
        for c in degraded[:5]:
            lines.append(f"  • `{c.service}` — {c.details[:80]} ({c.latency_ms}ms)")
    return "\n".join(lines)


def format_daily_summary(checks: list[HealthCheck], score: int) -> str:
    by_status: dict[str, list[HealthCheck]] = {}
    for c in checks:
        by_status.setdefault(c.status, []).append(c)

    lines = [
        f"*Daily Health Summary — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*",
        f"Overall: {score}/100",
        "",
    ]
    for status in (STATUS_HEALTHY, STATUS_DEGRADED, STATUS_DOWN, STATUS_UNKNOWN):
        items = by_status.get(status, [])
        if not items:
            continue
        lines.append(f"{_STATUS_EMOJI[status]} *{status.title()}* ({len(items)})")
        for c in items[:12]:
            lines.append(f"  • `{c.service}` — {c.details[:60]}")
        lines.append("")
    return "\n".join(lines).strip()


# ── Main ─────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MIRA heartbeat monitor")
    parser.add_argument("--json", action="store_true", help="Print JSON report to stdout")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run checks but don't persist or send Telegram alerts",
    )
    parser.add_argument(
        "--daily-summary",
        action="store_true",
        help="Send the daily summary regardless of state (use at 08:00 UTC)",
    )
    parser.add_argument("--quiet", action="store_true", help="Reduce log verbosity")
    args = parser.parse_args(argv)

    if args.quiet:
        logger.setLevel(logging.WARNING)

    checks = run_all_checks()
    score = health_score(checks)
    persist(checks, score, dry_run=args.dry_run)

    down = [c for c in checks if c.status == STATUS_DOWN]
    degraded = [c for c in checks if c.status == STATUS_DEGRADED]

    # Always emit JSON to stdout if asked — useful for piping into self_healer
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "score": score,
        "down": [asdict(c) for c in down],
        "degraded": [asdict(c) for c in degraded],
        "all": [asdict(c) for c in checks],
    }
    if args.json:
        print(json.dumps(report, indent=2))

    # Notify rules:
    # - DOWN  → immediate alert (every run while down — heartbeat is the bell)
    # - DEGRADED > 30min consecutively → one alert
    # - daily summary if requested
    if args.dry_run:
        logger.info(
            "dry-run: would alert: down=%d degraded=%d score=%d", len(down), len(degraded), score
        )
        return 0

    if args.daily_summary:
        notify("system", format_daily_summary(checks, score))
        return 0 if not down else 2

    if down:
        # Stand down during a deploy: the deploy force-recreates the core stack,
        # so a transient 502 / container-missing window is expected, not an
        # outage. Don't alert and don't return 2 (which would trigger the
        # self-healer to fight the deploy). Persisted above for the record.
        if deploy_in_progress():
            logger.warning(
                "DOWN during deploy — suppressing alert + self-heal: %s",
                [c.service for c in down],
            )
            return 0
        # Throttle repeat alerts for a sustained outage (hourly, not every run).
        mins_since = _minutes_since_last_down_alert()
        if _should_send_down_alert(mins_since, DOWN_RENOTIFY_MIN):
            notify("system", format_alert(checks, score))
            _record_down_alert()
            logger.warning("DOWN: %s", [c.service for c in down])
        else:
            logger.warning(
                "DOWN (alert throttled — last sent %.0fm ago): %s",
                mins_since or 0.0,
                [c.service for c in down],
            )
        return 2  # exit code 2 — caller (self_healer wrapper) can branch on this

    if degraded:
        # Suppress the alert unless we've been degraded > threshold.
        worst = max((degraded_for_minutes(c.service) or 0) for c in degraded)
        if worst >= DEGRADED_ALERT_AFTER_MIN:
            notify("system", format_alert(checks, score))
            logger.warning("DEGRADED >%dm: %s", worst, [c.service for c in degraded])
            return 1

    logger.info("all green — score=%d", score)
    return 0


if __name__ == "__main__":
    sys.exit(main())
