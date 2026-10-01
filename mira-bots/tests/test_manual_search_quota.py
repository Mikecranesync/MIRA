"""Unit tests — shared/manual_search/quota.py (#4160 S4, PRD R13).

Hermetic: no real Postgres. A fake psycopg2 module (an in-memory counter
store behind the same connect()/cursor()/execute()/fetchone() surface the
real driver exposes) proves the reservation's SQL-sequencing logic — lock
order, partial-update rollback, denial-priority — without a live DB. The
end-to-end proof against REAL Postgres (concurrency, actual row locks, UTC
rollover) is tests/test_manual_search_quota_pg.py.

Run: cd mira-bots && python -m pytest tests/test_manual_search_quota.py -q
"""

from __future__ import annotations

import pathlib
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import shared.manual_search.quota as quota_mod  # noqa: E402


# ---------------------------------------------------------------------------
# Env-var caps — mirror search.py's max_provider_queries() contract
# ---------------------------------------------------------------------------


def test_default_caps(monkeypatch):
    monkeypatch.delenv("MANUAL_SEARCH_USER_DAILY_CAP", raising=False)
    monkeypatch.delenv("MANUAL_SEARCH_TENANT_DAILY_CAP", raising=False)
    monkeypatch.delenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raising=False)
    assert quota_mod.user_daily_cap() == 10
    assert quota_mod.tenant_daily_cap() == 50
    assert quota_mod.global_monthly_cap() == 3000


@pytest.mark.parametrize("raw", ["0", "-3", "lots", ""])
def test_invalid_or_nonpositive_caps_fall_back_to_default(monkeypatch, raw):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", raw)
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", raw)
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raw)
    assert quota_mod.user_daily_cap() == 10
    assert quota_mod.tenant_daily_cap() == 50
    assert quota_mod.global_monthly_cap() == 3000


def test_a_valid_override_is_honored(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "7")
    assert quota_mod.user_daily_cap() == 7


# ---------------------------------------------------------------------------
# QuotaIdentity
# ---------------------------------------------------------------------------


def test_identity_requires_both_fields_non_empty():
    with pytest.raises(ValueError):
        quota_mod.QuotaIdentity(tenant_id="", user_id="u1")
    with pytest.raises(ValueError):
        quota_mod.QuotaIdentity(tenant_id="t1", user_id="")
    with pytest.raises(ValueError):
        quota_mod.QuotaIdentity(tenant_id="   ", user_id="u1")


def test_identity_user_key_is_tenant_scoped():
    """A non-unique user id must never share a counter across tenants."""
    a = quota_mod.QuotaIdentity(tenant_id="tenant-a", user_id="u1")
    b = quota_mod.QuotaIdentity(tenant_id="tenant-b", user_id="u1")
    assert a.user_key == "tenant-a:u1"
    assert b.user_key == "tenant-b:u1"
    assert a.user_key != b.user_key


# ---------------------------------------------------------------------------
# provider_query_quota() contextvar scoping — mirrors provider_query_budget()
# ---------------------------------------------------------------------------


def test_no_identity_set_outside_the_context_manager():
    assert quota_mod.current_quota_identity() is None


async def test_identity_is_visible_inside_the_context_and_cleared_after():
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    with quota_mod.provider_query_quota(identity) as yielded:
        assert yielded is identity
        assert quota_mod.current_quota_identity() is identity
    assert quota_mod.current_quota_identity() is None


async def test_nested_contexts_do_not_leak_into_each_other():
    first = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    second = quota_mod.QuotaIdentity(tenant_id="t2", user_id="u2")
    with quota_mod.provider_query_quota(first):
        assert quota_mod.current_quota_identity() is first
        with quota_mod.provider_query_quota(second):
            assert quota_mod.current_quota_identity() is second
        assert quota_mod.current_quota_identity() is first
    assert quota_mod.current_quota_identity() is None


# ---------------------------------------------------------------------------
# reserve_provider_query() — fail-closed on missing config
# ---------------------------------------------------------------------------


async def test_no_database_url_denies_as_quota_unavailable_without_calling_connect(monkeypatch):
    """A spy, not a raising stub: `_reserve_sync`'s own except-Exception would
    swallow a raise from inside connect() and still return "quota_unavailable",
    which would make a raising stub pass even if the fail-closed early-return
    were deleted. Recording calls and asserting the list is empty cannot be
    fooled that way — it was proven to fail on exactly that mutation."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    calls: list[tuple] = []
    import types

    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_psycopg2.connect = lambda *a, **k: calls.append((a, k)) or _FakeConn({})
    monkeypatch.setitem(sys.modules, "psycopg2", fake_psycopg2)

    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    reason = await quota_mod.reserve_provider_query(identity)
    assert reason == "quota_unavailable"
    assert calls == [], "psycopg2.connect must not be called with no NEON_DATABASE_URL"


async def test_blank_database_url_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "   ")
    calls: list[tuple] = []
    import types

    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_psycopg2.connect = lambda *a, **k: calls.append((a, k)) or _FakeConn({})
    monkeypatch.setitem(sys.modules, "psycopg2", fake_psycopg2)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity) == "quota_unavailable"
    assert calls == [], "a blank NEON_DATABASE_URL must not reach psycopg2.connect"


async def test_a_connect_failure_denies_as_quota_unavailable(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    import types

    fake_psycopg2 = types.ModuleType("psycopg2")

    def boom(*a, **k):
        raise RuntimeError("connection refused")

    fake_psycopg2.connect = boom
    monkeypatch.setitem(sys.modules, "psycopg2", fake_psycopg2)

    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity) == "quota_unavailable"


# ---------------------------------------------------------------------------
# A fake psycopg2 double — proves the SQL-sequencing logic without a real DB
# ---------------------------------------------------------------------------


class _FakeCursor:
    """Writes land in the connection's PENDING overlay, not the committed
    store — so a rollback (a cap denial) genuinely leaves the committed store
    untouched, the same guarantee Postgres gives a real transaction."""

    def __init__(self, conn: "_FakeConn"):
        self.conn = conn
        self._last = None
        self.executed: list[str] = []

    def execute(self, sql, params=None):
        norm = " ".join(sql.split())
        self.executed.append(norm)
        if norm.startswith("SET LOCAL"):
            self._last = None
        elif norm.startswith("INSERT INTO manual_search_quota"):
            scope, key, window = params
            k = (scope, key, window)
            if k not in self.conn.store and k not in self.conn.pending:
                self.conn.pending[k] = 0
            self._last = None
        elif norm.startswith("UPDATE manual_search_quota"):
            scope, key, window, cap = params
            k = (scope, key, window)
            used = self.conn.pending.get(k, self.conn.store.get(k, 0))
            if used < cap:
                self.conn.pending[k] = used + 1
                self._last = (scope,)
            else:
                self._last = None
        else:  # pragma: no cover - fail loud on an unexpected statement
            raise AssertionError(f"unexpected SQL: {norm}")

    def fetchone(self):
        return self._last

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, store):
        self.store = store  # the "committed" state the test asserts against
        self.pending: dict[tuple[str, str, object], int] = {}
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        self.store.update(self.pending)
        self.pending.clear()
        self.committed = True

    def rollback(self):
        self.pending.clear()
        self.rolled_back = True

    def close(self):
        self.closed = True


def _install_fake_psycopg2(monkeypatch, store, connect_spy=None):
    import types

    fake = types.ModuleType("psycopg2")

    def connect(url, connect_timeout=None):
        if connect_spy is not None:
            connect_spy.append((url, connect_timeout))
        return _FakeConn(store)

    fake.connect = connect
    monkeypatch.setitem(sys.modules, "psycopg2", fake)
    return fake


NOW = datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)


async def test_all_three_counters_under_cap_reserves_ok(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store: dict = {}
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "ok"
    assert store[("user_day", "t1:u1", NOW.date())] == 1
    assert store[("tenant_day", "t1", NOW.date())] == 1
    assert store[("global_month", "*", NOW.date().replace(day=1))] == 1


async def test_user_cap_at_capacity_denies_and_leaves_no_partial_increment(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1")
    store = {("user_day", "t1:u1", NOW.date()): 1}  # already at the cap
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "user_cap"
    # Rollback must mean NEITHER of the other two counters moved either.
    assert store.get(("tenant_day", "t1", NOW.date()), 0) == 0
    assert store.get(("global_month", "*", NOW.date().replace(day=1)), 0) == 0


async def test_tenant_cap_at_capacity_denies(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "1")
    store = {("tenant_day", "t1", NOW.date()): 1}
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "tenant_cap"
    assert store.get(("user_day", "t1:u1", NOW.date()), 0) == 0


async def test_global_cap_at_capacity_denies(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1")
    store = {("global_month", "*", NOW.date().replace(day=1)): 1}
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "global_cap"


async def test_denial_priority_is_user_then_tenant_then_global(monkeypatch):
    """When multiple caps are simultaneously exhausted, user_cap wins —
    the technician's own daily limit is the most actionable thing to report."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1")
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", "1")
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "1")
    store = {
        ("user_day", "t1:u1", NOW.date()): 1,
        ("tenant_day", "t1", NOW.date()): 1,
        ("global_month", "*", NOW.date().replace(day=1)): 1,
    }
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "user_cap"


async def test_locks_are_taken_in_a_fixed_scope_order_every_time(monkeypatch):
    """Prevents a lock-order deadlock under concurrency: every reservation
    (any tenant, any user) must touch the three counters in the SAME order."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store: dict = {}
    fake = _install_fake_psycopg2(monkeypatch, store)
    seen_order: list[str] = []
    real_connect = fake.connect

    def spying_connect(url, connect_timeout=None):
        conn = real_connect(url, connect_timeout=connect_timeout)
        real_cursor = conn.cursor

        def cursor():
            c = real_cursor()
            real_execute = c.execute

            def execute(sql, params=None):
                norm = " ".join(sql.split())
                if norm.startswith("UPDATE") and params:
                    seen_order.append(params[0])
                return real_execute(sql, params)

            c.execute = execute
            return c

        conn.cursor = cursor
        return conn

    fake.connect = spying_connect
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    await quota_mod.reserve_provider_query(identity, now=NOW)
    assert seen_order == sorted(seen_order), (
        f"UPDATE statements ran out of the fixed scope order: {seen_order}"
    )
    assert seen_order == ["global_month", "tenant_day", "user_day"]


async def test_a_query_failure_mid_transaction_rolls_back_and_denies(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")

    class ExplodingCursor(_FakeCursor):
        def execute(self, sql, params=None):
            norm = " ".join(sql.split())
            if norm.startswith("UPDATE") and params and params[0] == "tenant_day":
                raise RuntimeError("connection dropped mid-transaction")
            return super().execute(sql, params)

    store: dict = {}

    class ExplodingConn(_FakeConn):
        def cursor(self):
            return ExplodingCursor(self)

    import types

    fake = types.ModuleType("psycopg2")
    fake.connect = lambda url, connect_timeout=None: ExplodingConn(store)
    monkeypatch.setitem(sys.modules, "psycopg2", fake)

    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "quota_unavailable"


async def test_utc_window_rollover_starts_a_fresh_row(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "1")
    store = {("user_day", "t1:u1", NOW.date()): 1}  # yesterday's row, at cap
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    tomorrow = datetime(2026, 10, 1, 0, 30, 0, tzinfo=timezone.utc)
    # A new UTC day -> a brand new row -> not at cap even though "yesterday"
    # (by wall time, same literal row key as NOW) was exhausted.
    reason = await quota_mod.reserve_provider_query(identity, now=tomorrow)
    assert reason == "ok"
    assert store[("user_day", "t1:u1", tomorrow.date())] == 1
    assert store[("user_day", "t1:u1", NOW.date())] == 1  # untouched
