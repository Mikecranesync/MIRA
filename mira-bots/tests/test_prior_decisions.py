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
    """Do not set `app.tenant_id`.

    `NEON_DATABASE_URL` is a PgBouncer pooler endpoint, and a GUC set on a
    pooled backend outlives the transaction as the EMPTY STRING. `app.tenant_id`
    is the setting the UUID-family policies cast
    (`current_setting('app.tenant_id', true)::UUID`), so a leaked `''` turns a
    later query on `tag_events` / `approved_tags` / `flaky_input_signals` /
    `live_signal_cache` into `22P02 invalid input syntax for type uuid: ""` — in
    a session that never touched this module.

    Staging proved it: setting both spellings turned five pre-existing RLS tests
    red. Migration 070's policy reads both, so `app.current_tenant_id` alone is
    sufficient and `app.tenant_id` buys nothing. This asserts on the source
    because the damage is only observable through a *shared* pooled backend —
    the live proof is the `test_rls_tag_trace_tables.py` suite staying green in
    the same job.
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
