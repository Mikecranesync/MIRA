"""Tests for TenantScopedSession — the runtime guard that catches
queries touching tenant tables without a tenant_id filter."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.tenant.session import TenantScopedSession, UnscopedQueryError
from sqlalchemy import create_engine, text


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, "
                "display_name TEXT, email TEXT)"
            )
        )
        conn.execute(text("INSERT INTO mira_users VALUES ('u1', 't1', 'A', 'a@x.com')"))
        conn.execute(text("INSERT INTO mira_users VALUES ('u2', 't2', 'B', 'b@x.com')"))
        conn.commit()
    return e


def test_construction_requires_tenant_id(engine):
    with pytest.raises(ValueError, match="tenant_id"):
        TenantScopedSession(engine, tenant_id="")


def test_scoped_select_returns_only_own_tenant(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    rows = sess.execute(
        text("SELECT id FROM mira_users WHERE tenant_id = :tid"), {"tid": "t1"}
    ).fetchall()
    assert [r[0] for r in rows] == ["u1"]


def test_unscoped_select_on_tenant_table_raises(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    with pytest.raises(UnscopedQueryError, match="mira_users"):
        sess.execute(text("SELECT id FROM mira_users"))


def test_unscoped_update_on_tenant_table_raises(engine):
    sess = TenantScopedSession(engine, tenant_id="t1")
    with pytest.raises(UnscopedQueryError):
        sess.execute(text("UPDATE mira_users SET display_name = 'Z'"))


def test_query_on_non_tenant_table_passes(engine):
    """sqlite_master is a system table — should not trigger the guard."""
    sess = TenantScopedSession(engine, tenant_id="t1")
    rows = sess.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'")).fetchall()
    assert any(r[0] == "mira_users" for r in rows)
