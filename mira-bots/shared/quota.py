"""Plan/quota gate — the ONE enforcement point at the Supervisor entry.

Audit issue #1: plan/quota was enforced only on the web path; Telegram, Slack,
and Ignition adapters had none. This module is called by
``Supervisor.process()`` BEFORE any inference, so every adapter inherits the
same check.

Design constraints (mirror decision_trace.py — the established precedent for
NeonDB access from mira-bots/shared):

- **Flag-gated.** ``ENFORCE_PLAN_QUOTA`` (default OFF) — when off,
  ``check_quota`` returns ``(True, "")`` without touching the DB, so merging
  is a no-op for every environment until the flag is flipped.
- **Fail-OPEN. ALWAYS.** Missing tenant_id, unset NEON_DATABASE_URL, DB error,
  timeout, unknown tenant, unconfigured tier — all allow the turn and log a
  warning. A quota check must never take MIRA down.
- **Event loop never blocked.** The tier query runs in a worker thread via
  run_in_executor with a hard timeout.
- **Lazy imports.** sqlalchemy is imported inside the worker so bot containers
  without it still boot (same precedent as decision_trace).

The tier query re-implements mira-core/mira-ingest/db/neon.py::check_tier_limit
using this package's own DB-access pattern (no cross-module import from
mira-core): tenants.tier → tier_limits.daily_requests → today's
knowledge_entries count for the tenant.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("mira-gsd.quota")

_TIMEOUT_SECONDS = 3

#: Technician-facing message returned by the engine when a tenant is blocked.
QUOTA_BLOCK_MESSAGE = (
    "You've hit your plan's monthly limit — upgrade at factorylm.com/pricing or contact your admin."
)

_TRUTHY = {"1", "true", "yes", "on"}


def quota_enforcement_enabled() -> bool:
    """True when ENFORCE_PLAN_QUOTA is set to a truthy value (default OFF)."""
    return os.getenv("ENFORCE_PLAN_QUOTA", "0").strip().lower() in _TRUTHY


async def check_quota(tenant_id: str | None) -> tuple[bool, str]:
    """Check whether ``tenant_id`` is within its plan's request limit.

    Returns ``(allowed, reason)``. Fail-open: every error path returns
    ``(True, "")``. When ENFORCE_PLAN_QUOTA is off (the default) this returns
    immediately with no DB call.
    """
    if not quota_enforcement_enabled():
        return (True, "")
    if not tenant_id:
        logger.warning("quota check skipped: no tenant_id (fail-open)")
        return (True, "")
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        logger.warning("quota check skipped: NEON_DATABASE_URL not set (fail-open)")
        return (True, "")

    import asyncio

    try:
        loop = asyncio.get_running_loop()
        return await asyncio.wait_for(
            loop.run_in_executor(None, _check_quota_sync, url, tenant_id),
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — fail-open by contract
        logger.warning("quota check failed (fail-open): %s", exc)
        return (True, "")


def _check_quota_sync(url: str, tenant_id: str) -> tuple[bool, str]:
    """Blocking tier-limit query. Runs in a worker thread.

    Any exception raised here is caught by check_quota() and treated as
    fail-open.
    """
    from sqlalchemy import create_engine
    from sqlalchemy import text as sql_text
    from sqlalchemy.pool import NullPool

    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    try:
        with engine.connect() as conn:
            tenant = (
                conn.execute(
                    sql_text("SELECT tier FROM tenants WHERE id = :id"),
                    {"id": tenant_id},
                )
                .mappings()
                .fetchone()
            )
            if not tenant:
                return (True, "")  # unknown tenant — allow (matches check_tier_limit)

            tier = tenant.get("tier") or "free"
            limits = (
                conn.execute(
                    sql_text("SELECT daily_requests FROM tier_limits WHERE tier = :tier"),
                    {"tier": tier},
                )
                .mappings()
                .fetchone()
            )
            if not limits:
                return (True, "")  # no limits configured for this tier
            daily_limit = limits.get("daily_requests")
            if not daily_limit:
                return (True, "")

            today_count = (
                conn.execute(
                    sql_text(
                        """
                        SELECT COUNT(*) FROM knowledge_entries
                        WHERE tenant_id = :tid
                          AND created_at >= CURRENT_DATE
                        """
                    ),
                    {"tid": tenant_id},
                ).scalar()
                or 0
            )
            if today_count >= daily_limit:
                return (
                    False,
                    f"Daily limit of {daily_limit} requests reached for tier '{tier}'",
                )
            return (True, "")
    finally:
        engine.dispose()
