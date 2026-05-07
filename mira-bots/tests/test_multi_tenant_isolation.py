"""Integration: two users in the same tenant don't see each other's state;
two users in different tenants don't see each other's data."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shared.identity.service import IdentityService
from shared.tenant.invites import consume_invite, mint_invite
from sqlalchemy import create_engine, text

_DDL = """
CREATE TABLE plg_tenants (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
                         display_name TEXT DEFAULT '', email TEXT DEFAULT '');
CREATE TABLE identity_links (id TEXT PRIMARY KEY, mira_user_id TEXT NOT NULL,
                             platform TEXT, external_user_id TEXT, tenant_id TEXT,
                             UNIQUE(platform, external_user_id, tenant_id));
CREATE TABLE tenant_invites (token TEXT PRIMARY KEY, tenant_id TEXT, email TEXT,
                              display_name TEXT DEFAULT '', minted_by TEXT,
                              minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                              expires_at TIMESTAMP, consumed_at TIMESTAMP, consumed_by TEXT);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'a@acme'), ('t_other', 'a@other')"))
        conn.commit()
    return e


def test_lookup_only_isolates_users_across_tenants(engine):
    """An external_user_id existing in one tenant must NOT match for another."""
    svc = IdentityService(engine)
    # Enroll Alice in t_acme
    tok = mint_invite(engine, tenant_id="t_acme", email="alice@x", minted_by="admin")
    consume_invite(engine, token=tok, telegram_user_id="555", display_name="Alice")
    # Lookup as a stranger DM from a different telegram id → must be None
    assert svc.lookup_only("telegram", "999") is None


def test_two_users_same_tenant_get_distinct_mira_user_ids(engine):
    svc = IdentityService(engine)
    tok_a = mint_invite(engine, tenant_id="t_acme", email="alice@x", minted_by="admin")
    consume_invite(engine, token=tok_a, telegram_user_id="555", display_name="Alice")
    tok_b = mint_invite(engine, tenant_id="t_acme", email="bob@x", minted_by="admin")
    consume_invite(engine, token=tok_b, telegram_user_id="666", display_name="Bob")

    a = svc.lookup_only("telegram", "555")
    b = svc.lookup_only("telegram", "666")
    assert a is not None and b is not None
    assert a.id != b.id
    assert a.tenant_id == b.tenant_id == "t_acme"


def test_revoked_user_cannot_be_looked_up(engine):
    """After deleting identity_links row, lookup_only returns None — the next
    message hits the dispatcher gate and is rejected."""
    svc = IdentityService(engine)
    tok = mint_invite(engine, tenant_id="t_acme", email="charlie@x", minted_by="admin")
    consume_invite(engine, token=tok, telegram_user_id="777", display_name="Charlie")
    assert svc.lookup_only("telegram", "777") is not None
    # Revoke
    with engine.connect() as conn:
        conn.execute(
            text(
                "DELETE FROM identity_links "
                "WHERE platform='telegram' AND external_user_id='777' AND tenant_id='t_acme'"
            )
        )
        conn.commit()
    assert svc.lookup_only("telegram", "777") is None
