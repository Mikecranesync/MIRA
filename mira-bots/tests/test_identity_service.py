"""Tests for IdentityService — resolve, email linking, cross-tenant isolation,
linked platforms, and manual link."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.identity.service import IdentityService
from sqlalchemy import create_engine, text

# ---------------------------------------------------------------------------
# SQLite-compatible schema (no gen_random_uuid, no TIMESTAMPTZ)
# ---------------------------------------------------------------------------

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS mira_users (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS identity_links (
    id               TEXT PRIMARY KEY,
    mira_user_id     TEXT NOT NULL REFERENCES mira_users(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,
    UNIQUE (platform, external_user_id, tenant_id)
);
"""


@pytest.fixture
def svc():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.commit()
    return IdentityService(engine)


# ---------------------------------------------------------------------------
# resolve — new identity creates user + link
# ---------------------------------------------------------------------------


def test_resolve_new_identity_creates_user(svc):
    user = svc.resolve("slack", "U_ALICE", "acme", display_name="Alice")
    assert user.id
    assert user.tenant_id == "acme"
    assert user.display_name == "Alice"


def test_resolve_same_identity_returns_same_user(svc):
    u1 = svc.resolve("slack", "U_BOB", "acme")
    u2 = svc.resolve("slack", "U_BOB", "acme")
    assert u1.id == u2.id


def test_resolve_different_platforms_same_person_via_email(svc):
    """Slack and Teams resolve to the same user when email matches."""
    slack_user = svc.resolve("slack", "U_CAROL", "acme", email="carol@acme.com", display_name="Carol")
    teams_user = svc.resolve("teams", "T_CAROL", "acme", email="carol@acme.com")
    assert slack_user.id == teams_user.id


def test_resolve_different_platforms_no_email_creates_separate_users(svc):
    u_slack = svc.resolve("slack", "U_DAN", "acme")
    u_teams = svc.resolve("teams", "T_DAN", "acme")
    assert u_slack.id != u_teams.id


# ---------------------------------------------------------------------------
# Cross-tenant isolation
# ---------------------------------------------------------------------------


def test_resolve_same_external_id_different_tenants_are_isolated(svc):
    u_acme = svc.resolve("telegram", "12345", "acme")
    u_beta = svc.resolve("telegram", "12345", "beta-corp")
    assert u_acme.id != u_beta.id


# ---------------------------------------------------------------------------
# get_linked_platforms
# ---------------------------------------------------------------------------


def test_get_linked_platforms_returns_all_links(svc):
    user = svc.resolve("slack", "U_EVE", "acme", email="eve@acme.com")
    svc.resolve("teams", "T_EVE", "acme", email="eve@acme.com")

    links = svc.get_linked_platforms(user.id)
    platforms = {lk.platform for lk in links}
    assert "slack" in platforms
    assert "teams" in platforms


def test_get_linked_platforms_unknown_user_returns_empty(svc):
    assert svc.get_linked_platforms("no-such-id") == []


# ---------------------------------------------------------------------------
# get_user
# ---------------------------------------------------------------------------


def test_get_user_returns_correct_user(svc):
    created = svc.resolve("gchat", "G_FRANK", "acme", display_name="Frank", email="frank@acme.com")
    fetched = svc.get_user(created.id)
    assert fetched is not None
    assert fetched.display_name == "Frank"
    assert fetched.email == "frank@acme.com"


def test_get_user_missing_returns_none(svc):
    assert svc.get_user("00000000-0000-0000-0000-000000000000") is None


# ---------------------------------------------------------------------------
# Manual link_identity
# ---------------------------------------------------------------------------


def test_link_identity_adds_new_platform(svc):
    user = svc.resolve("slack", "U_GRACE", "acme")
    link = svc.link_identity(user.id, "telegram", "TG_GRACE", "acme")
    assert link.mira_user_id == user.id
    assert link.platform == "telegram"

    platforms = {lk.platform for lk in svc.get_linked_platforms(user.id)}
    assert "telegram" in platforms


def test_link_identity_duplicate_is_idempotent(svc):
    """ON CONFLICT DO NOTHING — no error on duplicate."""
    user = svc.resolve("slack", "U_HENRY", "acme")
    svc.link_identity(user.id, "slack", "U_HENRY", "acme")  # same link again
    links = svc.get_linked_platforms(user.id)
    assert len([lk for lk in links if lk.platform == "slack"]) == 1


# ---------------------------------------------------------------------------
# list_users
# ---------------------------------------------------------------------------


def test_list_users_scoped_to_tenant(svc):
    svc.resolve("slack", "U1", "tenant-a", display_name="Alice")
    svc.resolve("slack", "U2", "tenant-a", display_name="Bob")
    svc.resolve("slack", "U3", "tenant-b", display_name="Charlie")

    users_a = svc.list_users("tenant-a")
    assert len(users_a) == 2
    names = {u.display_name for u in users_a}
    assert "Alice" in names
    assert "Bob" in names
    assert "Charlie" not in names
