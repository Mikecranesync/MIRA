"""Self-Healer — runs scoped remediations against DOWN services.

Triggered by heartbeat_monitor (`exit code 2`) or by a fresh probe of its own.
Consumes the heartbeat JSON, looks up the `remediation_hint` recorded by each
probe, and dispatches to a small set of safe playbooks. Every action is logged
back to NeonDB `system_health_log.action_taken` and surfaced via Telegram.

Safety
------
The healer's blast radius is *deliberately tiny*:

  * Container restart, or recreate-from-existing-image via
    `docker compose up -d --no-deps` when the container is gone — never
    `docker rm`, never `--build` / image rebuild, never a registry pull of a
    new tag.
  * Disk cleanup is `docker system prune -f` and rotated log trim — never
    arbitrary `rm`.
  * **Never** touches nginx, NeonDB schema, or any persistent volume.
  * Will not run as root unless `MIRA_HEALER_ALLOW_ROOT=1`.

Each playbook is idempotent and re-checks the affected probe afterwards. If
the probe still fails, we escalate (one Telegram alert with full context) and
mark `escalated=true` in the log so we don't loop.

Usage
-----
    python3 mira-crawler/agents/self_healer.py            # probe → heal → re-probe
    python3 mira-crawler/agents/self_healer.py --dry-run  # log what we'd do
    python3 mira-crawler/agents/self_healer.py --service mira-pipeline  # one-shot
    cat heartbeat.json | python3 mira-crawler/agents/self_healer.py --stdin
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] healer: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("self_healer")

# Where the prod compose project lives — the healer cron runs from here, and
# the VPS deploy keeps it at origin/main. Mirror infra_guardian's env var so a
# single override moves both. Used to recreate a *removed* container (which
# `docker restart` cannot do — it errors "No such container").
MIRA_DIR = os.environ.get("MIRA_DIR", "/opt/mira")
COMPOSE_FILE = os.environ.get("COMPOSE_FILE", "docker-compose.saas.yml")


def _load_notify():
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


# Re-use the heartbeat probes for the post-action re-check.
try:
    from mira_crawler.agents import heartbeat_monitor as hb  # type: ignore
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import heartbeat_monitor as hb  # type: ignore[no-redef]


# ── Action result ────────────────────────────────────────────────────────────


@dataclass
class HealAction:
    service: str
    hint: str
    action: str
    succeeded: bool
    details: str
    escalated: bool = False
    # Set when we've hit the retry cap and are suspending auto-heal for this
    # service (crash-loop breaker). prior_gaveups = how many give-ups were
    # already logged in the window, so main() can dedupe repeat escalations.
    gave_up: bool = False
    prior_gaveups: int = 0


def _run(cmd: list[str], timeout: int = 60, cwd: str | None = None) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as exc:
        return 127, "", f"binary not found: {exc}"
    except Exception as exc:  # noqa: BLE001
        return 1, "", str(exc)


# ── Playbooks ────────────────────────────────────────────────────────────────
# Each playbook returns a HealAction. They MUST be idempotent and bounded.


def _container_exists(service: str) -> bool:
    """True if a container with this exact name exists in ANY state.

    `docker restart` only works on a container that exists; a *removed*
    container (the 2026-06-04 + 2026-06-06 incidents) makes it error
    "No such container". Detect that up front and recreate instead.
    """
    rc, out, _ = _run(
        ["docker", "ps", "-a", "--filter", f"name=^{service}$", "--format", "{{.Names}}"],
        timeout=10,
    )
    return rc == 0 and bool(out.strip())


def _compose_up(service: str) -> tuple[int, str, str]:
    """(Re)create or start ONE service from its existing image.

    `--no-deps` so we don't churn dependencies; no `--build` so we never
    rebuild (stays inside the healer's blast-radius contract). Runs from
    MIRA_DIR with the relative compose file — the same invocation the VPS
    deploy uses — so the new container joins the same compose project and
    networks (a container created on the wrong network comes up "healthy"
    but the edge still 502s).
    """
    return _run(
        ["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "--no-deps", service],
        timeout=180,
        cwd=MIRA_DIR,
    )


def _await_container_health(service: str, attempts: int = 12, delay: int = 5) -> str:
    """Poll until the container's own healthcheck reports healthy (or we give
    up after ~60s). A container's `(healthy)` status means its healthcheck —
    which hits the service's real endpoint — passed, so this verifies the app
    actually serves, not merely that a container is running."""
    import time

    last = "unknown"
    for _ in range(attempts):
        chk = hb.check_container(service)
        last = chk.status
        if chk.status == hb.STATUS_HEALTHY:
            return last
        time.sleep(delay)
    return last


def recreate_container(service: str, hint: str) -> HealAction:
    """Recreate a missing/stopped container, then wait for it to go healthy.

    This is the fix for `container_missing` — `docker restart` cannot bring
    back a removed container, but `docker compose up -d` recreates it from the
    existing image and also starts a merely-stopped one, so it covers both
    cases `container_missing` can mean.
    """
    action = f"docker compose up -d --no-deps {service}"
    rc, out, err = _compose_up(service)
    if rc != 0:
        return HealAction(
            service, hint, action, False, (err or out).strip()[:200] or "compose up failed"
        )
    status = _await_container_health(service)
    ok = status == hb.STATUS_HEALTHY
    return HealAction(service, hint, action, ok, f"recreated → {status}")


def restart_container(service: str, hint: str) -> HealAction:
    # A removed container can't be restarted — recreate it from the image.
    if not _container_exists(service):
        return recreate_container(service, hint)
    rc, out, err = _run(["docker", "restart", service], timeout=60)
    if rc == 0:
        return HealAction(
            service, hint, f"docker restart {service}", True, out.strip()[:200] or "ok"
        )
    # Lost a race (container removed between the existence check and now), or
    # any other "no such container" — fall back to a recreate before failing.
    if "no such container" in (err or "").lower():
        return recreate_container(service, hint)
    return HealAction(
        service, hint, f"docker restart {service}", False, err.strip()[:200] or out.strip()[:200]
    )


def disk_cleanup(service: str, hint: str) -> HealAction:
    """Prune dangling docker objects + truncate big rotated logs."""
    rc1, out1, err1 = _run(["docker", "system", "prune", "-f"], timeout=120)
    # Trim log files >100M under /var/log/mira-agents (rotated, append-only).
    log_dir = Path(os.environ.get("LOG_DIR", "/var/log/mira-agents"))
    trimmed = []
    if log_dir.exists():
        for log in log_dir.glob("*.log"):
            try:
                if log.stat().st_size > 100 * 2**20:
                    log.write_text("")  # truncate, don't delete
                    trimmed.append(log.name)
            except Exception:  # noqa: BLE001
                pass
    details = (
        f"docker prune rc={rc1} | trimmed={trimmed} | {out1.strip()[:120] or err1.strip()[:120]}"
    )
    return HealAction(service, hint, "docker system prune -f + log trim", rc1 == 0, details)


def trigger_kb_cron(service: str, hint: str) -> HealAction:
    """Manually run the KB growth cron once — same command as the cron line."""
    mira_dir = Path(os.environ.get("MIRA_DIR", "/opt/mira"))
    script = mira_dir / "mira-crawler" / "cron" / "kb_growth_cron.py"
    if not script.exists():
        return HealAction(service, hint, "trigger_kb_cron", False, f"script not found: {script}")
    rc, out, err = _run(["python3", str(script)], timeout=300)
    return HealAction(service, hint, f"python3 {script.name}", rc == 0, (err or out).strip()[:200])


def neondb_retry(service: str, hint: str) -> HealAction:
    """No restart possible — just re-probe a few times before escalating."""
    import time

    for attempt in range(3):
        chk = hb.check_neondb()
        if chk.status == hb.STATUS_HEALTHY:
            return HealAction(
                service, hint, "retry SELECT 1", True, f"recovered on attempt {attempt + 1}"
            )
        time.sleep(5)
    return HealAction(
        service, hint, "retry SELECT 1", False, "still failing after 3 retries — likely Neon-side"
    )


def noop_escalate(service: str, hint: str) -> HealAction:
    return HealAction(
        service,
        hint,
        "no playbook — escalate",
        False,
        "no automatic remediation defined",
        escalated=True,
    )


# ── Hint → playbook routing ──────────────────────────────────────────────────

PLAYBOOKS: dict[str, Callable[[str, str], HealAction]] = {
    "container_missing": recreate_container,  # removed OR stopped → compose up (restart can't recreate)
    "container_exited": restart_container,
    "container_unhealthy": restart_container,
    "container_restarting": restart_container,  # may be flapping; restart resets
    "api_5xx": restart_container,  # service field is the container name
    "endpoint_unreachable": noop_escalate,  # could be DNS / TLS / nginx — don't touch
    "bot_not_polling": restart_container,
    "neondb_connection": neondb_retry,
    "disk_full": disk_cleanup,
    "kb_cron_stale": trigger_kb_cron,
}


# Map an HTTP-endpoint label to the container that backs it. If a /api/health
# 5xx fires, this tells us which container to restart.
ENDPOINT_TO_CONTAINER = {
    "app.factorylm.com/api/health": "mira-web",
    "app.factorylm.com/api/scanbe/healthz": "mira-scan-backend",
    "factorylm.com": "mira-web",
}


# ── Orchestration ────────────────────────────────────────────────────────────


# Crash-loop breaker: after this many failed heals for one service inside the
# window, STOP re-attempting (a recreate that keeps failing isn't healing — it's
# churn) and escalate ONCE instead of every run. The 2026-07-08 incident fired an
# escalation every 15 min for hours because there was no cap.
MAX_HEAL_ATTEMPTS = int(os.environ.get("MAX_HEAL_ATTEMPTS", "4"))
HEAL_HISTORY_WINDOW_MIN = int(os.environ.get("HEAL_HISTORY_WINDOW_MIN", "120"))


def _heal_history(service: str, minutes: int) -> tuple[int, int]:
    """(failed_attempts, give_ups) logged for `service` in the last `minutes`.

    Returns (0, 0) on any DB error — fail toward attempting the heal, never
    toward silently giving up on a service.
    """
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return (0, 0)
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except Exception:  # noqa: BLE001
        return (0, 0)

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    for attempt in range(3):
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text(
                        "SELECT "
                        "  COUNT(*) FILTER (WHERE status = 'heal_failed'), "
                        "  COUNT(*) FILTER (WHERE status = 'heal_gaveup') "
                        "FROM system_health_log "
                        "WHERE service = :svc AND category = 'heal' "
                        "  AND ts > NOW() - make_interval(mins => :mins)"
                    ),
                    {"svc": service, "mins": minutes},
                ).first()
            if not row:
                return (0, 0)
            return (int(row[0] or 0), int(row[1] or 0))
        except Exception as exc:  # noqa: BLE001
            if hb.is_retryable_db_error(exc) and attempt < 2:
                time.sleep(0.2 * (attempt + 1))
                continue
            logger.warning("_heal_history failed: %s", exc)
            return (0, 0)
    return (0, 0)


def heal_one(check: dict[str, Any], dry_run: bool = False) -> HealAction:
    service: str = check.get("service") or "?"
    hint: str = (check.get("extra") or {}).get("remediation_hint") or ""
    playbook = PLAYBOOKS.get(hint, noop_escalate)

    # For api_5xx the "service" is the endpoint label, not a container name.
    target = ENDPOINT_TO_CONTAINER.get(service, service) if hint == "api_5xx" else service

    if dry_run:
        return HealAction(
            service, hint, f"DRY-RUN: would call {playbook.__name__}({target})", True, "dry-run"
        )

    # Crash-loop breaker: if we've already failed to heal this service
    # MAX_HEAL_ATTEMPTS times in the window, stop churning and escalate.
    failed, gaveups = _heal_history(service, HEAL_HISTORY_WINDOW_MIN)
    if failed >= MAX_HEAL_ATTEMPTS:
        logger.warning(
            "giving up on %s — %d failed heals in %dm; auto-heal suspended",
            service, failed, HEAL_HISTORY_WINDOW_MIN,
        )
        return HealAction(
            service,
            hint,
            f"gave up after {failed} failed attempts",
            False,
            f"{failed} failed heal attempts in {HEAL_HISTORY_WINDOW_MIN}m — "
            "auto-heal suspended, needs manual fix",
            escalated=True,
            gave_up=True,
            prior_gaveups=gaveups,
        )

    logger.info("healing %s via %s (target=%s)", service, playbook.__name__, target)
    action = playbook(target, hint)
    action.service = service  # preserve original service label for logging
    return action


def reverify(checks: list[dict[str, Any]]) -> dict[str, str]:
    """Re-run only the probes for services we tried to heal. Returns service→status."""
    by_service: dict[str, str] = {}
    for c in checks:
        svc = c.get("service") or "?"
        cat = c.get("category")
        try:
            if cat == "service" and svc in hb.CRITICAL_CONTAINERS:
                by_service[svc] = hb.check_container(svc).status
            elif svc == "telegram_polling":
                by_service[svc] = hb.check_telegram_polling().status
            elif svc == "neondb":
                by_service[svc] = hb.check_neondb().status
            elif svc == "kb_cron":
                by_service[svc] = hb.check_kb_cron_freshness().status
            elif svc == "disk":
                by_service[svc] = hb.check_disk().status
            else:
                by_service[svc] = "unverified"
        except Exception as exc:  # noqa: BLE001
            by_service[svc] = f"verify_error: {exc}"
    return by_service


def log_actions(actions: list[HealAction], dry_run: bool = False) -> None:
    if dry_run or not actions:
        return
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        return
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except Exception as exc:  # noqa: BLE001
        logger.warning("log_actions failed (import): %s", exc)
        return

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    for attempt in range(3):
        try:
            with engine.begin() as conn:
                for a in actions:
                    status = (
                        "healed" if a.succeeded else "heal_gaveup" if a.gave_up else "heal_failed"
                    )
                    conn.execute(
                        text(
                            "INSERT INTO system_health_log "
                            "(service, status, latency_ms, details, category, action_taken, extra) "
                            "VALUES (:service, :status, 0, :details, 'heal', :action, :extra)"
                        ),
                        {
                            "service": a.service,
                            "status": status,
                            "details": a.details[:500],
                            "action": a.action[:200],
                            "extra": json.dumps({"hint": a.hint, "escalated": a.escalated}),
                        },
                    )
            return
        except Exception as exc:  # noqa: BLE001
            if hb.is_retryable_db_error(exc) and attempt < 2:
                logger.warning("log_actions: retryable DB error (attempt %d) — %s", attempt + 1, exc)
                time.sleep(0.2 * (attempt + 1))
                continue
            logger.warning("log_actions failed: %s", exc)
            return


def _should_notify(actions: list[HealAction]) -> bool:
    """Notify when there's new information: any non-give-up action, or the FIRST
    give-up for a service (no give-up logged yet in the window). Suppresses the
    every-run repeat escalation for services we've already alerted a give-up on
    (the 2026-07-08 every-15-min spam)."""
    return any(not a.gave_up or a.prior_gaveups == 0 for a in actions)


def format_telegram_summary(actions: list[HealAction], post_status: dict[str, str]) -> str:
    if not actions:
        return ""
    lines = [f"*Self-Healer — {datetime.now(timezone.utc).strftime('%H:%M UTC')}*"]
    for a in actions:
        emoji = "✅" if a.succeeded and post_status.get(a.service) == hb.STATUS_HEALTHY else "❌"
        lines.append(f"{emoji} `{a.service}` ({a.hint or 'unknown'})")
        lines.append(f"   action: {a.action}")
        if a.details:
            lines.append(f"   details: {a.details[:140]}")
        post = post_status.get(a.service, "unverified")
        lines.append(f"   recheck: {post}")
        if a.escalated or post != hb.STATUS_HEALTHY:
            lines.append("   ⚠️ *escalating — manual fix needed*")
    return "\n".join(lines)


# ── Entry point ──────────────────────────────────────────────────────────────


def load_input(args: argparse.Namespace) -> dict[str, Any]:
    """Get the heartbeat report we'll act on. Three sources, in priority order:
    1. --stdin   (heartbeat piped in)
    2. --service (one-shot, pretend that one service is down)
    3. fresh probe (run heartbeat ourselves)"""
    if args.stdin:
        return json.loads(sys.stdin.read())
    if args.service:
        return {
            "down": [
                {
                    "service": args.service,
                    "category": "service",
                    "extra": {"remediation_hint": "container_exited"},
                }
            ]
        }
    # Run a fresh probe.
    checks = hb.run_all_checks()
    score = hb.health_score(checks)
    # Persist this probe so we have a fresh baseline before we touch anything.
    hb.persist(checks, score, dry_run=False)
    from dataclasses import asdict

    down = [asdict(c) for c in checks if c.status == hb.STATUS_DOWN]
    return {"down": down, "score": score}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Self-Healer — fix DOWN services")
    parser.add_argument("--dry-run", action="store_true", help="Print actions, don't execute")
    parser.add_argument(
        "--stdin", action="store_true", help="Read heartbeat JSON from stdin instead of probing"
    )
    parser.add_argument("--service", default=None, help="One-shot: heal a specific service")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if args.quiet:
        logger.setLevel(logging.WARNING)

    if os.geteuid() == 0 and not os.environ.get("MIRA_HEALER_ALLOW_ROOT"):
        logger.error("refusing to run as root — set MIRA_HEALER_ALLOW_ROOT=1 to override")
        return 3

    # Stand down during a deploy: the deploy is (re)creating the core stack, so
    # "container missing" is expected. Acting now would race the deploy's own
    # recreate and fire false escalations — the 2026-07-08 incident.
    if not args.dry_run and hb.deploy_in_progress():
        logger.info("deploy in progress — standing down (not touching containers)")
        return 0

    report = load_input(args)
    down = report.get("down", [])
    if not down:
        logger.info("nothing down — exiting")
        return 0

    actions = [heal_one(c, dry_run=args.dry_run) for c in down]
    log_actions(actions, dry_run=args.dry_run)

    post_status = {} if args.dry_run else reverify(down)
    summary = format_telegram_summary(actions, post_status)

    if args.dry_run:
        print(summary)
        return 0

    # Escalation dedup: don't re-alert every run for a service we've already
    # given up on. Notify when there's new information — any non-give-up action,
    # or the FIRST give-up for a service (no give-up logged yet in the window).
    should_notify = _should_notify(actions)
    if summary and should_notify:
        notify("system", summary)
    elif summary:
        logger.info(
            "suppressing repeat escalation (already alerted): %s",
            [a.service for a in actions if a.gave_up],
        )

    failed = [
        a
        for a in actions
        if not a.succeeded
        or (post_status.get(a.service) and post_status[a.service] != hb.STATUS_HEALTHY)
    ]
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
