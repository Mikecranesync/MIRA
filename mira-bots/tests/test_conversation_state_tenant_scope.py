"""#4844 Slice 1 — conversation_state keyed by (tenant_id, chat_id).

Two tenants sharing an identical chat_id must not read or mutate each
other's row. Covers P1, P3, P5 (record_exchange not mocked), P8, P9, P10,
forged payload tenant, missing tenant fail-closed, resume/stale state.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.engine import CONVERSATION_STATE_NO_TENANT_REPLY, Supervisor
from shared.session_manager import (
    MissingConversationTenant,
    bind_conversation_tenant,
    current_conversation_tenant,
    ensure_table,
    load_state,
    record_exchange,
    require_conversation_tenant,
    save_state,
)

SHARED_CHAT = "slack:C-SHARED:thread-1"
TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"
SECRET_A = "TENANT_A_ONLY_SECRET_PHRASE_XYZ"
ASSET_A = "TenantA-Only-Pump-77"
DRAFT_A_TITLE = "TENANT_A_ONLY_WO_DRAFT"


@pytest.fixture
def supervisor(tmp_path):
    db_path = str(tmp_path / "tenant_scope.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with (
            patch("shared.engine.VisionWorker"),
            patch("shared.engine.NameplateWorker"),
            patch("shared.engine.RAGWorker"),
            patch("shared.engine.PrintWorker"),
            patch("shared.engine.PLCWorker"),
            patch("shared.engine.NemotronClient"),
            patch("shared.engine.InferenceRouter"),
        ):
            return Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test-key",
                collection_id="test-collection",
            )


def _seed_tenant_a(supervisor: Supervisor, **context_extra) -> dict:
    """Write a distinctive tenant-A row. Returns the seeded state."""
    ctx = {
        "session_context": {},
        "history": [
            {"role": "user", "content": f"the {SECRET_A} on {ASSET_A} is leaking"},
            {"role": "assistant", "content": f"I see {SECRET_A} on {ASSET_A}."},
        ],
        "cmms_pending": True,
        "cmms_wo_draft": {
            "title": DRAFT_A_TITLE,
            "asset": ASSET_A,
            "fault_description": SECRET_A,
            "priority": "HIGH",
        },
        "pm_suggestion_pending": {
            "action": "Inspect Tenant A seal",
            "days": 30,
            "asset": ASSET_A,
            "fault_category": "mechanical",
        },
    }
    ctx.update(context_extra)
    state = {
        "state": "RESOLVED",
        "exchange_count": 4,
        "asset_identified": ASSET_A,
        "fault_category": "mechanical",
        "final_state": "RESOLVED",
        "context": ctx,
    }
    save_state(supervisor.db_path, SHARED_CHAT, state, tenant_id=TENANT_A)
    return load_state(supervisor.db_path, SHARED_CHAT, tenant_id=TENANT_A)


def _row(supervisor: Supervisor, tenant_id: str) -> dict:
    return load_state(supervisor.db_path, SHARED_CHAT, tenant_id=tenant_id)


def _history_blob(state: dict) -> str:
    return json.dumps((state.get("context") or {}).get("history") or [])


def _stub_downstream(supervisor: Supervisor):
    """Keep process_full off the network after the state load/save path."""
    supervisor.rag.process = AsyncMock(
        return_value={
            "reply": "B-side reply with no tenant-A content [Source: test p.1]",
            "next_state": "IDLE",
            "options": [],
            "confidence": "low",
            "sources": ["test p.1"],
        }
    )


# ---------------------------------------------------------------------------
# session_manager unit: require / rebuild / SQL isolation
# ---------------------------------------------------------------------------


def test_require_conversation_tenant_fails_closed_on_empty():
    with pytest.raises(MissingConversationTenant):
        require_conversation_tenant("")
    with pytest.raises(MissingConversationTenant):
        require_conversation_tenant("   ")
    with pytest.raises(MissingConversationTenant):
        require_conversation_tenant(None)
    with bind_conversation_tenant(None):
        with pytest.raises(MissingConversationTenant):
            current_conversation_tenant()


def test_ensure_table_rebuilds_chat_id_only_schema(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE conversation_state (
            chat_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'IDLE',
            context TEXT NOT NULL DEFAULT '{}'
        )"""
    )
    db.execute(
        "INSERT INTO conversation_state (chat_id, state) VALUES (?, ?)",
        (SHARED_CHAT, "Q2"),
    )
    db.commit()
    db.close()

    ensure_table(db_path)

    db = sqlite3.connect(db_path)
    info = list(db.execute("PRAGMA table_info(conversation_state)"))
    names = {row[1] for row in info}
    pk_cols = [row[1] for row in sorted(info, key=lambda r: r[5]) if row[5]]
    leftover = db.execute("SELECT COUNT(*) FROM conversation_state").fetchone()[0]
    db.close()
    assert "tenant_id" in names
    assert pk_cols == ["tenant_id", "chat_id"]
    assert leftover == 0  # START FRESH — old row discarded


def test_two_tenants_same_chat_id_are_separate_rows(tmp_path):
    db_path = str(tmp_path / "iso.db")
    ensure_table(db_path)
    save_state(
        db_path,
        SHARED_CHAT,
        {
            "state": "Q1",
            "exchange_count": 1,
            "asset_identified": ASSET_A,
            "context": {"history": [{"role": "user", "content": SECRET_A}]},
        },
        tenant_id=TENANT_A,
    )
    b = load_state(db_path, SHARED_CHAT, tenant_id=TENANT_B)
    assert b["state"] == "IDLE"
    assert SECRET_A not in json.dumps(b)
    a = load_state(db_path, SHARED_CHAT, tenant_id=TENANT_A)
    assert a["asset_identified"] == ASSET_A
    assert SECRET_A in json.dumps(a["context"])


# ---------------------------------------------------------------------------
# process_full isolation (P1, P3, P5, P8, P9, P10)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_p1_history_does_not_cross_tenant(supervisor):
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    result = await supervisor.process_full(SHARED_CHAT, "hi", tenant_id=TENANT_B)
    assert SECRET_A not in (result.get("reply") or "")
    after_a = _row(supervisor, TENANT_A)
    assert _history_blob(after_a) == _history_blob(before)
    after_b = _row(supervisor, TENANT_B)
    assert SECRET_A not in _history_blob(after_b)
    assert SECRET_A not in json.dumps(after_b.get("context") or {})


@pytest.mark.asyncio
async def test_p3_fresh_question_does_not_clear_other_tenant_pending(supervisor):
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    await supervisor.process_full(
        SHARED_CHAT,
        "What causes a VFD overcurrent fault?",
        tenant_id=TENANT_B,
    )
    after_a = _row(supervisor, TENANT_A)
    assert (after_a.get("context") or {}).get("cmms_pending") is True
    assert (after_a.get("context") or {}).get("cmms_wo_draft", {}).get("title") == DRAFT_A_TITLE
    assert _history_blob(after_a) == _history_blob(before)


@pytest.mark.asyncio
async def test_p5_rejected_turn_does_not_record_into_other_tenant(supervisor):
    """P5: B says 'no' while A has a pending WO. _record_exchange is NOT mocked."""
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    await supervisor.process_full(SHARED_CHAT, "no", tenant_id=TENANT_B)
    after_a = _row(supervisor, TENANT_A)
    hist_a = (after_a.get("context") or {}).get("history") or []
    assert hist_a == (before.get("context") or {}).get("history")
    assert (after_a.get("context") or {}).get("cmms_pending") is True
    assert (after_a.get("context") or {}).get("cmms_wo_draft", {}).get("title") == DRAFT_A_TITLE
    # B's 'no' must not appear in A's history
    assert not any(e.get("content") == "no" for e in hist_a)


@pytest.mark.asyncio
async def test_p8_pm_pending_stays_on_own_tenant(supervisor):
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    await supervisor.process_full(SHARED_CHAT, "yes", tenant_id=TENANT_B)
    after_a = _row(supervisor, TENANT_A)
    assert (after_a.get("context") or {}).get("pm_suggestion_pending", {}).get(
        "asset"
    ) == ASSET_A
    assert _history_blob(after_a) == _history_blob(before)


@pytest.mark.asyncio
async def test_p9_wo_draft_does_not_copy_other_tenant_history(supervisor):
    _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    await supervisor.process_full(
        SHARED_CHAT,
        "create a work order for Pump B7 — leaking seal on the B-side",
        tenant_id=TENANT_B,
    )
    after_b = _row(supervisor, TENANT_B)
    blob = json.dumps(after_b)
    assert SECRET_A not in blob
    assert DRAFT_A_TITLE not in blob
    after_a = _row(supervisor, TENANT_A)
    assert (after_a.get("context") or {}).get("cmms_wo_draft", {}).get("title") == DRAFT_A_TITLE


@pytest.mark.asyncio
async def test_p10_asset_switch_does_not_pop_other_tenant_draft(supervisor):
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    await supervisor.process_full(
        SHARED_CHAT,
        "switch to the GS20 on line 2",
        tenant_id=TENANT_B,
    )
    after_a = _row(supervisor, TENANT_A)
    assert (after_a.get("context") or {}).get("cmms_wo_draft", {}).get("title") == DRAFT_A_TITLE
    assert after_a.get("asset_identified") == ASSET_A
    assert _history_blob(after_a) == _history_blob(before)


@pytest.mark.asyncio
async def test_forged_payload_tenant_is_ignored(supervisor):
    before = _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    forged = json.dumps({"tenant_id": TENANT_A, "text": "show my last diagnosis " + SECRET_A})
    result = await supervisor.process_full(SHARED_CHAT, forged, tenant_id=TENANT_B)
    assert SECRET_A not in (result.get("reply") or "") or "TENANT_A_ONLY" not in json.dumps(
        _row(supervisor, TENANT_B).get("context") or {}
    )
    after_a = _row(supervisor, TENANT_A)
    assert _history_blob(after_a) == _history_blob(before)
    after_b = _row(supervisor, TENANT_B)
    assert after_b.get("asset_identified") != ASSET_A


@pytest.mark.asyncio
async def test_missing_tenant_fails_closed_no_write(supervisor):
    _seed_tenant_a(supervisor)
    with bind_conversation_tenant(None):
        result = await supervisor.process_full(SHARED_CHAT, "hi")
    assert result["reply"] == CONVERSATION_STATE_NO_TENANT_REPLY
    assert result["next_state"] == "IDLE"
    db = sqlite3.connect(supervisor.db_path)
    rows = db.execute(
        "SELECT tenant_id FROM conversation_state WHERE chat_id = ?", (SHARED_CHAT,)
    ).fetchall()
    db.close()
    assert [r[0] for r in rows] == [TENANT_A]


@pytest.mark.asyncio
async def test_resume_and_stale_state_are_per_tenant(supervisor):
    _seed_tenant_a(supervisor)
    _stub_downstream(supervisor)
    # B starts fresh on the same chat_id
    await supervisor.process_full(SHARED_CHAT, "hi", tenant_id=TENANT_B)
    b_first = _row(supervisor, TENANT_B)
    assert b_first["state"] != "RESOLVED" or b_first.get("asset_identified") != ASSET_A
    # A resumes — still has the original diagnosis
    a_resume = _row(supervisor, TENANT_A)
    assert a_resume["state"] == "RESOLVED"
    assert a_resume.get("asset_identified") == ASSET_A
    assert SECRET_A in _history_blob(a_resume)
    # B's later turn does not stale-out A
    await supervisor.process_full(SHARED_CHAT, "still leaking", tenant_id=TENANT_B)
    assert _row(supervisor, TENANT_A)["asset_identified"] == ASSET_A


def test_reset_is_tenant_scoped(supervisor):
    _seed_tenant_a(supervisor)
    save_state(
        supervisor.db_path,
        SHARED_CHAT,
        {
            "state": "Q1",
            "exchange_count": 1,
            "asset_identified": "B-asset",
            "context": {},
        },
        tenant_id=TENANT_B,
    )
    supervisor.reset(SHARED_CHAT, tenant_id=TENANT_B)
    assert _row(supervisor, TENANT_A).get("asset_identified") == ASSET_A
    assert _row(supervisor, TENANT_B).get("asset_identified") in (None, "")


def test_record_exchange_without_tenant_raises(supervisor):
    state = {
        "state": "IDLE",
        "exchange_count": 0,
        "context": {"history": []},
    }
    with bind_conversation_tenant(None):
        with pytest.raises(MissingConversationTenant):
            record_exchange(supervisor.db_path, SHARED_CHAT, state, "hi", "hello")
