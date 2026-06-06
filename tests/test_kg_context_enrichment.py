"""KG maintenance-context enrichment for the diagnosis path.

The engine fetches knowledge-graph maintenance context for the confirmed asset
and injects it into the RAG prompt. Best-effort + flag-gated
(MIRA_KG_CONTEXT_ENABLED, default off) + auth-gated (INTERNAL_KG_API_KEY): any
miss returns "" so the diagnosis path is unaffected when the hub/KG is absent.
Offline — the hub HTTP call is mocked.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, patch

import pytest
from shared.engine import Supervisor

# A representative maintenanceContext payload (camelCase, as the hub returns it).
_MC = {
    "equipment": {"name": "PowerFlex 525 VFD", "entityId": "eq-1"},
    "hierarchy": {
        "plant": {"name": "Plant A"},
        "area": {"name": "Packaging"},
        "line": {"name": "Line 2"},
    },
    "components": [{"name": "Cooling Fan"}, {"name": "DC Bus Cap"}],
    "recentFaults": [{"code": "F0004", "count": 3}, {"code": "F0007", "count": 1}],
    "recentWorkOrders": [{"name": "Replace fan — WO-1021"}],
    "knownParts": [],
    "manuals": [{"name": "GS10 Manual"}],
    "pmSchedule": [],
    "similarEquipment": [],
    "pmMismatches": [],
}


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
            )


def _state(asset: str | None) -> dict:
    return {"state": "IDLE", "context": {}, "asset_identified": asset, "exchange_count": 0}


# ── _format_kg_context ─────────────────────────────────────────────────────


def test_format_includes_equipment_location_components_faults(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    block = sv._format_kg_context(_MC)
    assert "PowerFlex 525 VFD" in block
    assert "Line 2" in block
    assert "Cooling Fan" in block
    assert "F0004" in block and "F0007" in block
    # labeled so the LLM knows it's graph context, not a citable source chunk
    assert "knowledge graph" in block.lower()


def test_format_empty_or_garbage_returns_empty(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    assert sv._format_kg_context({}) == ""
    assert sv._format_kg_context(None) == ""
    # equipment present but no signal sections -> still yields the equipment line only,
    # never raises
    assert isinstance(sv._format_kg_context({"equipment": {"name": "X"}}), str)


# ── _build_kg_context gating ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_returns_empty_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._KG_CONTEXT_ENABLED", False)
    sv = _make_sv(str(tmp_path / "t.db"))
    assert await sv._build_kg_context(_state("Allen-Bradley, PowerFlex 525"), "tenant-1") == ""


@pytest.mark.asyncio
async def test_build_returns_empty_without_asset_or_tenant(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._KG_CONTEXT_ENABLED", True)
    monkeypatch.setenv("INTERNAL_KG_API_KEY", "k")
    sv = _make_sv(str(tmp_path / "t.db"))
    assert await sv._build_kg_context(_state(None), "tenant-1") == ""
    assert await sv._build_kg_context(_state("Allen-Bradley, PowerFlex 525"), None) == ""


@pytest.mark.asyncio
async def test_build_returns_empty_without_api_key(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._KG_CONTEXT_ENABLED", True)
    monkeypatch.delenv("INTERNAL_KG_API_KEY", raising=False)
    sv = _make_sv(str(tmp_path / "t.db"))
    assert await sv._build_kg_context(_state("Allen-Bradley, PowerFlex 525"), "tenant-1") == ""


@pytest.mark.asyncio
async def test_build_returns_block_on_success(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._KG_CONTEXT_ENABLED", True)
    monkeypatch.setenv("INTERNAL_KG_API_KEY", "k")
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch.object(sv, "_fetch_kg_maintenance_context", new=AsyncMock(return_value=_MC)):
        block = await sv._build_kg_context(_state("Allen-Bradley, PowerFlex 525"), "tenant-1")
    assert "PowerFlex 525 VFD" in block and "F0004" in block


@pytest.mark.asyncio
async def test_build_swallows_fetch_errors(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._KG_CONTEXT_ENABLED", True)
    monkeypatch.setenv("INTERNAL_KG_API_KEY", "k")
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch.object(
        sv, "_fetch_kg_maintenance_context", new=AsyncMock(side_effect=RuntimeError("hub down"))
    ):
        assert await sv._build_kg_context(_state("Allen-Bradley, PowerFlex 525"), "tenant-1") == ""


# ── wiring: _call_rag_with_retry forwards kg_context to RAGWorker.process ───


@pytest.mark.asyncio
async def test_diagnose_path_forwards_kg_context(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    sv.rag.process = AsyncMock(return_value='{"reply": "ok"}')
    sv.rag._last_sources = []
    with patch.object(sv, "_build_kg_context", new=AsyncMock(return_value="SENTINEL_KG_BLOCK")):
        await sv._call_with_correction(
            "why is it faulting", _state("Allen-Bradley, PowerFlex 525"), tenant_id="tenant-1"
        )
    assert sv.rag.process.await_count >= 1
    assert sv.rag.process.await_args.kwargs.get("kg_context") == "SENTINEL_KG_BLOCK"
