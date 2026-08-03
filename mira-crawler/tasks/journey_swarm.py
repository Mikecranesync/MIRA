"""Celery task — technician-journey validation swarm on the synthetic queue.

PRD §8.2: "The executor extends the existing Celery synthetic-dogfood worker
and uses the existing dedicated synthetic queue."

This module is the Celery *entry point*; all behavior lives in
``tools/journey_swarm/executor.py`` so the CLI and the worker run byte-identical
logic. It follows the same optional-app registration idiom as
``tasks/eval_scorer.py``: the task binds to whatever Celery app is importable
and degrades to a plain callable when Celery is absent, so importing this
module never crash-loops a worker.

Operational contract
--------------------
* **Disabled by default.** ``JOURNEY_SWARM_ENABLED=1`` is required; anything
  else exits cleanly with ``skipped`` and no side effects.
* **Tenant allowlist.** ``JOURNEY_SWARM_TENANTS`` is an explicit comma-separated
  allowlist. An empty/missing list means *no tenant is eligible* — never "all",
  so a misconfiguration cannot cause a global run.
* **Environment bound to target.** The executor re-validates that the target
  host is allowlisted for the requested environment and refuses production
  hostnames outright, so a scheduled run cannot reach production.
* **Overlap protection.** A Redis lock keyed by (scenario, environment, tenant)
  blocks a second concurrent run of the same scope; the lock auto-expires so a
  killed worker cannot wedge the schedule permanently.
* **Idempotency.** The lock plus the executor's own per-run ``run_id`` mean a
  duplicate schedule delivery is a no-op rather than a second set of receipts.
* **Bounded retries.** Transient failures retry with exponential backoff +
  jitter; permanent failures (refused environment, disabled flag, ineligible
  tenant) never retry and are reported distinctly.
* **Time limits.** A soft limit raises inside the task for a graceful exit; the
  hard limit kills it. Both sit below the beat interval so runs cannot pile up.

Read-only: the executor performs authenticated reads and the approved
question/answer path only. No writes, no work orders, no control.
"""

from __future__ import annotations

import logging
import os
import random
import socket
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Task execution limits. Kept well below the beat interval (see celeryconfig)
# so a slow run can never overlap the next tick.
SOFT_TIME_LIMIT = int(os.getenv("JOURNEY_SWARM_SOFT_LIMIT_S", "1500"))  # 25 min
HARD_TIME_LIMIT = int(os.getenv("JOURNEY_SWARM_HARD_LIMIT_S", "1800"))  # 30 min
MAX_RETRIES = int(os.getenv("JOURNEY_SWARM_MAX_RETRIES", "3"))
LOCK_TTL_S = HARD_TIME_LIMIT + 300  # outlive the hard limit, then self-heal

try:  # pragma: no cover - depends on deployment layout
    from mira_crawler.celery_app import app  # type: ignore[import]
except Exception:  # noqa: BLE001
    try:
        from celery_app import app  # type: ignore[import]
    except Exception:  # noqa: BLE001
        app = None  # Celery not available — module still imports cleanly.


class PermanentSwarmError(RuntimeError):
    """A failure that must NOT be retried (config, policy, or refusal)."""


class TransientSwarmError(RuntimeError):
    """A failure that may succeed on retry (network, broker, DB)."""


# ── configuration ────────────────────────────────────────────────────────────


def eligible_tenants() -> list[str]:
    """Tenants allowed to run scheduled swarms. Empty means NONE (fail closed).

    A missing or blank ``JOURNEY_SWARM_TENANTS`` must never be read as "every
    tenant" — that is the accidental-global-execution failure the PRD calls out.
    """
    raw = os.getenv("JOURNEY_SWARM_TENANTS", "")
    return [t.strip() for t in raw.split(",") if t.strip()]


def is_enabled() -> bool:
    return os.getenv("JOURNEY_SWARM_ENABLED", "0") == "1"


def _swarm_flags_ok() -> tuple[bool, str]:
    """The spine flags the scenario depends on must be on for a live overlay."""
    missing = [
        name
        for name in ("MIRA_CONTEXT_CONTRACT", "MIRA_FACTORYLM_LIVE")
        if os.getenv(name, "0") != "1"
    ]
    if missing:
        return False, f"spine flags off: {', '.join(missing)}"
    return True, "spine flags on"


# ── overlap lock ─────────────────────────────────────────────────────────────


@contextmanager
def scope_lock(scope: str):
    """Block a concurrent run of the same (scenario, environment, tenant).

    Redis SET NX EX — the same broker the worker already depends on, so no new
    infrastructure. Yields True when the lock was acquired, False when another
    run holds it. Falls back to yielding True (with a warning) when Redis is
    unreachable: refusing to run because a lock service is down would convert a
    monitoring dependency into an availability dependency, and the executor's
    own per-run ``run_id`` keeps a rare double-run distinguishable.
    """
    url = os.getenv("CELERY_BROKER_URL", "")
    client = None
    token = f"{socket.gethostname()}:{os.getpid()}:{time.time()}"
    key = f"journey_swarm:lock:{scope}"
    acquired = False
    try:
        import redis  # type: ignore[import]

        client = redis.Redis.from_url(url)
        acquired = bool(client.set(key, token, nx=True, ex=LOCK_TTL_S))
    except Exception as exc:  # noqa: BLE001
        logger.warning("JOURNEY_SWARM lock unavailable (%s) — proceeding unlocked", exc)
        yield True
        return
    try:
        yield acquired
    finally:
        if acquired and client is not None:
            try:  # release only our own token
                if client.get(key) == token.encode():
                    client.delete(key)
            except Exception as exc:  # noqa: BLE001
                logger.warning("JOURNEY_SWARM lock release failed: %s", exc)


# ── executor loading ─────────────────────────────────────────────────────────


def _load_executor():
    """Import the journey-swarm executor, or explain why it is unavailable."""
    swarm_dir = _REPO_ROOT / "tools" / "journey_swarm"
    if not swarm_dir.is_dir():
        raise PermanentSwarmError(
            f"journey-swarm executor not present at {swarm_dir} — this worker "
            "image does not ship tools/journey_swarm"
        )
    for path in (str(swarm_dir), str(_REPO_ROOT)):
        if path not in sys.path:
            sys.path.insert(0, path)
    import executor  # type: ignore[import]

    return executor


# ── startup health check ─────────────────────────────────────────────────────


def health_check() -> dict[str, Any]:
    """Verify everything the task needs, loudly, without running a journey.

    Reports each dependency independently so a failure names the missing piece
    instead of surfacing as an opaque task error later.
    """
    result: dict[str, Any] = {"ok": True, "checks": {}}

    def record(name: str, ok: bool, detail: str) -> None:
        result["checks"][name] = {"ok": ok, "detail": detail}
        if not ok:
            result["ok"] = False

    try:
        import redis  # type: ignore[import]

        redis.Redis.from_url(os.getenv("CELERY_BROKER_URL", "")).ping()
        record("broker", True, "reachable")
    except Exception as exc:  # noqa: BLE001
        record("broker", False, f"unreachable: {exc}")

    if app is not None:
        registered = "tasks.journey_swarm.run_journey_swarm" in app.tasks
        record("task_registered", registered, "present" if registered else "NOT registered")
    else:
        record("task_registered", False, "no Celery app importable")

    try:
        _load_executor()
        record("executor", True, "importable")
    except Exception as exc:  # noqa: BLE001
        record("executor", False, str(exc))

    if os.getenv("NEON_DATABASE_URL"):
        try:
            from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

            import psycopg2  # type: ignore[import]

            parts = urlsplit(os.environ["NEON_DATABASE_URL"])
            query = [(k, v) for k, v in parse_qsl(parts.query) if k != "channel_binding"]
            conn = psycopg2.connect(urlunsplit(parts._replace(query=urlencode(query))))
            conn.close()
            record("database", True, "reachable")
        except Exception as exc:  # noqa: BLE001
            record("database", False, f"unreachable: {exc}")
    else:
        record("database", False, "NEON_DATABASE_URL not set")

    tenants = eligible_tenants()
    record(
        "tenant_allowlist",
        bool(tenants),
        f"{len(tenants)} tenant(s)" if tenants else "EMPTY — no tenant is eligible",
    )
    flags_ok, flags_detail = _swarm_flags_ok()
    record("spine_flags", flags_ok, flags_detail)
    record("enabled", is_enabled(), "on" if is_enabled() else "JOURNEY_SWARM_ENABLED != 1")

    target = os.getenv("SWARM_PIPELINE_URL", "")
    record("target_url", bool(target), target or "SWARM_PIPELINE_URL not set")
    return result


# ── the run ──────────────────────────────────────────────────────────────────


def run_journey_swarm(
    scenario: str = "tech-journey-core",
    environment: str = "staging",
    base_url: str | None = None,
    baseline_only: bool = False,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """Run one journey-swarm scenario. Returns a JSON-safe summary dict.

    Every non-retryable outcome is a structured result so a scheduled run is
    observable rather than a worker traceback. ``TransientSwarmError`` is
    raised only where a retry is genuinely appropriate.
    """
    started = time.time()
    tenant = tenant_id or os.getenv("MIRA_TENANT_ID", "")
    base: dict[str, Any] = {
        "scenario": scenario,
        "environment": environment,
        "tenant_id": tenant,
        "host": socket.gethostname(),
    }

    if not is_enabled():
        logger.info("JOURNEY_SWARM skipped: disabled")
        return {**base, "ok": True, "skipped": True, "reason": "JOURNEY_SWARM_ENABLED is not 1"}

    allow = eligible_tenants()
    if not allow:
        logger.warning("JOURNEY_SWARM skipped: tenant allowlist EMPTY (fail-closed)")
        return {**base, "ok": True, "skipped": True, "reason": "tenant allowlist empty"}
    if not tenant:
        return {**base, "ok": True, "skipped": True, "reason": "no tenant resolved"}
    if tenant not in allow:
        logger.info("JOURNEY_SWARM skipped: tenant not in allowlist")
        return {**base, "ok": True, "skipped": True, "reason": "tenant not eligible"}

    flags_ok, flags_detail = _swarm_flags_ok()
    if not flags_ok:
        logger.info("JOURNEY_SWARM skipped: %s", flags_detail)
        return {**base, "ok": True, "skipped": True, "reason": flags_detail}

    target = base_url or os.getenv("SWARM_PIPELINE_URL", "")
    if not target:
        return {**base, "ok": False, "verdict": "INFRA", "reason": "SWARM_PIPELINE_URL not set"}

    try:
        executor = _load_executor()
    except PermanentSwarmError as exc:
        logger.error("JOURNEY_SWARM unavailable: %s", exc)
        return {**base, "ok": False, "verdict": "INFRA", "reason": str(exc), "permanent": True}

    try:
        executor.assert_target_matches_environment(environment, target)
    except Exception as exc:  # noqa: BLE001 — a refusal is permanent, never retried
        logger.error("JOURNEY_SWARM refused: %s", exc)
        return {**base, "ok": False, "verdict": "REFUSED", "reason": str(exc), "permanent": True}

    scope = f"{scenario}:{environment}:{tenant}"
    with scope_lock(scope) as acquired:
        if not acquired:
            logger.info("JOURNEY_SWARM overlap-blocked for %s", scope)
            return {**base, "ok": True, "skipped": True, "reason": "overlap: run already active"}

        argv = ["--scenario", scenario, "--environment", environment, "--base-url", target]
        if baseline_only:
            argv.append("--baseline-only")
        old_argv = sys.argv
        try:
            sys.argv = ["journey-swarm", *argv]
            code = executor.main()
        except Exception as exc:  # noqa: BLE001
            logger.exception("JOURNEY_SWARM run failed")
            raise TransientSwarmError(str(exc)) from exc
        finally:
            sys.argv = old_argv

    duration = round(time.time() - started, 1)
    verdict = "GREEN" if code == 0 else "NOT_GREEN"
    logger.info(
        "JOURNEY_SWARM_RESULT scenario=%s env=%s tenant=%s verdict=%s exit=%s duration_s=%s",
        scenario,
        environment,
        tenant,
        verdict,
        code,
        duration,
    )
    return {**base, "ok": code == 0, "exit_code": code, "verdict": verdict, "duration_s": duration}


if app is not None:  # pragma: no cover - registration depends on the worker

    @app.task(
        name="tasks.journey_swarm.run_journey_swarm",
        bind=True,
        max_retries=MAX_RETRIES,
        soft_time_limit=SOFT_TIME_LIMIT,
        time_limit=HARD_TIME_LIMIT,
        acks_late=True,
    )
    def run_journey_swarm_task(  # type: ignore[no-untyped-def]
        self,
        scenario: str = "tech-journey-core",
        environment: str = "staging",
        base_url: str | None = None,
        baseline_only: bool = False,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        try:
            return run_journey_swarm(
                scenario=scenario,
                environment=environment,
                base_url=base_url,
                baseline_only=baseline_only,
                tenant_id=tenant_id,
            )
        except TransientSwarmError as exc:
            # Exponential backoff with jitter — a flapping target must not be
            # hammered, and simultaneous workers must not retry in lockstep.
            delay = min(300, 2**self.request.retries * 30)
            delay += random.uniform(0, delay * 0.25)
            logger.warning(
                "JOURNEY_SWARM transient failure (attempt %s/%s), retrying in %.0fs: %s",
                self.request.retries + 1,
                MAX_RETRIES,
                delay,
                exc,
            )
            raise self.retry(exc=exc, countdown=delay) from exc

    @app.task(name="tasks.journey_swarm.health_check")
    def health_check_task() -> dict[str, Any]:  # type: ignore[no-untyped-def]
        return health_check()
