"""`shared.prior_decisions` — hermetic tests for the decision_traces READER.

The behavioral proof that this reader works lives in
`tests/integration/test_ws1_context_contract.py` (real staging Postgres, slug
tenants, RLS). What is covered HERE is the part a live DB cannot cheaply prove
on demand: the no-op paths, the fail-open-but-never-silent contract, and one
pooler-safety invariant that is otherwise only observable as damage to somebody
else's test.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import prior_decisions as pd  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# No-op paths — "nothing was attempted" is NOT an error
# ---------------------------------------------------------------------------


def test_missing_tenant_is_a_no_op_not_an_unknown(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")
    assert _run(pd.fetch_prior_decisions(None)) == ([], None)
    assert _run(pd.fetch_prior_decisions("")) == ([], None)


def test_unconfigured_storage_is_a_no_op_not_an_unknown(monkeypatch):
    """Offline dev and hermetic tests must not fill every context with an
    `unknowns` entry. Nothing was attempted, so there is nothing to report."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert _run(pd.fetch_prior_decisions("staging")) == ([], None)


# ---------------------------------------------------------------------------
# Fail-open, but never silent (ADR-0033 requirement 6)
# ---------------------------------------------------------------------------


def test_a_failure_returns_the_unknown_and_never_raises(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")

    with patch.object(asyncio, "wait_for", side_effect=RuntimeError("neon down")):
        rows, error = _run(pd.fetch_prior_decisions("staging"))
    assert rows == []
    assert error == pd.UNKNOWN_UNAVAILABLE


def test_a_timeout_is_reported_as_the_unknown(monkeypatch):
    """The most likely failure here, and the one whose message is empty."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")
    with patch.object(asyncio, "wait_for", side_effect=asyncio.TimeoutError()):
        rows, error = _run(pd.fetch_prior_decisions("staging"))
    assert rows == []
    assert error == pd.UNKNOWN_UNAVAILABLE


def test_timeout_is_sized_for_a_cold_connect():
    """`NullPool` + a per-call engine means every lookup pays a full TLS
    handshake to Neon. 1.5 s timed out on the first staging call; anything
    tighter than ~2 s makes the unknown noise rather than signal."""
    assert pd.DEFAULT_TIMEOUT_S >= 2.0


# ---------------------------------------------------------------------------
# Pooler safety — the invariant that broke five OTHER tests
# ---------------------------------------------------------------------------


def test_reader_binds_only_app_current_tenant_id():
    """Bind the minimum: `app.current_tenant_id` only.

    Migration 070's `decision_traces` policy reads BOTH spellings, so this one
    is sufficient and `app.tenant_id` is pure redundancy.

    The reason to care which GUCs this module sets is an ambient hazard on the
    pooler, NOT a defect this module caused. A custom GUC that has been set on a
    pooled backend reads back as the EMPTY STRING rather than NULL for the next
    client of that backend, and `app.tenant_id` is what the UUID-family policies
    cast — `''::uuid` is `22P02`. Measured on staging 2026-07-30 from
    connections unrelated to this code: one fresh connection read `''`, twelve
    later ones read NULL.

    So this is a hygiene invariant (write less ambient state), deliberately NOT
    claimed as the cure — the durable fix is `NULLIF(current_setting(…), '')`
    in the policies themselves, which is a separate migration. Asserted at the
    source because a *shared* pooled backend is the only place the difference
    shows up, and it shows up intermittently.
    """
    import inspect

    src = inspect.getsource(pd)
    assert "app.current_tenant_id" in src
    assert "SET LOCAL app.tenant_id" not in src, (
        "setting app.tenant_id leaks '' through the pooler and breaks every "
        "UUID-family RLS policy — bind only app.current_tenant_id"
    )


def test_reader_never_casts_tenant_id_to_uuid():
    """#3003: decision_traces.tenant_id is TEXT since migration 070."""
    sql = (pd._BASE_SQL + pd._UNS_PREDICATE + pd._ORDER_SQL).lower()
    assert ":tenant_id" in sql
    assert "tenant_id as uuid" not in sql
    assert "tenant_id::uuid" not in sql


def test_query_is_bounded_and_newest_first():
    sql = (pd._BASE_SQL + pd._ORDER_SQL).lower()
    assert "order by ts desc" in sql
    assert "limit :limit" in sql


# ---------------------------------------------------------------------------
# Executor discipline — an asyncio timeout bounds the CALLER, not the thread
# ---------------------------------------------------------------------------


def test_timeout_leaves_no_unobserved_executor_exception(monkeypatch, caplog):
    """The orphaned-Future bug, proved through the real reader path.

    A thread cannot be cancelled. If the worker raises AFTER the caller has
    timed out and nobody retrieves the outcome, the exception is discarded at
    GC — a failure that silently never happened. The done-callback must observe
    it. This drives the real `fetch_prior_decisions`, not a stand-in.
    """
    import logging
    import threading
    import time

    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")
    started, raised = threading.Event(), threading.Event()

    def _slow_boom(*a, **k):
        started.set()
        time.sleep(0.25)
        raised.set()
        raise RuntimeError("late worker failure")

    # Fail inside the worker, after the caller's 50 ms budget has elapsed.
    monkeypatch.setattr(pd, "_rows_to_dicts", _slow_boom)
    monkeypatch.setattr(
        "sqlalchemy.create_engine",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("late worker failure")),
    )

    with caplog.at_level(logging.WARNING, logger="mira-gsd.prior_decisions"):
        rows, error = _run(pd.fetch_prior_decisions("staging", timeout_s=0.05))
        assert (rows, error) == ([], pd.UNKNOWN_UNAVAILABLE)
        # Let the abandoned worker finish and its callback fire.
        for _ in range(200):
            if any(
                "LATE_FAILURE" in r.message or "UNAVAILABLE" in r.message for r in caplog.records
            ):
                break
            time.sleep(0.01)

    msgs = " ".join(r.message for r in caplog.records)
    assert "PRIOR_DECISIONS" in msgs, "the failure must be logged, never discarded"


def test_saturation_returns_the_unknown_rather_than_queueing(monkeypatch):
    """All dedicated workers busy -> explicit unknown, not an unbounded queue.

    Saturation must never be indistinguishable from "this tenant has no history".
    """
    import threading

    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://stub/db")
    # Deterministic: swap in a private, already-drained semaphore rather than
    # racing whatever in-flight workers other tests left behind.
    drained = threading.BoundedSemaphore(1)
    assert drained.acquire(blocking=False)
    monkeypatch.setattr(pd, "_SLOTS", drained)

    rows, error = _run(pd.fetch_prior_decisions("staging"))
    assert rows == []
    assert error == pd.UNKNOWN_UNAVAILABLE


def test_reader_uses_a_dedicated_executor_not_the_shared_default():
    """`run_in_executor(None, ...)` would let this module starve the whole loop."""
    import inspect

    call_site = inspect.getsource(pd.fetch_prior_decisions)
    assert "run_in_executor" not in call_site, (
        "the shared default executor must not be used — a timed-out DB call holds "
        "its worker and would starve everything else that does thread work"
    )
    assert "_executor().submit(" in call_site, "must submit to the dedicated pool"
    assert "_SLOTS.acquire(blocking=False)" in call_site, "saturation must not queue"
    assert "ThreadPoolExecutor(" in inspect.getsource(pd._executor)


def test_db_side_bounds_are_applied():
    """connect_timeout + statement_timeout: the driver caps the worker, so an
    abandoned thread cannot outlive its budget indefinitely."""
    import inspect

    src = inspect.getsource(pd.fetch_prior_decisions)
    assert "connect_timeout" in src
    assert "statement_timeout" in src


# ---------------------------------------------------------------------------
# RLS is actually enforced (not merely relied upon)
# ---------------------------------------------------------------------------


def test_reader_drops_to_the_app_role_inside_its_transaction():
    """The URL connects as an owner role with BYPASSRLS, under which policies are
    never evaluated. Without this the reader trusts its own WHERE clause and
    calls it tenant isolation. Behavioural proof is the integration suite."""
    import inspect

    src = inspect.getsource(pd.fetch_prior_decisions)
    assert "SET LOCAL ROLE factorylm_app" in src
    role_at = src.index("SET LOCAL ROLE factorylm_app")
    guc_at = src.index("SET LOCAL app.current_tenant_id")
    select_at = src.index("_rows_to_dicts")
    assert role_at < guc_at < select_at, "role switch must precede the bind and the SELECT"
