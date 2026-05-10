"""Tests for the /start handler — invite consumption and welcome."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

# Minimal env vars needed for shared module imports
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, "mira-bots")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

import pytest
from shared.tenant.invites import mint_invite
from sqlalchemy import create_engine, text

_SQLITE_DDL = """
CREATE TABLE plg_tenants (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE mira_users (id TEXT PRIMARY KEY, tenant_id TEXT, display_name TEXT, email TEXT);
CREATE TABLE identity_links (id TEXT PRIMARY KEY, mira_user_id TEXT, platform TEXT,
                              external_user_id TEXT, tenant_id TEXT,
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
        conn.execute(text("INSERT INTO plg_tenants VALUES ('t_acme', 'a@x')"))
        conn.commit()
    return e


def _mock(user_id: str, args: list[str], full_name: str = "Alice"):
    update = MagicMock()
    update.effective_user.id = int(user_id)
    update.effective_user.full_name = full_name
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = args
    return update, context


@pytest.mark.asyncio
async def test_start_with_valid_token_enrolls_user(engine):
    from start_command import start_command  # noqa: F401

    token = mint_invite(engine, tenant_id="t_acme", email="alice@acme.com", minted_by="42")
    update, context = _mock("555", [token])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "welcome" in msg.lower() or "alice" in msg.lower()
    # Identity link should now exist
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT mira_user_id FROM identity_links WHERE external_user_id='555'")
        ).fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_start_with_no_token_replies_invite_only(engine):
    from start_command import start_command  # noqa: F401

    update, context = _mock("999", [])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "invite" in msg.lower()


@pytest.mark.asyncio
async def test_start_with_expired_token_rejects(engine):
    from start_command import start_command  # noqa: F401

    token = mint_invite(
        engine, tenant_id="t_acme", email="late@acme.com", minted_by="42", ttl_hours=-1
    )
    update, context = _mock("777", [token])
    await start_command(update, context, engine=engine)
    msg = update.message.reply_text.call_args[0][0]
    assert "expire" in msg.lower()


@pytest.mark.asyncio
async def test_start_with_asset_deeplink_greets_with_context(monkeypatch, engine):
    """asset_<tag> payload should look up the asset and greet with make/model.

    The DB lookup is patched out so the test runs without NeonDB.
    """
    import start_command as mod

    fake_asset = mod.AssetContext(
        tag="EQ-AB12CD34",
        name="Air Compressor",
        manufacturer="Ingersoll Rand",
        model="R55n",
        location="Bldg A, Bay 3",
    )
    monkeypatch.setattr(mod, "_lookup_asset_by_tag", lambda tag, telegram_user_id: fake_asset)

    diag_engine = MagicMock()
    diag_engine._load_state = MagicMock(return_value={})
    diag_engine.reset = MagicMock()
    diag_engine._save_state = MagicMock()

    update, context = _mock("555", ["asset_EQ-AB12CD34"])
    await mod.start_command(
        update,
        context,
        engine=engine,
        diagnostic_engine=diag_engine,
    )
    msg = update.message.reply_text.call_args[0][0]
    assert "Air Compressor" in msg
    assert "Ingersoll Rand" in msg or "R55n" in msg
    diag_engine.reset.assert_called_once()
    saved = diag_engine._save_state.call_args[0][1]
    assert saved["asset_identified"]
    assert saved["context"]["asset_tag"] == "EQ-AB12CD34"


@pytest.mark.asyncio
async def test_start_with_asset_deeplink_unknown_tag_is_graceful(monkeypatch, engine):
    import start_command as mod

    monkeypatch.setattr(mod, "_lookup_asset_by_tag", lambda tag, telegram_user_id: None)
    diag_engine = MagicMock()

    update, context = _mock("555", ["asset_DOES-NOT-EXIST"])
    await mod.start_command(
        update,
        context,
        engine=engine,
        diagnostic_engine=diag_engine,
    )
    msg = update.message.reply_text.call_args[0][0]
    assert "DOES-NOT-EXIST" in msg
    assert "couldn't find" in msg.lower() or "not find" in msg.lower()


@pytest.mark.asyncio
async def test_start_with_consumed_token_rejects(engine):
    from start_command import start_command  # noqa: F401

    token = mint_invite(engine, tenant_id="t_acme", email="dup@acme.com", minted_by="42")
    update1, context1 = _mock("100", [token])
    await start_command(update1, context1, engine=engine)
    update2, context2 = _mock("101", [token])
    await start_command(update2, context2, engine=engine)
    msg = update2.message.reply_text.call_args[0][0]
    assert "already" in msg.lower()
