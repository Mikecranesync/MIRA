"""Tests for context/viking_store.py — openviking v0.2.6+ API compatibility (GH #336)."""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def _no_openviking(monkeypatch):
    """Ensure openviking is not importable so the sqlite fallback is used."""
    monkeypatch.setitem(sys.modules, "openviking", None)


@pytest.fixture
def viking_store_fallback(_no_openviking, monkeypatch, tmp_path):
    """Import viking_store with openviking unavailable (sqlite fallback)."""
    # Force re-import
    monkeypatch.setitem(sys.modules, "context.viking_store", None)
    sys.modules.pop("context.viking_store", None)

    monkeypatch.setenv("VIKING_STORE_PATH", str(tmp_path / "viking"))

    import importlib
    import context.viking_store as vs

    importlib.reload(vs)
    vs.VIKING_STORE_PATH = str(tmp_path / "viking")
    vs._USE_OPENVIKING = False
    return vs


@pytest.fixture
def viking_store_ov(monkeypatch, tmp_path):
    """Import viking_store with a mocked openviking module."""
    mock_client = MagicMock()
    mock_client.initialize = MagicMock()
    mock_client.mkdir = MagicMock()
    mock_client.write = MagicMock()

    mock_search_result = MagicMock()
    mock_search_result.resources = []
    mock_search_result.memories = []
    mock_client.search = MagicMock(return_value=mock_search_result)

    mock_ov = types.ModuleType("openviking")
    mock_ov.__version__ = "0.2.6"
    mock_ov.SyncOpenViking = MagicMock(return_value=mock_client)

    monkeypatch.setitem(sys.modules, "openviking", mock_ov)

    sys.modules.pop("context.viking_store", None)
    monkeypatch.setenv("VIKING_STORE_PATH", str(tmp_path / "viking"))

    import importlib
    import context.viking_store as vs

    importlib.reload(vs)
    vs.VIKING_STORE_PATH = str(tmp_path / "viking")
    vs._USE_OPENVIKING = True
    vs._ov_client = None

    # Patch the module-level openviking reference
    vs.openviking = mock_ov

    return vs, mock_ov, mock_client


# ── sqlite fallback tests ──


def test_fallback_ingest_and_retrieve(viking_store_fallback):
    vs = viking_store_fallback
    row_id = vs.ingest_text("VFD fault code E003 overcurrent", "viking://t1/equipment/vfd")
    assert row_id > 0

    results = vs.retrieve("overcurrent", "t1", top_k=3)
    assert len(results) == 1
    assert "overcurrent" in results[0]["content"]
    assert results[0]["score"] > 0


def test_fallback_ingest_pdf(viking_store_fallback, tmp_path):
    vs = viking_store_fallback
    pdf_path = tmp_path / "test.pdf"
    pdf_path.write_text("Page 1 content about motors")

    chunks = vs.ingest_pdf(str(pdf_path), "tenant-abc", "motor")
    assert chunks >= 1


# ── openviking v0.2.6+ API tests ──


def test_ov_ingest_uses_class_api(viking_store_ov):
    """Verify ingest_text uses SyncOpenViking class, not openviking.open()."""
    vs, mock_ov, mock_client = viking_store_ov

    vs.ingest_text("test content", "viking://t1/equipment/vfd")

    # SyncOpenViking was instantiated (not openviking.open)
    mock_ov.SyncOpenViking.assert_called_once()
    assert not hasattr(mock_ov, "open") or not getattr(mock_ov, "open", MagicMock()).called
    mock_client.mkdir.assert_called_with("viking://t1/equipment/vfd")
    mock_client.write.assert_called_once()
    call_kwargs = mock_client.write.call_args
    assert call_kwargs.kwargs.get("content") == "test content" or call_kwargs[1].get(
        "content"
    ) == "test content"


def test_ov_retrieve_uses_class_api(viking_store_ov):
    """Verify retrieve uses SyncOpenViking.search(), not openviking.open()."""
    vs, mock_ov, mock_client = viking_store_ov

    # Set up a mock search hit
    mock_hit = MagicMock()
    mock_hit.abstract = "relevant content"
    mock_hit.score = 0.85
    mock_hit.uri = "viking://t1/equipment/vfd/chunk1"

    mock_result = MagicMock()
    mock_result.resources = [mock_hit]
    mock_result.memories = []
    mock_client.search.return_value = mock_result

    results = vs.retrieve("fault code", "t1", top_k=3)

    mock_client.search.assert_called_once_with(
        "fault code", target_uri="viking://t1/equipment", limit=3
    )
    assert len(results) == 1
    assert results[0]["content"] == "relevant content"
    assert results[0]["score"] == 0.85


def test_ov_no_open_function_called(viking_store_ov):
    """The bug: openviking.open() does not exist in v0.2.6. Ensure it's never called."""
    vs, mock_ov, mock_client = viking_store_ov

    # Add a trap — if open() is called, fail
    mock_ov.open = MagicMock(side_effect=AttributeError("openviking has no attribute 'open'"))

    # These should NOT call openviking.open()
    vs.ingest_text("test", "viking://t1/equipment/vfd")
    vs.retrieve("test", "t1")

    mock_ov.open.assert_not_called()
