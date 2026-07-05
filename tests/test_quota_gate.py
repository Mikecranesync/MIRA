"""Plan/quota gate tests (audit issue #1) — offline, mock DB.

Covers the quota module contract (flag-gated, fail-open) and the Supervisor
wiring (blocked turn returns the technician-facing message BEFORE inference).
No network, no NeonDB, no LLM.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, "mira-bots")

import pytest

from shared import quota
from shared.engine import Supervisor
from shared.quota import QUOTA_BLOCK_MESSAGE, check_quota

FAKE_DB_URL = "postgresql://user:pass@fake-neon.example/db"


# ── quota module contract ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_flag_off_allows_without_db_call():
    """ENFORCE_PLAN_QUOTA off (default) → allow, zero DB calls."""
    sync = MagicMock()
    with (
        patch.dict(
            "os.environ",
            {"ENFORCE_PLAN_QUOTA": "0", "NEON_DATABASE_URL": FAKE_DB_URL},
        ),
        patch.object(quota, "_check_quota_sync", sync),
    ):
        assert await check_quota("tenant-uuid") == (True, "")
    sync.assert_not_called()


@pytest.mark.asyncio
async def test_flag_unset_defaults_off():
    """Flag absent entirely → same as off: allow, zero DB calls."""
    sync = MagicMock()
    env = {"NEON_DATABASE_URL": FAKE_DB_URL}
    with patch.dict("os.environ", env, clear=False):
        import os

        os.environ.pop("ENFORCE_PLAN_QUOTA", None)
        with patch.object(quota, "_check_quota_sync", sync):
            assert await check_quota("tenant-uuid") == (True, "")
    sync.assert_not_called()


@pytest.mark.asyncio
async def test_over_quota_blocks():
    """Flag on + tier query says over-limit → (False, reason)."""
    reason = "Daily limit of 50 requests reached for tier 'free'"
    with (
        patch.dict(
            "os.environ",
            {"ENFORCE_PLAN_QUOTA": "1", "NEON_DATABASE_URL": FAKE_DB_URL},
        ),
        patch.object(quota, "_check_quota_sync", MagicMock(return_value=(False, reason))),
    ):
        allowed, got = await check_quota("tenant-uuid")
    assert allowed is False
    assert got == reason


@pytest.mark.asyncio
async def test_db_error_fails_open():
    """Flag on + DB blows up → allow (fail-open), never raises."""
    with (
        patch.dict(
            "os.environ",
            {"ENFORCE_PLAN_QUOTA": "1", "NEON_DATABASE_URL": FAKE_DB_URL},
        ),
        patch.object(quota, "_check_quota_sync", MagicMock(side_effect=RuntimeError("neon down"))),
    ):
        assert await check_quota("tenant-uuid") == (True, "")


@pytest.mark.asyncio
async def test_missing_tenant_fails_open_without_db_call():
    """Flag on + no tenant_id → allow, zero DB calls."""
    sync = MagicMock()
    with (
        patch.dict(
            "os.environ",
            {"ENFORCE_PLAN_QUOTA": "1", "NEON_DATABASE_URL": FAKE_DB_URL},
        ),
        patch.object(quota, "_check_quota_sync", sync),
    ):
        assert await check_quota(None) == (True, "")
        assert await check_quota("") == (True, "")
    sync.assert_not_called()


@pytest.mark.asyncio
async def test_missing_db_url_fails_open_without_db_call():
    """Flag on + NEON_DATABASE_URL unset → allow, zero DB calls."""
    sync = MagicMock()
    with patch.dict("os.environ", {"ENFORCE_PLAN_QUOTA": "1", "NEON_DATABASE_URL": ""}):
        with patch.object(quota, "_check_quota_sync", sync):
            assert await check_quota("tenant-uuid") == (True, "")
    sync.assert_not_called()


# ── Supervisor wiring ───────────────────────────────────────────────────────


def _make_sv(db_path: str) -> Supervisor:
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
                api_key="test",
                collection_id="test",
                tenant_id="tenant-uuid",
            )


@pytest.mark.asyncio
async def test_supervisor_blocked_turn_returns_message_before_inference(tmp_path):
    """Over-quota tenant → block message; process_full (inference) never runs."""
    sv = _make_sv(str(tmp_path / "test.db"))
    with (
        patch(
            "shared.engine.check_quota",
            AsyncMock(return_value=(False, "Daily limit of 50 requests reached")),
        ),
        patch.object(sv, "process_full", AsyncMock()) as pf,
    ):
        reply = await sv.process("chat-1", "why is the conveyor stopped?")
    assert reply == QUOTA_BLOCK_MESSAGE
    pf.assert_not_called()


@pytest.mark.asyncio
async def test_supervisor_allowed_turn_proceeds_to_engine(tmp_path):
    """Quota allows (the flag-off default) → normal engine path runs."""
    sv = _make_sv(str(tmp_path / "test.db"))
    result = {"reply": "hello [Source: manual p.1]", "next_state": "IDLE"}
    with (
        patch("shared.engine.check_quota", AsyncMock(return_value=(True, ""))) as cq,
        patch.object(sv, "process_full", AsyncMock(return_value=result)) as pf,
        patch.object(sv, "_apply_quality_gate", AsyncMock(return_value=result["reply"])),
        patch.object(sv, "_enforce_citation_rewrite", AsyncMock(return_value=result["reply"])),
        patch.object(sv, "_log_interaction", MagicMock()),
        patch.object(sv, "_schedule_decision_trace", MagicMock()),
        patch.object(sv, "_schedule_session_lifecycle", MagicMock()),
    ):
        reply = await sv.process("chat-1", "hi there")
    cq.assert_awaited_once_with("tenant-uuid")
    pf.assert_awaited_once()
    assert reply == result["reply"]
