"""Live-Postgres integration test — shared/manual_search/quota.py (#4160 S4,
PRD R13).

Proves against a REAL Postgres what the fake-double unit tests
(test_manual_search_quota.py) structurally cannot: the exact cap-boundary
predicate (``used < cap``, not ``<=``), real row locks under genuine
concurrency, and real UTC calendar-window rollover. Applies migration 103
itself (idempotent ``CREATE TABLE IF NOT EXISTS``) to whatever database
``TEST_DATABASE_URL`` points at, then truncates the table before every test.

Gated on BOTH, same convention as the Hub integration suites
(``mira-hub/src/lib/__tests__/*.integration.test.ts``):
    TEST_DATABASE_URL          a disposable Postgres connection string
    MIRA_TEST_DB_CONFIRM=DISPOSABLE

Run locally against a throwaway container (never a shared/staging/prod DB).
MUST run SERIAL, not under pytest-xdist (-n auto): the autouse schema fixture
TRUNCATEs the one shared table before every test, so parallel workers racing
TRUNCATE against each other's in-flight reservations would corrupt one
another's counts. Pass -p no:xdist explicitly if your pytest.ini (or a CI
wrapper) ever defaults -n auto on:

    docker run -d --rm --name mira-quota-pg-test -p 55434:5432 \\
        -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test postgres:16
    cd mira-bots && \\
    TEST_DATABASE_URL=postgresql://postgres:testpw@localhost:55434/mira_test \\
    MIRA_TEST_DB_CONFIRM=DISPOSABLE \\
    PATH=/opt/homebrew/bin:$PATH python3 -m pytest tests/test_manual_search_quota_pg.py -v -p no:xdist
    docker stop mira-quota-pg-test
"""

from __future__ import annotations

import concurrent.futures
import os
import pathlib
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import shared.manual_search.quota as quota_mod  # noqa: E402

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or os.getenv("MIRA_TEST_DB_CONFIRM") != "DISPOSABLE",
    reason=(
        "needs TEST_DATABASE_URL (a disposable Postgres connection string) "
        "+ MIRA_TEST_DB_CONFIRM=DISPOSABLE — see this file's docstring for a "
        "throwaway `docker run postgres:16` recipe"
    ),
)

# NOTE: `pytestmark = pytest.mark.skipif(...)` above only skips the TEST
# FUNCTIONS at run time — it does not gate module-level code, so this import
# still executes unconditionally at collection. Use importorskip (not a plain
# import) so a missing driver degrades to a clean SKIP rather than a
# collection ERROR — psycopg2 is a direct dependency of quota.py itself, so
# in practice it is always present wherever this test is importable at all,
# but importorskip costs nothing and is the honest statement of what actually
# gates this import.
psycopg2 = pytest.importorskip("psycopg2")

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "mira-hub"
    / "db"
    / "migrations"
    / "103_manual_search_quota.sql"
)

NOW = datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)


def _admin_conn():
    conn = psycopg2.connect(TEST_DATABASE_URL)
    conn.autocommit = True  # the migration file carries its own BEGIN/COMMIT
    return conn


@pytest.fixture(autouse=True)
def _schema_and_env(monkeypatch):
    """Apply migration 103 (idempotent), truncate so tests don't see each
    other's rows, and point quota.py at this disposable database."""
    conn = _admin_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_MIGRATION.read_text())
            cur.execute("TRUNCATE TABLE manual_search_quota")
    finally:
        conn.close()
    monkeypatch.setenv("NEON_DATABASE_URL", TEST_DATABASE_URL)
    yield


def _used(scope: str, scope_key: str, window_start) -> int | None:
    conn = psycopg2.connect(TEST_DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT used FROM manual_search_quota WHERE scope = %s AND scope_key = %s AND window_start = %s",
                (scope, scope_key, window_start),
            )
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Exact cap boundary — the one thing the fake-double unit tests cannot prove
# (a mutation of `used < cap` to `used <= cap` passed every fake-double test;
# only the real SQL predicate can catch it).
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Unconfigured global cap (owner decision D4, 2026-09-30) — fail closed, and
# against a REAL database: confirm the table stays untouched (no row created,
# no UPDATE attempted) when the reservation never reaches SQL.
# ---------------------------------------------------------------------------


async def test_unconfigured_global_cap_denies_and_writes_nothing(monkeypatch):
    monkeypatch.delenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raising=False)
    identity = quota_mod.QuotaIdentity(tenant_id="t-unconfigured", user_id="u-unconfigured")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "global_cap_unconfigured"
    assert _used("user_day", identity.user_key, NOW.date()) is None
    assert _used("tenant_day", "t-unconfigured", NOW.date()) is None
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1)) is None


async def test_control_configuring_the_global_cap_restores_the_normal_path(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identity = quota_mod.QuotaIdentity(tenant_id="t-reconfigured", user_id="u-reconfigured")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "ok"
    assert _used("user_day", identity.user_key, NOW.date()) == 1


async def test_cap_exactly_reached_then_denied_per_scope(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "3")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "100")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identity = quota_mod.QuotaIdentity(tenant_id="t-exact", user_id="u-exact")

    results = [await quota_mod.reserve_provider_query(identity, now=NOW) for _ in range(4)]
    assert results == ["ok", "ok", "ok", "user_cap"]
    assert _used("user_day", identity.user_key, NOW.date()) == 3  # never 4


async def test_tenant_cap_exactly_reached_then_denied(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "2")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    # Two different users under the SAME tenant share the tenant_day counter.
    a = quota_mod.QuotaIdentity(tenant_id="t-shared", user_id="u-a")
    b = quota_mod.QuotaIdentity(tenant_id="t-shared", user_id="u-b")
    assert await quota_mod.reserve_provider_query(a, now=NOW) == "ok"
    assert await quota_mod.reserve_provider_query(b, now=NOW) == "ok"
    assert await quota_mod.reserve_provider_query(a, now=NOW) == "tenant_cap"
    assert _used("tenant_day", "t-shared", NOW.date()) == 2


async def test_global_cap_exactly_reached_then_denied(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "2")
    a = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    b = quota_mod.QuotaIdentity(tenant_id="t2", user_id="u2")
    assert await quota_mod.reserve_provider_query(a, now=NOW) == "ok"
    assert await quota_mod.reserve_provider_query(b, now=NOW) == "ok"
    assert await quota_mod.reserve_provider_query(a, now=NOW) == "global_cap"
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1)) == 2


# ---------------------------------------------------------------------------
# Rollback — a scope at capacity must leave the OTHER two counters untouched
# ---------------------------------------------------------------------------


async def test_rollback_leaves_no_partial_increment_when_one_scope_is_capped(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "100")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identity = quota_mod.QuotaIdentity(tenant_id="t-partial", user_id="u-partial")

    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "ok"
    assert _used("tenant_day", "t-partial", NOW.date()) == 1
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1)) == 1

    # Second call: user_day is now at cap (1) -> denied -> the WHOLE
    # transaction rolls back, so tenant_day/global_month must NOT have moved
    # to 2 even though their own caps were not reached.
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "user_cap"
    assert _used("user_day", identity.user_key, NOW.date()) == 1
    assert _used("tenant_day", "t-partial", NOW.date()) == 1
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1)) == 1


# ---------------------------------------------------------------------------
# UTC window rollover
# ---------------------------------------------------------------------------


async def test_utc_window_rollover_starts_a_new_row(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identity = quota_mod.QuotaIdentity(tenant_id="t-rollover", user_id="u-rollover")
    day1 = datetime(2026, 9, 30, 23, 59, 0, tzinfo=timezone.utc)
    day2 = datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc)

    assert await quota_mod.reserve_provider_query(identity, now=day1) == "ok"
    assert await quota_mod.reserve_provider_query(identity, now=day1) == "user_cap"
    # A new UTC day -> a fresh row -> not at cap, even one minute later.
    assert await quota_mod.reserve_provider_query(identity, now=day2) == "ok"
    assert _used("user_day", identity.user_key, day1.date()) == 1  # untouched
    assert _used("user_day", identity.user_key, day2.date()) == 1


async def test_utc_month_rollover_starts_a_new_global_row(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1")
    identity = quota_mod.QuotaIdentity(tenant_id="t-month", user_id="u-month")
    end_of_month = datetime(2026, 9, 30, 23, 59, 0, tzinfo=timezone.utc)
    next_month = datetime(2026, 10, 1, 0, 1, 0, tzinfo=timezone.utc)

    assert await quota_mod.reserve_provider_query(identity, now=end_of_month) == "ok"
    assert await quota_mod.reserve_provider_query(identity, now=end_of_month) == "global_cap"
    assert await quota_mod.reserve_provider_query(identity, now=next_month) == "ok"
    assert (
        _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, end_of_month.date().replace(day=1)) == 1
    )
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, next_month.date().replace(day=1)) == 1


# ---------------------------------------------------------------------------
# Concurrency — real row locks under genuine parallel load
# ---------------------------------------------------------------------------


def test_concurrent_reservations_never_oversell_the_cap(monkeypatch):
    """30 threads race one user cap of 10. Each thread calls the synchronous
    _reserve_sync directly (its own psycopg2 connection, same as production)
    so this is genuine OS-thread concurrency, not asyncio cooperative
    scheduling. Exactly 10 must succeed, the other 20 denied, and the
    persisted counter must read exactly 10 — proving the row lock serializes
    concurrent reservations with no over-spend and no lost update."""
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "10")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identity = quota_mod.QuotaIdentity(tenant_id="t-concurrency", user_id="u-concurrency")

    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as pool:
        futures = [pool.submit(quota_mod._reserve_sync, identity, NOW) for _ in range(30)]
        results = [f.result() for f in futures]

    assert results.count("ok") == 10
    assert results.count("user_cap") == 20
    assert _used("user_day", identity.user_key, NOW.date()) == 10


def test_concurrent_reservations_across_users_in_one_tenant_do_not_deadlock(monkeypatch):
    """A lock-order deadlock (advisor review) would show up as spurious
    quota_unavailable results here — 10 different users in ONE tenant, all
    racing the shared tenant_day + global_month counters at the same time."""
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "1000")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1000")
    identities = [
        quota_mod.QuotaIdentity(tenant_id="t-fanout", user_id=f"u-{i}") for i in range(10)
    ]

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(quota_mod._reserve_sync, ident, NOW) for ident in identities]
        results = [f.result() for f in futures]

    assert results == ["ok"] * 10, f"expected 10 clean reservations, got {results}"
    assert _used("tenant_day", "t-fanout", NOW.date()) == 10
    assert _used("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1)) == 10
