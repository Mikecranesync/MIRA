"""Unit tests for the troubleshooting-session lifecycle (Phase 7, #1659).

Covers the pure channel mapping and the fail-open contract: every public
entry point must degrade to a no-op (None / False / 0) when NeonDB is not
configured or required args are missing — a DB blip must never raise into the
bot reply path. The actual SQL round-trip is an integration concern (needs a
live `troubleshooting_sessions` table) and is intentionally out of scope here.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

import troubleshooting_session as ts  # noqa: E402


def test_map_channel_known_and_unknown():
    assert ts._map_channel("telegram") == "telegram"
    assert ts._map_channel("slack") == "slack"
    assert ts._map_channel("web") == "web"
    # Anything the table's CHECK constraint doesn't allow collapses to 'other'.
    assert ts._map_channel("tablet") == "other"
    assert ts._map_channel("") == "other"
    assert ts._map_channel("ignition") == "other"


async def test_open_session_fail_open_without_db(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    sid = await ts.open_session_coro(
        tenant_id="11111111-1111-1111-1111-111111111111",
        asset_id=None,
        component_id=None,
        channel="telegram",
        metadata={"asset_label": "Rockwell, PowerFlex 525"},
    )
    assert sid is None


async def test_open_session_requires_tenant(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://unused")
    sid = await ts.open_session_coro(
        tenant_id="",
        asset_id=None,
        component_id=None,
        channel="web",
    )
    assert sid is None


async def test_append_turn_fail_open(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    ok = await ts.append_turn_coro(
        session_id="22222222-2222-2222-2222-222222222222",
        tenant_id="11111111-1111-1111-1111-111111111111",
        role="user",
        content="conveyor stopped",
    )
    assert ok is False
    # Missing session_id also degrades to False even with a URL set.
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://unused")
    assert (
        await ts.append_turn_coro(session_id="", tenant_id="t", role="user", content="x") is False
    )


async def test_close_session_fail_open(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert (
        await ts.close_session_coro(
            session_id="22222222-2222-2222-2222-222222222222",
            tenant_id="11111111-1111-1111-1111-111111111111",
            reason="resolved",
        )
        is False
    )


def test_close_idle_sessions_fail_open_without_db(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert ts.close_idle_sessions(cutoff_hours=24) == 0
