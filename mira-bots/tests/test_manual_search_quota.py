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

import asyncio
import logging
import pathlib
import sys
import threading
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import shared.manual_search.quota as quota_mod  # noqa: E402


@pytest.fixture(autouse=True)
def _global_cap_configured_by_default(monkeypatch):
    """Owner decision D4 (2026-09-30): MANUAL_SEARCH_GLOBAL_MONTHLY_CAP has NO
    default — unset/blank/invalid/<=0 all fail closed ("global_cap_unconfigured",
    see the dedicated tests below). Most tests in this file are about the
    OTHER caps or the SQL mechanics, not the global-cap-unconfigured path
    itself, so give them a safe configured value here; a test that needs a
    specific value (or needs it unset) overrides/removes it in its own body —
    monkeypatch's last write for a given test wins."""
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "100000")


# ---------------------------------------------------------------------------
# Env-var caps — mirror search.py's max_provider_queries() contract
# ---------------------------------------------------------------------------


def test_default_caps(monkeypatch):
    monkeypatch.delenv("MANUAL_SEARCH_USER_DAILY_CAP", raising=False)
    monkeypatch.delenv("MANUAL_SEARCH_TENANT_DAILY_CAP", raising=False)
    monkeypatch.delenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raising=False)
    assert quota_mod.user_daily_cap() == 10
    assert quota_mod.tenant_daily_cap() == 50
    # No default for the global cap (D4 not yet decided) — None, not a number.
    assert quota_mod.global_monthly_cap() is None


@pytest.mark.parametrize("raw", ["0", "-3", "lots", ""])
def test_invalid_or_nonpositive_caps_fall_back_to_default(monkeypatch, raw):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", raw)
    monkeypatch.setenv("MANUAL_SEARCH_TENANT_DAILY_CAP", raw)
    assert quota_mod.user_daily_cap() == 10
    assert quota_mod.tenant_daily_cap() == 50


@pytest.mark.parametrize("raw", ["0", "-3", "lots", ""])
def test_invalid_or_nonpositive_global_cap_is_unconfigured_not_a_default(monkeypatch, raw):
    """The global cap has no fallback: an invalid/non-positive value is
    treated exactly like unset (None), never silently defaulted."""
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raw)
    assert quota_mod.global_monthly_cap() is None


def test_a_valid_override_is_honored(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", "7")
    assert quota_mod.user_daily_cap() == 7


def test_a_valid_global_cap_override_is_honored(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "42")
    assert quota_mod.global_monthly_cap() == 42


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
        self.conn.executed.append(norm)
        if norm.startswith("SET LOCAL"):
            self._last = None
        elif norm.startswith("UPDATE manual_search_quota SET used = used - 1"):
            # #5847: the release of a reservation that was committed but never sent.
            scope, key, window = params
            if "release" in self.conn.hooks:
                self.conn.hooks["release"](scope)
            k = (scope, key, window)
            used = self.conn.pending.get(k, self.conn.store.get(k, 0))
            if used > 0:
                self.conn.pending[k] = used - 1
            self._last = None
        elif norm.startswith("INSERT INTO manual_search_quota"):
            scope, key, window = params
            k = (scope, key, window)
            if k not in self.conn.store and k not in self.conn.pending:
                self.conn.pending[k] = 0
            self._last = None
        elif norm.startswith("UPDATE manual_search_quota"):
            scope, key, window, cap = params
            if "update" in self.conn.hooks:
                self.conn.hooks["update"](scope)
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
    def __init__(self, store, hooks=None):
        self.store = store  # the "committed" state the test asserts against
        self.pending: dict[tuple[str, str, object], int] = {}
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.executed: list[str] = []
        # Optional test hooks: "update" runs before each cap UPDATE and "release"
        # before each release decrement (both with the scope), "commit" before a
        # commit applies, so a test can hold the worker thread there or fail a row.
        self.hooks = hooks or {}

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        if "commit" in self.hooks:
            self.hooks["commit"]()
        self.store.update(self.pending)
        self.pending.clear()
        self.committed = True

    def rollback(self):
        self.pending.clear()
        self.rolled_back = True

    def close(self):
        self.closed = True


def _install_fake_psycopg2(monkeypatch, store, connect_spy=None, conns=None, hooks=None):
    import types

    fake = types.ModuleType("psycopg2")

    def connect(url, connect_timeout=None):
        if connect_spy is not None:
            connect_spy.append((url, connect_timeout))
        conn = _FakeConn(store, hooks)
        if conns is not None:
            conns.append(conn)
        return conn

    fake.connect = connect
    monkeypatch.setitem(sys.modules, "psycopg2", fake)
    return fake


NOW = datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Unconfigured global cap — fail closed, no DB connection, no query sent
# (owner decision D4, 2026-09-30: the monthly $ ceiling is not yet decided)
# ---------------------------------------------------------------------------


async def test_unconfigured_global_cap_denies_without_touching_the_database(monkeypatch):
    monkeypatch.delenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", raising=False)
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    calls: list[tuple] = []
    import types

    fake_psycopg2 = types.ModuleType("psycopg2")
    fake_psycopg2.connect = lambda *a, **k: calls.append((a, k)) or _FakeConn({})
    monkeypatch.setitem(sys.modules, "psycopg2", fake_psycopg2)

    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "global_cap_unconfigured"
    assert calls == [], "an unconfigured global cap must never reach psycopg2.connect"


async def test_blank_global_cap_is_also_unconfigured(monkeypatch):
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "   ")
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "global_cap_unconfigured"


async def test_control_a_configured_global_cap_takes_the_normal_path(monkeypatch):
    """Positive control: once the global cap IS configured, reservation
    proceeds normally — the unconfigured check does not misfire when it
    shouldn't."""
    monkeypatch.setenv("MANUAL_SEARCH_GLOBAL_MONTHLY_CAP", "5")
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store: dict = {}
    _install_fake_psycopg2(monkeypatch, store)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    reason = await quota_mod.reserve_provider_query(identity, now=NOW)
    assert reason == "ok"
    assert store[("global_month", quota_mod.GLOBAL_SCOPE_KEY, NOW.date().replace(day=1))] == 1


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


# ---------------------------------------------------------------------------
# #5847: a reservation whose caller is cancelled never charges for a query that
# was never sent. The cancel can land before the commit, during it, or after the
# worker returned but before the awaiting task resumed; each test stages one
# ordering and asserts which party acted before it asserts the counters.
# ---------------------------------------------------------------------------

_PRE = 3  # every counter starts here, so a wrong release reads 2, not a silent no-op


def _charged_store():
    return {
        ("user_day", "t1:u1", NOW.date()): _PRE,
        ("tenant_day", "t1", NOW.date()): _PRE,
        ("global_month", "*", NOW.date().replace(day=1)): _PRE,
    }


def _spies(monkeypatch):
    """Record every _reserve_sync result and every release (with the thread it ran
    on), each with an event the test waits on instead of sleeping."""
    worker: list[str] = []
    worker_done = threading.Event()
    released: list[str] = []
    release_done = threading.Event()
    real_reserve, real_release = quota_mod._reserve_sync, quota_mod._release_sync

    def reserve(*args):
        result = real_reserve(*args)
        worker.append(result)
        worker_done.set()
        return result

    def release(identity, now):
        released.append(threading.current_thread().name)
        real_release(identity, now)
        release_done.set()

    monkeypatch.setattr(quota_mod, "_reserve_sync", reserve)
    monkeypatch.setattr(quota_mod, "_release_sync", release)
    return worker, worker_done, released, release_done


def _held_at(stage, scope="user_day"):
    """A hook that holds the worker thread at ``stage`` until the test opens the
    gate. The user_day UPDATE is the last of the three, so holding there stops
    the worker after every cap check and before the commit decision."""
    reached, gate = threading.Event(), threading.Event()

    def hold(*args):
        if stage == "update" and args[0] != scope:
            return
        reached.set()
        assert gate.wait(5), "the test never opened the gate"

    return {stage: hold}, reached, gate


async def _cancel_while_held(identity, reached):
    task = asyncio.create_task(quota_mod.reserve_provider_query(identity, now=NOW))
    assert await asyncio.to_thread(reached.wait, 5), "the worker never reached the hold"
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_a_cancel_before_the_commit_rolls_the_reservation_back(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store, conns = _charged_store(), []
    hooks, reached, gate = _held_at("update")
    _install_fake_psycopg2(monkeypatch, store, conns=conns, hooks=hooks)
    worker, worker_done, released, _ = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    await _cancel_while_held(identity, reached)
    gate.set()
    assert await asyncio.to_thread(worker_done.wait, 5)

    # The path: the worker saw the cancel before committing and rolled back.
    assert worker == ["abandoned"]
    assert len(conns) == 1 and conns[0].rolled_back and not conns[0].committed
    assert released == []
    assert store == _charged_store()


async def test_a_cancel_during_the_commit_is_released_by_the_worker(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store, conns = _charged_store(), []
    hooks, reached, gate = _held_at("commit")
    _install_fake_psycopg2(monkeypatch, store, conns=conns, hooks=hooks)
    worker, worker_done, released, release_done = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    await _cancel_while_held(identity, reached)
    gate.set()
    assert await asyncio.to_thread(worker_done.wait, 5)
    assert await asyncio.to_thread(release_done.wait, 5)

    # The path: the charge committed, then the worker itself gave it back.
    assert worker == ["abandoned"]
    assert conns[0].committed
    assert len(released) == 1 and released[0] != quota_mod._RELEASE_THREAD_NAME
    assert len(conns) == 2 and conns[1].committed
    assert (
        sum(
            s.startswith("UPDATE manual_search_quota SET used = used - 1")
            for s in conns[1].executed
        )
        == 3
    )
    assert store == _charged_store()


async def test_a_cancel_after_the_worker_returned_is_released_by_the_awaiter(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store, conns = _charged_store(), []
    _install_fake_psycopg2(monkeypatch, store, conns=conns)
    worker, worker_done, released, release_done = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    task = asyncio.create_task(quota_mod.reserve_provider_query(identity, now=NOW))
    await asyncio.sleep(0)  # the task starts and hands the reservation to its thread
    # Hold the event loop until the worker has returned, so the task cannot resume
    # with the result before it is cancelled.
    assert worker_done.wait(5)
    assert worker == ["ok"] and store[("user_day", "t1:u1", NOW.date())] == _PRE + 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await asyncio.to_thread(release_done.wait, 5)

    # The path: the worker had delivered "ok", so the cancelled awaiter released.
    assert released == [quota_mod._RELEASE_THREAD_NAME]
    assert len(conns) == 2 and conns[1].committed
    assert store == _charged_store()


async def test_control_an_uncancelled_reservation_charges_and_releases_nothing(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store, conns = _charged_store(), []
    _install_fake_psycopg2(monkeypatch, store, conns=conns)
    worker, _, released, _ = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    assert await quota_mod.reserve_provider_query(identity, now=NOW) == "ok"
    assert worker == ["ok"] and released == [] and len(conns) == 1
    assert store == {k: _PRE + 1 for k in _charged_store()}


async def test_control_a_cancelled_cap_denial_releases_nothing(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setenv("MANUAL_SEARCH_USER_DAILY_CAP", str(_PRE))  # user_day is at its cap
    store, conns = _charged_store(), []
    hooks, reached, gate = _held_at("update")
    _install_fake_psycopg2(monkeypatch, store, conns=conns, hooks=hooks)
    worker, worker_done, released, _ = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    await _cancel_while_held(identity, reached)
    gate.set()
    assert await asyncio.to_thread(worker_done.wait, 5)

    assert worker == ["user_cap"]
    assert len(conns) == 1 and conns[0].rolled_back and not conns[0].committed
    assert released == []
    assert store == _charged_store()


def test_a_release_that_fails_midway_leaves_the_whole_charge_and_never_raises(monkeypatch, caplog):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    store, conns, decrements = _charged_store(), [], []

    def fail_the_second_row(scope):
        decrements.append(scope)
        if len(decrements) == 2:
            raise RuntimeError("statement timeout")

    _install_fake_psycopg2(monkeypatch, store, conns=conns, hooks={"release": fail_the_second_row})
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    with caplog.at_level(logging.INFO, logger="mira.manual_search"):
        quota_mod._release_sync(identity, NOW)  # must not raise

    # The path: the first row was decremented, the second failed, and the
    # transaction was rolled back rather than committed half-released.
    assert len(decrements) == 2
    assert len(conns) == 1 and conns[0].rolled_back and not conns[0].committed and conns[0].closed
    assert store == _charged_store()  # over-counts rather than under-counts
    assert "MANUAL_SEARCH_QUOTA_RELEASE_FAILED" in caplog.text
    assert "MANUAL_SEARCH_QUOTA_RELEASED" not in caplog.text
    assert "t1:u1" not in caplog.text  # the scope key may embed a user id


def test_a_release_that_cannot_connect_never_raises(monkeypatch, caplog):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    import types

    fake = types.ModuleType("psycopg2")

    def boom(url, connect_timeout=None):
        raise RuntimeError("connection refused")

    fake.connect = boom
    monkeypatch.setitem(sys.modules, "psycopg2", fake)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")
    with caplog.at_level(logging.ERROR, logger="mira.manual_search"):
        quota_mod._release_sync(identity, NOW)  # must not raise
    assert "MANUAL_SEARCH_QUOTA_RELEASE_FAILED" in caplog.text
    assert "t1:u1" not in caplog.text


@pytest.mark.parametrize("stage", ["update", "commit"])
async def test_the_endpoint_timeout_during_a_stalled_reservation_charges_nothing(
    monkeypatch, stage
):
    """#5847's own evidence, through the real caller: the discovery endpoint wraps
    the search in asyncio.wait_for, and its timeout fires while _serper_search is
    awaiting a stalled reservation. No query is sent, so nothing may be charged,
    whether the stall is in the cap UPDATE or in the commit."""
    import functools

    import shared.manual_search.search as search_mod

    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://fake/db")
    monkeypatch.setattr(search_mod, "SERPER_API_KEY", "test-key")
    sends: list[str] = []

    async def post(query, num):
        sends.append(query)
        return []

    monkeypatch.setattr(search_mod, "_serper_post", post)
    # The real wrapper, pinned to NOW so the counters it touches are the test's.
    monkeypatch.setattr(
        quota_mod,
        "reserve_provider_query",
        functools.partial(quota_mod.reserve_provider_query, now=NOW),
    )
    store, conns = _charged_store(), []
    hooks, reached, gate = _held_at(stage)
    _install_fake_psycopg2(monkeypatch, store, conns=conns, hooks=hooks)
    worker, worker_done, released, release_done = _spies(monkeypatch)
    identity = quota_mod.QuotaIdentity(tenant_id="t1", user_id="u1")

    with quota_mod.provider_query_quota(identity):
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                search_mod._serper_search("gs10 manual filetype:pdf"), timeout=0.5
            )
    assert reached.is_set(), "the timeout did not land during the reservation"
    gate.set()
    assert await asyncio.to_thread(worker_done.wait, 5)
    if stage == "commit":
        assert await asyncio.to_thread(release_done.wait, 5)

    assert sends == []
    assert worker == ["abandoned"]
    if stage == "update":
        assert released == []  # rolled back before the commit
    else:
        assert (
            len(released) == 1 and released[0] != quota_mod._RELEASE_THREAD_NAME
        )  # the worker released
    assert store == _charged_store()
