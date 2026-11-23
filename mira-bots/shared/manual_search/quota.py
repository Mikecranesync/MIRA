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
import threading
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone

logger = logging.getLogger("mira.manual_search")

_DEFAULT_USER_DAILY_CAP = 10
_DEFAULT_TENANT_DAILY_CAP = 50

# The single system-wide counter's scope_key (migration 103 header).
GLOBAL_SCOPE_KEY = "*"

# Denial reasons reserve_provider_query() may return, in priority order
# (user -> tenant -> global) when more than one cap is simultaneously at
# capacity. "ok" (not listed) means the reservation succeeded.
DENIAL_REASONS = (
    "user_cap",
    "tenant_cap",
    "global_cap",
    "global_cap_unconfigured",
    "quota_unavailable",
)


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


def global_monthly_cap() -> int | None:
    """The system-wide monthly ceiling, or None when unconfigured.

    Owner decision (D4, 2026-09-30): the per-user (10/day) and per-tenant
    (50/day) caps are accepted, but the global monthly $ ceiling is NOT yet
    decided. Unlike the other two caps, this one has NO fallback default —
    unset, blank, invalid, or <=0 all mean "unconfigured", and
    reserve_provider_query() fails closed on that (reason
    "global_cap_unconfigured") rather than ever inventing a number. Set this
    only once the owner has decided the monthly ceiling.
    """
    raw = os.environ.get("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "").strip()
    if not raw:
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    return n if n > 0 else None


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


def _locked_rows(identity: QuotaIdentity, now: datetime) -> list[tuple[str, str, date]]:
    """(scope, scope_key, window_start) for the three counters EVERY reservation
    touches, in the fixed lock order. A release takes exactly these rows, from the
    reservation's own ``now``. Never log scope_key in clear text (it may embed a
    user id); only the reason/scope are logged.

    Fixed lock order (scope, scope_key, window_start) — every reservation
    (any tenant, any user) takes these three locks in the SAME order, so two
    concurrent reservations can never deadlock waiting on each other's locks
    in reverse order. The spec's single IN-list UPDATE does not guarantee
    this ordering (the planner may walk a multi-value index scan in a
    different order per execution); three ordered single-row UPDATEs inside
    one transaction give the same atomicity with a provable lock order."""
    today, month_start = _windows(now)
    return sorted(
        [
            ("user_day", identity.user_key, today),
            ("tenant_day", identity.tenant_id, today),
            ("global_month", GLOBAL_SCOPE_KEY, month_start),
        ]
    )


# What _reserve_sync returns once its awaiting task was cancelled. No caller ever
# sees it: the task that would have received it is gone.
_ABANDONED = "abandoned"
_RELEASE_THREAD_NAME = "manual-search-quota-release"


class _Handoff:
    """Decides, once, who owns a reservation's charge when its awaiting task is
    cancelled (#5847). asyncio cannot stop the worker thread, so without this a
    cancelled reservation could still commit and charge all three counters for a
    provider query that is never sent.

    The worker and the awaiter each flip state under a lock that is never held
    across I/O, so exactly one of them acts on a cancel:
      - before the commit, the worker rolls back;
      - during the commit, the worker releases what it committed;
      - after the worker delivered "ok" but before the awaiter resumed, the
        awaiter starts a release thread.
    A reservation that ends in a denial or an error commits nothing, so nothing
    is released."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._abandoned = False
        self._delivered = False

    def may_commit(self) -> bool:
        """Worker, just before the commit: False once the awaiter is gone."""
        with self._lock:
            return not self._abandoned

    def deliver(self) -> bool:
        """Worker, just after the commit. True hands the charge to the awaiter, which
        sends the query or, if it is cancelled before it resumes, releases it. False
        means the awaiter was cancelled during the commit: the worker releases."""
        with self._lock:
            self._delivered = not self._abandoned
            return self._delivered

    def abandon(self) -> bool:
        """Awaiter, on cancellation. True when the worker already delivered a
        committed reservation, which the awaiter must now release."""
        with self._lock:
            self._abandoned = True
            return self._delivered


def _release_sync(identity: QuotaIdentity, now: datetime) -> None:
    """Give back one committed reservation whose query was never sent (#5847).

    The same three rows as the reservation (its own ``now``, so a UTC rollover
    since then cannot move the release to another window), in the same lock
    order, in one transaction, never below zero. Never raises: a failed release
    leaves the charge, which over-counts rather than under-counts (fail closed)."""
    conn = None
    try:
        import psycopg2

        conn = psycopg2.connect(os.environ.get("NEON_DATABASE_URL", "").strip(), connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '5s'")
            for scope, key, window in _locked_rows(identity, now):
                cur.execute(
                    """
                    UPDATE manual_search_quota
                       SET used = used - 1, updated_at = now()
                     WHERE scope = %s AND scope_key = %s AND window_start = %s
                       AND used > 0
                    """,
                    (scope, key, window),
                )
        conn.commit()
        logger.info("MANUAL_SEARCH_QUOTA_RELEASED")
    except Exception:
        logger.error("MANUAL_SEARCH_QUOTA_RELEASE_FAILED", exc_info=True)
        try:
            if conn is not None:
                conn.rollback()
        except Exception:  # noqa: BLE001 - best-effort cleanup only
            pass
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:  # noqa: BLE001 - best-effort cleanup only
            pass


def _reserve_sync(identity: QuotaIdentity, now: datetime, handoff: _Handoff | None = None) -> str:
    """The synchronous (blocking) Postgres round trip. Never raises — any
    import/connection/SQL error maps to "quota_unavailable" (fail closed).
    ``handoff`` is the cancellation protocol with the awaiting task (#5847)."""
    # Checked FIRST, before any I/O: an unconfigured global cap means there is
    # no number to reserve against, so no query is sent and no database
    # connection is even attempted (owner decision D4 pending — see
    # global_monthly_cap()'s docstring).
    global_cap = global_monthly_cap()
    if global_cap is None:
        logger.warning("MANUAL_SEARCH_QUOTA_GLOBAL_CAP_UNCONFIGURED")
        return "global_cap_unconfigured"

    db_url = os.environ.get("NEON_DATABASE_URL", "").strip()
    if not db_url:
        logger.warning("MANUAL_SEARCH_QUOTA_UNAVAILABLE reason=no_database_url")
        return "quota_unavailable"

    try:
        import psycopg2
    except ImportError:
        logger.error("MANUAL_SEARCH_QUOTA_UNAVAILABLE reason=psycopg2_missing")
        return "quota_unavailable"

    # (scope, scope_key, window_start, cap), in the fixed lock order (_locked_rows).
    caps = {
        "user_day": user_daily_cap(),
        "tenant_day": tenant_daily_cap(),
        "global_month": global_cap,
    }
    ordered = [
        (scope, key, window, caps[scope]) for scope, key, window in _locked_rows(identity, now)
    ]

    conn = None
    release = False
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
                if handoff is not None and not handoff.may_commit():
                    conn.rollback()
                    logger.info("MANUAL_SEARCH_QUOTA_ABANDONED stage=before_commit")
                    return _ABANDONED
                conn.commit()
                if handoff is None or handoff.deliver():
                    return "ok"
                release = True  # cancelled during the commit: give the charge back
            else:
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

    if release:
        logger.info("MANUAL_SEARCH_QUOTA_ABANDONED stage=commit")
        _release_sync(identity, now)
        return _ABANDONED

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
    | "global_cap_unconfigured" | "quota_unavailable". psycopg2 is
    synchronous, so the round trip runs in a thread (asyncio.to_thread) —
    same pattern as wo_evidence.py.

    If this await is cancelled (the endpoint's timeout, the retry cutoff), the
    query it reserved for is never sent, so the reservation is rolled back or
    released rather than charged (#5847, see _Handoff). Once it has returned
    "ok", the reservation belongs to the caller and is counted as sent.
    """
    moment = now or datetime.now(timezone.utc)
    handoff = _Handoff()
    try:
        return await asyncio.to_thread(_reserve_sync, identity, moment, handoff)
    except asyncio.CancelledError:
        if handoff.abandon():
            # Never touch the database on the event loop: release in a thread.
            threading.Thread(
                target=_release_sync,
                args=(identity, moment),
                name=_RELEASE_THREAD_NAME,
                daemon=True,
            ).start()
        raise
