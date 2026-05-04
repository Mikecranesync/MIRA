"""Tests for invite minting and consumption."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.tenant.invites import (
    InviteAlreadyConsumed,
    InviteExpired,
    InviteNotFound,
    consume_invite,
    mint_invite,
)
from sqlalchemy import create_engine, text

# Schema mirrors migration 006, but with TEXT instead of UUID/TIMESTAMPTZ for SQLite.
_SQLITE_DDL = """
CREATE TABLE plg_tenants (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL
);
CREATE TABLE mira_users (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE identity_links (
    id               TEXT PRIMARY KEY,
    mira_user_id     TEXT NOT NULL,
    platform         TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,
    UNIQUE (platform, external_user_id, tenant_id)
);
CREATE TABLE tenant_invites (
    token        TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    minted_by    TEXT NOT NULL,
    minted_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP NOT NULL,
    consumed_at  TIMESTAMP,
    consumed_by  TEXT
);
"""


@pytest.fixture
def engine():
    e = create_engine("sqlite:///:memory:")
    with e.connect() as conn:
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'admin@acme.com')"))
        conn.commit()
    return e


def test_mint_returns_token(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="admin1")
    assert isinstance(token, str)
    assert 16 <= len(token) <= 64
    # Token charset must match Telegram start-parameter spec (A-Za-z0-9_-)
    import re

    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_consume_creates_user_and_link(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="admin1")
    user = consume_invite(
        engine, token=token, telegram_user_id="555", display_name="Alice"
    )
    assert user.tenant_id == "t_acme"
    assert user.email == "alice@acme.com"
    assert user.display_name == "Alice"
    # Identity link must exist
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT mira_user_id FROM identity_links "
                "WHERE platform='telegram' AND external_user_id='555'"
            )
        ).fetchone()
    assert row is not None
    assert row[0] == user.id


def test_consume_marks_invite_consumed(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="bob@acme.com", minted_by="admin1")
    consume_invite(engine, token=token, telegram_user_id="666", display_name="Bob")
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT consumed_at, consumed_by FROM tenant_invites WHERE token=:t"),
            {"t": token},
        ).fetchone()
    assert row[0] is not None
    assert row[1] == "666"


def test_consume_unknown_token_raises(engine):
    with pytest.raises(InviteNotFound):
        consume_invite(engine, token="nope", telegram_user_id="1", display_name="X")


def test_consume_expired_raises(engine):
    # Mint with a -1h TTL → already expired
    token = mint_invite(
        engine, tenant_id="t_acme", email="late@acme.com", minted_by="admin1", ttl_hours=-1
    )
    with pytest.raises(InviteExpired):
        consume_invite(engine, token=token, telegram_user_id="2", display_name="Late")


def test_double_consume_raises(engine):
    token = mint_invite(engine, tenant_id="t_acme", email="dup@acme.com", minted_by="admin1")
    consume_invite(engine, token=token, telegram_user_id="7", display_name="Dup1")
    with pytest.raises(InviteAlreadyConsumed):
        consume_invite(engine, token=token, telegram_user_id="8", display_name="Dup2")
