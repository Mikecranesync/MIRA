"""Atomic Postgres caps on provider queries (Manual-First PRD R13, #4160 S4).

S1 (#4161) capped provider queries PER CALL (``provider_query_budget`` in
``search.py``, default 4). Nothing bounded how many *calls* a user, a tenant,
or the whole system could make per day/month — this module is that bound.

Every reservation is ONE Postgres transaction against three counter rows
(per-user/day, per-tenant/day, global/month) keyed on ``manual_search_quota``
(migration 103). The row-level locks the UPDATE takes serialize concurrent
reservations on the same counter, so there is no over-spend under
concurrency; a rollback releases them cleanly. Fail CLOSED: any missing
config or DB error denies the query (``"quota_unavailable"``) rather than
letting it through uncounted — a caller that cannot prove it is under budget
gets no search.

Windows are UTC, computed once per reservation from a single ``now`` so the
three rows always share the same instant (no boundary smear between the
daily and monthly window). Scoped keys are opaque identifiers only — this
module never persists a manufacturer, model, or search string.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import os
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone

logger = logging.getLogger("mira.manual_search")

_DEFAULT_USER_DAILY_CAP = 10
_DEFAULT_TENANT_DAILY_CAP = 50
_DEFAULT_GLOBAL_MONTHLY_CAP = 3000

# The single system-wide counter's scope_key (migration 103 header).
GLOBAL_SCOPE_KEY = "*"

# Denial reasons reserve_provider_query() may return, in priority order
# (user -> tenant -> global) when more than one cap is simultaneously at
# capacity. "ok" (not listed) means the reservation succeeded.
DENIAL_REASONS = ("user_cap", "tenant_cap", "global_cap", "quota_unavailable")


def _positive_int_env(name: str, default: int) -> int:
    """Mirrors search.py's max_provider_queries(): invalid/<=0 -> default."""
    try:
        n = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return n if n > 0 else default


def user_daily_cap() -> int:
    return _positive_int_env("MANUAL_SEARCH_USER_DAILY_CAP", _DEFAULT_USER_DAILY_CAP)


def tenant_daily_cap() -> int:
    return _positive_int_env("MANUAL_SEARCH_TENANT_DAILY_CAP", _DEFAULT_TENANT_DAILY_CAP)


def global_monthly_cap() -> int:
    return _positive_int_env("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", _DEFAULT_GLOBAL_MONTHLY_CAP)


@dataclass(frozen=True)
class QuotaIdentity:
    """The caller a provider query is reserved against. Both fields required
    and non-empty — a caller that cannot supply one gets no web search
    (PRD R14); see search.py's "no_identity" refusal."""

    tenant_id: str
    user_id: str

    def __post_init__(self) -> None:
        if not (self.tenant_id or "").strip():
            raise ValueError("QuotaIdentity.tenant_id must be a non-empty string")
        if not (self.user_id or "").strip():
            raise ValueError("QuotaIdentity.user_id must be a non-empty string")

    @property
    def user_key(self) -> str:
        """``tenant:user`` — a user id is not guaranteed globally unique, so
        the per-user counter is scoped to the tenant it was issued under."""
        return f"{self.tenant_id}:{self.user_id}"


_quota_identity: contextvars.ContextVar[QuotaIdentity | None] = contextvars.ContextVar(
    "manual_search_quota_identity", default=None
)


@contextmanager
def provider_query_quota(identity: QuotaIdentity) -> Generator[QuotaIdentity]:
    """Scope one search_manual() call to a (tenant, user) identity so every
    provider query it sends is reserved against the daily/monthly caps.

    Mirrors search.py's provider_query_budget() context-manager shape."""
    token = _quota_identity.set(identity)
    try:
        yield identity
    finally:
        _quota_identity.reset(token)


def current_quota_identity() -> QuotaIdentity | None:
    """The identity set by the innermost enclosing provider_query_quota(), or
    None if no caller opened one for this call."""
    return _quota_identity.get()


def _windows(now: datetime) -> tuple[date, date]:
    """(day, month-start), both UTC. One `now` for every row in a reservation
    so a reservation can never straddle a UTC rollover mid-transaction."""
    utc_now = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    today = utc_now.date()
    return today, today.replace(day=1)


def _reserve_sync(identity: QuotaIdentity, now: datetime) -> str:
    """The synchronous (blocking) Postgres round trip. Never raises — any
    import/connection/SQL error maps to "quota_unavailable" (fail closed)."""
    db_url = os.environ.get("NEON_DATABASE_URL", "").strip()
    if not db_url:
        logger.warning("MANUAL_SEARCH_QUOTA_UNAVAILABLE reason=no_database_url")
        return "quota_unavailable"

    try:
        import psycopg2
    except ImportError:
        logger.error("MANUAL_SEARCH_QUOTA_UNAVAILABLE reason=psycopg2_missing")
        return "quota_unavailable"

    today, month_start = _windows(now)
    # (scope, scope_key, window_start, cap) — the three counters EVERY
    # reservation touches. Never log scope_key in clear text beyond this
    # (it may embed a user id); only the reason/scope are logged.
    rows: list[tuple[str, str, date, int]] = [
        ("user_day", identity.user_key, today, user_daily_cap()),
        ("tenant_day", identity.tenant_id, today, tenant_daily_cap()),
        ("global_month", GLOBAL_SCOPE_KEY, month_start, global_monthly_cap()),
    ]
    # Fixed lock order (scope, scope_key, window_start) — every reservation
    # (any tenant, any user) takes these three locks in the SAME order, so two
    # concurrent reservations can never deadlock waiting on each other's locks
    # in reverse order. The spec's single IN-list UPDATE does not guarantee
    # this ordering (the planner may walk a multi-value index scan in a
    # different order per execution); three ordered single-row UPDATEs inside
    # one transaction give the same atomicity with a provable lock order.
    ordered = sorted(rows, key=lambda r: (r[0], r[1], r[2]))

    conn = None
    try:
        conn = psycopg2.connect(db_url, connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '5s'")
            for scope, key, window, _cap in ordered:
                cur.execute(
                    """
                    INSERT INTO manual_search_quota (scope, scope_key, window_start, used)
                    VALUES (%s, %s, %s, 0)
                    ON CONFLICT (scope, scope_key, window_start) DO NOTHING
                    """,
                    (scope, key, window),
                )
            updated: set[str] = set()
            for scope, key, window, cap in ordered:
                cur.execute(
                    """
                    UPDATE manual_search_quota
                       SET used = used + 1, updated_at = now()
                     WHERE scope = %s AND scope_key = %s AND window_start = %s
                       AND used < %s
                    RETURNING scope
                    """,
                    (scope, key, window, cap),
                )
                if cur.fetchone() is not None:
                    updated.add(scope)
            if len(updated) == len(ordered):
                conn.commit()
                return "ok"
            conn.rollback()
    except Exception:
        logger.error("MANUAL_SEARCH_QUOTA_UNAVAILABLE reason=query_failed", exc_info=True)
        try:
            if conn is not None:
                conn.rollback()
        except Exception:  # noqa: BLE001 - best-effort cleanup only
            pass
        return "quota_unavailable"
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:  # noqa: BLE001 - best-effort cleanup only
            pass

    # Fewer than 3 rows reserved — at least one scope was at cap. Priority:
    # user -> tenant -> global (the missing ones, in that order).
    for scope, reason in (
        ("user_day", "user_cap"),
        ("tenant_day", "tenant_cap"),
        ("global_month", "global_cap"),
    ):
        if scope not in updated:
            return reason
    return "quota_unavailable"  # unreachable (defensive: len mismatch implies a miss above)


async def reserve_provider_query(identity: QuotaIdentity, *, now: datetime | None = None) -> str:
    """Reserve ONE provider query against the user/tenant/global caps.

    Returns "ok" or a denial reason: "user_cap" | "tenant_cap" | "global_cap"
    | "quota_unavailable". psycopg2 is synchronous, so the round trip runs in
    a thread (asyncio.to_thread) — same pattern as wo_evidence.py.
    """
    moment = now or datetime.now(timezone.utc)
    return await asyncio.to_thread(_reserve_sync, identity, moment)
