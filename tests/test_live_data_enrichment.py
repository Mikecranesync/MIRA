"""Live equipment-status enrichment for the diagnosis path.

The engine pulls mira-fault-detective's /current_fault and injects a
[LIVE EQUIPMENT STATUS] block. Best-effort + flag-gated
(MIRA_LIVE_DATA_ENABLED, default off): any miss returns "". Offline — the HTTP
call is mocked.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, patch

import pytest
from shared.engine import Supervisor

_FAULT = {
    "asset_prefix": "demo/cell1/conveyor/cv101",
    "fault": "photoeye_blocked",
    "confidence": 0.82,
    "evidence": [],
    "affected_components": ["PE-101"],
    "recommended_first_check": "Inspect PE-101 lens for debris",
    "safety_note": "De-energize before clearing the jam",
    "ts": 123.0,
}
_OK = {"asset_prefix": "demo/cell1/conveyor/cv101", "fault": "ok", "confidence": 1.0}


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
                db_path=db_path, openwebui_url="http://x", api_key="t", collection_id="c"
            )


# ── _format_live_data ──────────────────────────────────────────────────────


def test_format_active_fault(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    block = sv._format_live_data(_FAULT)
    assert "LIVE EQUIPMENT STATUS" in block
    assert "photoeye_blocked" in block and "82%" in block
    assert "PE-101" in block
    assert "Inspect PE-101 lens" in block
    assert "De-energize" in block


def test_format_ok_and_garbage(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    ok = sv._format_live_data(_OK)
    assert "No active fault" in ok and "cv101" in ok
    assert sv._format_live_data(None) == ""
    assert sv._format_live_data("nope") == ""


# ── _build_live_data_context gating ────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_empty_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._LIVE_DATA_ENABLED", False)
    sv = _make_sv(str(tmp_path / "t.db"))
    assert await sv._build_live_data_context({"state": "IDLE"}) == ""


@pytest.mark.asyncio
async def test_build_block_on_success(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._LIVE_DATA_ENABLED", True)
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch.object(sv, "_fetch_live_status", new=AsyncMock(return_value=_FAULT)):
        block = await sv._build_live_data_context({"state": "IDLE"})
    assert "photoeye_blocked" in block


@pytest.mark.asyncio
async def test_build_swallows_errors(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._LIVE_DATA_ENABLED", True)
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch.object(
        sv, "_fetch_live_status", new=AsyncMock(side_effect=RuntimeError("down"))
    ):
        assert await sv._build_live_data_context({"state": "IDLE"}) == ""
