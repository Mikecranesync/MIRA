"""Work-order-history evidence for the diagnosis path (audit issue #10).

The engine recalls recent CMMS work orders (Hub NeonDB work_orders JOIN
cmms_equipment) for the CONFIRMED asset and injects them as a citable evidence
block. Flag-gated (ENABLE_WO_EVIDENCE, default off) and fail-safe: any miss
(flag off, no tenant/asset, DB error) returns "" and the diagnosis path is
untouched. Offline -- psycopg2 and the recall coroutine are mocked.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared import wo_evidence
from shared.engine import Supervisor

_ROWS = [
    (
        "MIRA-20260601-AB12",
        "GS10 VFD trips OC on start",
        "closed",
        "high",
        datetime(2026, 6, 1, 14, 30, tzinfo=timezone.utc),
        datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
        "Trips overcurrent immediately on start command",
        "Replaced cooling fan; cleared F0004",
    ),
    (
        "MIRA-20260520-CD34",
        "Conveyor motor overtemp",
        "open",
        "medium",
        datetime(2026, 5, 20, 8, 0, tzinfo=timezone.utc),
        None,
        "Motor housing hot to touch",
        None,
    ),
]

_WOS = [dict(zip(wo_evidence._WO_FIELDS, r)) for r in _ROWS]


def _mock_conn(rows):
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = rows
    conn.cursor.return_value.__enter__.return_value = cur
    return conn, cur


# ── shared.wo_evidence.recall_work_orders (mock DB) ────────────────────────


@pytest.mark.asyncio
async def test_recall_maps_rows_to_dicts(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://test")
    conn, cur = _mock_conn(_ROWS)
    with patch("shared.wo_evidence.psycopg2.connect", return_value=conn):
        wos = await wo_evidence.recall_work_orders("tenant-1", "PowerFlex 525", limit=5)
    assert len(wos) == 2
    assert wos[0]["work_order_number"] == "MIRA-20260601-AB12"
    assert wos[0]["resolution"] == "Replaced cooling fan; cleared F0004"
    assert wos[1]["status"] == "open"
    # tenant is bound as a parameter (both wo + eq sides), never interpolated
    params = cur.execute.call_args.args[1]
    assert params[0] == "tenant-1" and params[1] == "tenant-1"
    assert params[-1] == 5


@pytest.mark.asyncio
async def test_recall_includes_uns_prefix_param_when_given(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://test")
    conn, cur = _mock_conn([])
    with patch("shared.wo_evidence.psycopg2.connect", return_value=conn):
        await wo_evidence.recall_work_orders(
            "tenant-1", "PowerFlex 525", uns_path="enterprise.plant_a.line_2", limit=5
        )
    sql, params = cur.execute.call_args.args
    assert "uns_path <@" in sql
    assert "enterprise.plant_a.line_2" in params


@pytest.mark.asyncio
async def test_recall_empty_without_db_url(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert await wo_evidence.recall_work_orders("tenant-1", "PowerFlex 525") == []


@pytest.mark.asyncio
async def test_recall_swallows_db_errors(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://test")
    with patch(
        "shared.wo_evidence.psycopg2.connect", side_effect=RuntimeError("neon down")
    ):
        assert await wo_evidence.recall_work_orders("tenant-1", "PowerFlex 525") == []


@pytest.mark.asyncio
async def test_recall_empty_without_tenant_or_asset(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://test")
    assert await wo_evidence.recall_work_orders("", "PowerFlex 525") == []
    assert await wo_evidence.recall_work_orders("tenant-1", "") == []


# ── engine wiring ──────────────────────────────────────────────────────────


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


# _format_wo_evidence


def test_format_renders_citable_lines(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    block = sv._format_wo_evidence(_WOS)
    assert "WORK ORDER HISTORY" in block and "citable" in block
    assert "[WO MIRA-20260601-AB12] 2026-06-01 (closed)" in block
    assert "Replaced cooling fan; cleared F0004" in block
    # open WO with no resolution falls back to fault_description
    assert "[WO MIRA-20260520-CD34] 2026-05-20 (open)" in block
    assert "Motor housing hot to touch" in block


def test_format_empty_or_garbage_returns_empty(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    assert sv._format_wo_evidence([]) == ""
    assert sv._format_wo_evidence([{"no": "fields"}, "junk"]) == ""


# _build_wo_evidence_context gating


@pytest.mark.asyncio
async def test_build_returns_empty_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._WO_EVIDENCE_ENABLED", False)
    sv = _make_sv(str(tmp_path / "t.db"))
    # recall would blow up if called -- flag off must never reach it
    with patch(
        "shared.engine._recall_work_orders",
        new=AsyncMock(side_effect=AssertionError("must not be called")),
    ):
        assert (
            await sv._build_wo_evidence_context(
                _state("Allen-Bradley, PowerFlex 525"), "tenant-1"
            )
            == ""
        )


@pytest.mark.asyncio
async def test_build_returns_empty_without_asset_or_tenant(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._WO_EVIDENCE_ENABLED", True)
    sv = _make_sv(str(tmp_path / "t.db"))
    assert await sv._build_wo_evidence_context(_state(None), "tenant-1") == ""
    assert (
        await sv._build_wo_evidence_context(_state("Allen-Bradley, PowerFlex 525"), None) == ""
    )


@pytest.mark.asyncio
async def test_build_returns_block_on_success(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._WO_EVIDENCE_ENABLED", True)
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch("shared.engine._recall_work_orders", new=AsyncMock(return_value=_WOS)):
        block = await sv._build_wo_evidence_context(
            _state("Allen-Bradley, PowerFlex 525"), "tenant-1"
        )
    assert "MIRA-20260601-AB12" in block and "WORK ORDER HISTORY" in block


@pytest.mark.asyncio
async def test_build_swallows_recall_errors(tmp_path, monkeypatch):
    monkeypatch.setattr("shared.engine._WO_EVIDENCE_ENABLED", True)
    sv = _make_sv(str(tmp_path / "t.db"))
    with patch(
        "shared.engine._recall_work_orders",
        new=AsyncMock(side_effect=RuntimeError("neon down")),
    ):
        assert (
            await sv._build_wo_evidence_context(
                _state("Allen-Bradley, PowerFlex 525"), "tenant-1"
            )
            == ""
        )


# wiring: _call_with_correction forwards the WO block to RAGWorker.process


@pytest.mark.asyncio
async def test_diagnose_path_forwards_wo_evidence(tmp_path):
    sv = _make_sv(str(tmp_path / "t.db"))
    sv.rag.process = AsyncMock(return_value='{"reply": "ok"}')
    sv.rag._last_sources = []
    with patch.object(
        sv, "_build_wo_evidence_context", new=AsyncMock(return_value="SENTINEL_WO_BLOCK")
    ):
        await sv._call_with_correction(
            "why is it faulting", _state("Allen-Bradley, PowerFlex 525"), tenant_id="tenant-1"
        )
    assert sv.rag.process.await_count >= 1
    assert "SENTINEL_WO_BLOCK" in sv.rag.process.await_args.kwargs.get("kg_context", "")


@pytest.mark.asyncio
async def test_flag_off_leaves_rag_context_untouched(tmp_path, monkeypatch):
    """Default-off: extra_context reaching RAGWorker carries no WO block."""
    monkeypatch.setattr("shared.engine._WO_EVIDENCE_ENABLED", False)
    sv = _make_sv(str(tmp_path / "t.db"))
    sv.rag.process = AsyncMock(return_value='{"reply": "ok"}')
    sv.rag._last_sources = []
    await sv._call_with_correction(
        "why is it faulting", _state("Allen-Bradley, PowerFlex 525"), tenant_id="tenant-1"
    )
    assert "WORK ORDER HISTORY" not in sv.rag.process.await_args.kwargs.get("kg_context", "")
