"""Tests for cross-session equipment memory (GH #329).

Unit tests:
  - save / load / TTL expiry / clear via SQLite stand-in for NeonDB
Integration test:
  - Session 1 identifies GS10 → session 2 starts → GS10 pre-loaded
"""

from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — same pattern as test_session_context.py
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))


def _install_stubs() -> None:
    """Inject lightweight stubs for packages not available in the test env."""
    if "pytesseract" not in sys.modules:
        pt = types.ModuleType("pytesseract")
        pt.image_to_string = lambda img, config="": ""  # type: ignore[attr-defined]
        sys.modules["pytesseract"] = pt

    for mod_path in ("PIL", "PIL.Image"):
        if mod_path not in sys.modules:
            sys.modules[mod_path] = types.ModuleType(mod_path)
    if not hasattr(sys.modules["PIL.Image"], "open"):
        sys.modules["PIL.Image"].open = lambda *a, **kw: MagicMock()  # type: ignore[attr-defined]

    if "langfuse" not in sys.modules:
        lf = types.ModuleType("langfuse")
        sys.modules["langfuse"] = lf

    pil_mod = sys.modules.get("PIL")
    if pil_mod is not None and not hasattr(pil_mod, "Image"):
        pil_mod.Image = sys.modules["PIL.Image"]  # type: ignore[attr-defined]


_install_stubs()

import os  # noqa: E402

os.environ.setdefault("MIRA_DB_PATH", ":memory:")

with patch("sqlite3.connect"):
    from shared.engine import Supervisor  # noqa: F401
    from shared import session_memory  # noqa: F401

# ---------------------------------------------------------------------------
# Fixtures — use SQLite via SQLAlchemy to simulate NeonDB schema
# ---------------------------------------------------------------------------


@pytest.fixture()
def mem_db(tmp_path):
    """Create a SQLite database with the user_asset_sessions schema
    and patch session_memory._get_engine to use it."""
    from sqlalchemy import create_engine
    from sqlalchemy import text
    from sqlalchemy.pool import NullPool

    db_path = str(tmp_path / "session_memory.db")

    engine = create_engine(f"sqlite:///{db_path}", poolclass=NullPool)
    with engine.connect() as conn:
        conn.execute(
            text(
                """\
                CREATE TABLE IF NOT EXISTS user_asset_sessions (
                    chat_id          TEXT PRIMARY KEY,
                    asset_id         TEXT NOT NULL,
                    open_wo_id       TEXT,
                    last_seen_fault  TEXT,
                    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )"""
            )
        )
        conn.commit()

    with patch.object(session_memory, "_get_engine", return_value=engine):
        yield engine


# ---------------------------------------------------------------------------
# Unit tests — session_memory module
# ---------------------------------------------------------------------------

_CHAT = "unit-test-42"


class TestSaveAndLoad:
    def test_save_and_load_round_trip(self, mem_db):
        assert session_memory.save_session(_CHAT, "GS10 VFD")
        row = session_memory.load_session(_CHAT)
        assert row is not None
        assert row["chat_id"] == _CHAT
        assert row["asset_id"] == "GS10 VFD"
        assert row["open_wo_id"] is None
        assert row["last_seen_fault"] is None

    def test_save_with_all_fields(self, mem_db):
        assert session_memory.save_session(
            _CHAT, "PowerFlex 40", open_wo_id="WO-1234", last_seen_fault="OC1"
        )
        row = session_memory.load_session(_CHAT)
        assert row["asset_id"] == "PowerFlex 40"
        assert row["open_wo_id"] == "WO-1234"
        assert row["last_seen_fault"] == "OC1"

    def test_upsert_overwrites(self, mem_db):
        session_memory.save_session(_CHAT, "GS10")
        session_memory.save_session(_CHAT, "GS20", last_seen_fault="F002")
        row = session_memory.load_session(_CHAT)
        assert row["asset_id"] == "GS20"
        assert row["last_seen_fault"] == "F002"

    def test_load_nonexistent_returns_none(self, mem_db):
        assert session_memory.load_session("no-such-chat") is None

    def test_clear_session(self, mem_db):
        session_memory.save_session(_CHAT, "GS10")
        assert session_memory.clear_session(_CHAT)
        assert session_memory.load_session(_CHAT) is None


class TestTTL:
    def test_expired_session_returns_none(self, mem_db):
        """Sessions older than SESSION_TTL_HOURS are expired and deleted."""
        from sqlalchemy import text

        session_memory.save_session(_CHAT, "GS10")

        # Manually backdate the updated_at column
        old_ts = datetime.now(timezone.utc) - timedelta(hours=73)
        with mem_db.connect() as conn:
            conn.execute(
                text("UPDATE user_asset_sessions SET updated_at = :ts WHERE chat_id = :cid"),
                {"ts": old_ts.isoformat(), "cid": _CHAT},
            )
            conn.commit()

        assert session_memory.load_session(_CHAT) is None

    def test_fresh_session_not_expired(self, mem_db):
        """Sessions within TTL are returned normally."""
        session_memory.save_session(_CHAT, "GS10")
        assert session_memory.load_session(_CHAT) is not None


class TestGracefulFailure:
    def test_no_engine_returns_none(self):
        """When NEON_DATABASE_URL is unset, all ops return None/False gracefully."""
        with patch.object(session_memory, "_get_engine", return_value=None):
            assert session_memory.load_session(_CHAT) is None
            assert session_memory.save_session(_CHAT, "X") is False
            assert session_memory.clear_session(_CHAT) is False


# ---------------------------------------------------------------------------
# Integration test — Supervisor cross-session restore via _load_state
# ---------------------------------------------------------------------------

_TENANT_ID = "tenant-test-0001"


def _make_supervisor(tmp_path) -> Supervisor:
    db_path = ":memory:"
    with patch("sqlite3.connect"):
        sup = Supervisor(
            db_path=db_path,
            openwebui_url="http://mock-openwebui:8080",
            api_key="mock-api-key",
            collection_id="mock-collection",
            vision_model="qwen2.5vl:7b",
            tenant_id=_TENANT_ID,
            mcp_base_url="http://mock-mcp:8001",
            mcp_api_key="mock-mcp-key",
            web_base_url="http://mock-web:3000",
        )
    sup.db_path = str(tmp_path / "mira.db")
    sup._ensure_table()
    return sup


@pytest.mark.asyncio
async def test_cross_session_asset_restored(tmp_path, mem_db):
    """Session 1 identifies GS10 → session 2 starts → GS10 pre-loaded.

    This is the core acceptance criterion from GH #329.  We test the
    Supervisor.process_full code path that reads session_memory on IDLE state.
    """
    chat_id = "cross-session-test-99"
    supervisor = _make_supervisor(tmp_path)

    # --- Session 1: simulate asset identification by writing directly ---
    # (The vision worker integration is tested elsewhere; here we focus on
    # the cross-session persistence round-trip.)
    state = supervisor._load_state(chat_id)
    state["state"] = "Q1"
    state["asset_identified"] = "AutomationDirect GS10 VFD"
    state["context"]["session_context"] = {"equipment_type": "GS10 VFD"}
    supervisor._save_state(chat_id, state)

    # Persist to NeonDB (via our SQLite stand-in)
    session_memory.save_session(chat_id, "AutomationDirect GS10 VFD")

    # --- Session 2: reset (simulating Telegram session end) ---
    supervisor.reset(chat_id)
    state = supervisor._load_state(chat_id)
    assert state["state"] == "IDLE"
    assert state.get("asset_identified") is None  # local SQLite state is gone

    # Now call process_full — the session_memory restore runs before intent handling
    with (
        patch("shared.engine.resolve_tenant", return_value=_TENANT_ID),
        patch("shared.engine.tl_trace") as mock_trace,
        patch("shared.engine.tl_flush"),
        patch("shared.engine.classify_intent", return_value="diagnosis"),
        patch("shared.engine.detect_session_followup", return_value=False),
        patch("shared.engine.kb_has_coverage", return_value=(True, "has_data")),
        patch.object(supervisor.rag, "process", new_callable=AsyncMock, return_value=(
            '{"reply": "The GS10 VFD commonly shows OC (overcurrent) faults.",'
            ' "next_state": "DIAGNOSIS", "confidence": "high"}'
        )),
    ):
        mock_trace.return_value = MagicMock(id="trace-2")
        result = await supervisor.process_full(chat_id, "What fault codes can this throw?")

    assert result["reply"]  # got a reply

    # Verify the asset was restored from NeonDB into session state
    state = supervisor._load_state(chat_id)
    assert state.get("asset_identified") is not None
    assert "GS10" in state["asset_identified"]
    ctx = state.get("context", {})
    sc = ctx.get("session_context", {})
    assert sc.get("restored_from_memory") is True


@pytest.mark.asyncio
async def test_same_chat_id_two_sessions_preserves_context(tmp_path, mem_db):
    """Unit test: simulate 2 sessions with same chat_id, assert asset context preserved."""
    chat_id = "two-session-unit-77"

    # Session 1: save asset context
    session_memory.save_session(chat_id, "GS10 VFD", last_seen_fault="OC1")

    # Session 2: load and verify
    row = session_memory.load_session(chat_id)
    assert row is not None
    assert row["asset_id"] == "GS10 VFD"
    assert row["last_seen_fault"] == "OC1"


# ---------------------------------------------------------------------------
# Supervisor._advance_state fault_category save path test
# ---------------------------------------------------------------------------


def test_advance_state_saves_fault_category(monkeypatch):
    """engine._advance_state persists fault_category via session_memory.save_session."""
    # Stub out heavy deps so Supervisor can import cleanly.
    _install_stubs()
    with patch("sqlite3.connect"):
        from shared.engine import Supervisor

    sup = Supervisor.__new__(Supervisor)  # skip __init__ — we only test _advance_state

    calls = []
    monkeypatch.setattr(
        "shared.engine.save_session",
        lambda chat_id, asset_id, **kw: calls.append((chat_id, asset_id, kw)) or True,
    )

    state = {
        "chat_id": "tg:42",
        "state": "DIAGNOSIS",
        "context": {"session_context": {}},
        "asset_identified": "Allen-Bradley PowerFlex 525",
        "fault_category": None,
        "exchange_count": 3,
        "final_state": None,
    }
    # Parsed dict with reply containing "electrical" keyword
    # _advance_state extracts reply_lower and searches for fault category keywords
    parsed = {"reply": "The drive shows electrical faults. Check for phase loss.", "next_state": "DIAGNOSIS"}

    result = sup._advance_state(state, parsed)

    assert result["fault_category"] == "power"  # "electrical" normalizes to "power"
    assert len(calls) == 1
    assert calls[0][0] == "tg:42"
    assert calls[0][1] == "Allen-Bradley PowerFlex 525"
    assert calls[0][2].get("last_seen_fault") == "power"
