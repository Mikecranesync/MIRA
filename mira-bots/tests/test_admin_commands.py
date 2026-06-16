"""Tests for /invite, /team, /revoke, /invite_status admin commands."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

import pytest
from tenant.authorizer import Authorizer
from sqlalchemy import create_engine, text

# Reuse schema from test_invites.py
_SQLITE_DDL = """
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
        for stmt in _SQLITE_DDL.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'admin@acme.com')"))
        conn.commit()
    return e


def _mock_update(user_id: str, args: list[str]):
    """Build a fake Telegram Update with the given from-user and command args."""
    update = MagicMock()
    update.effective_user.id = int(user_id)
    update.effective_user.full_name = "Admin"
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    context.bot.username = "MIRABot"
    return update, context


@pytest.mark.asyncio
async def test_invite_command_admin_returns_link(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("42", ["alice@acme.com"])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    update.message.reply_text.assert_called_once()
    msg = update.message.reply_text.call_args[0][0]
    assert "https://t.me/MIRABot?start=" in msg
    assert "alice@acme.com" in msg


@pytest.mark.asyncio
async def test_invite_command_non_admin_refused(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("99", ["alice@acme.com"])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    msg = update.message.reply_text.call_args[0][0]
    assert "admin" in msg.lower()
    # Confirm no invite row was written
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM tenant_invites")).scalar()
    assert count == 0


@pytest.mark.asyncio
async def test_invite_command_missing_email_helps(engine):
    from admin_commands import invite_command

    auth = Authorizer(admin_telegram_ids="42")
    update, context = _mock_update("42", [])
    await invite_command(update, context, engine=engine, auth=auth, tenant_id="t_acme")
    msg = update.message.reply_text.call_args[0][0]
    assert "Usage" in msg or "email" in msg.lower()
