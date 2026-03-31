"""Integration tests for the MIRA RAG sidecar FastAPI app — regime 6."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add mira-sidecar to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))


@pytest.fixture
def test_client(tmp_path):
    """Create a FastAPI TestClient with mocked providers.

    Instead of fighting with the lifespan, we set the module-level globals
    directly — this is what the lifespan does anyway.
    """
    from fastapi.testclient import TestClient

    mock_llm = MagicMock()
    mock_llm.model_name = "mock-model"
    mock_llm.complete = AsyncMock(return_value="Mock answer about VFD faults.")
    mock_llm.embed = AsyncMock(return_value=[[0.1] * 384])

    mock_embed = MagicMock()
    mock_embed.model_name = "mock-embed"
    mock_embed.embed = AsyncMock(return_value=[[0.1] * 384])

    mock_store = MagicMock()
    mock_store.doc_count.return_value = 5
    mock_store.query.return_value = [
        {
            "text": "Fault code OC means overcurrent",
            "source_file": "manual.pdf",
            "page": "3",
            "asset_id": "conveyor_demo",
            "chunk_index": 0,
            "distance": 0.12,
        }
    ]

    # Patch heavy initialisers so lifespan doesn't try real ChromaDB / LLM
    with (
        patch("app.MiraVectorStore", return_value=mock_store),
        patch("app.create_providers", return_value=(mock_llm, mock_embed)),
        patch("app.embed_texts", new=mock_embed.embed),
    ):
        import app as app_mod

        # Force-set module globals (same as what lifespan does)
        app_mod._store = mock_store
        app_mod._llm = mock_llm
        app_mod._embedder = mock_embed

        client = TestClient(app_mod.app, raise_server_exceptions=False)
        yield client

        # Cleanup globals
        app_mod._store = None
        app_mod._llm = None
        app_mod._embedder = None


class TestStatusEndpoint:
    def test_status_returns_ok(self, test_client):
        resp = test_client.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "doc_count" in data


class TestIngestEndpoint:
    def test_ingest_missing_path(self, test_client):
        resp = test_client.post(
            "/ingest",
            json={"filename": "test.pdf", "asset_id": "demo", "path": "/nonexistent/file.pdf"},
        )
        # chunk_document returns [] → 422 "No text could be extracted"
        assert resp.status_code == 422

    def test_ingest_accepts_valid_request(self, test_client, sample_txt_path):
        resp = test_client.post(
            "/ingest",
            json={
                "filename": "test_sop.txt",
                "asset_id": "conveyor_demo",
                "path": str(sample_txt_path),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["chunks_added"] > 0


class TestRagEndpoint:
    def test_rag_query_returns_answer(self, test_client):
        resp = test_client.post(
            "/rag",
            json={
                "query": "What does fault code OC mean?",
                "asset_id": "conveyor_demo",
                "tag_snapshot": {"[default]Conveyor/VFD_Hz": {"value": "30.0", "quality": "Good"}},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert "sources" in data
        assert len(data["sources"]) > 0

    def test_rag_query_empty_query(self, test_client):
        resp = test_client.post(
            "/rag",
            json={"query": "", "asset_id": "", "tag_snapshot": {}},
        )
        assert resp.status_code == 200


class TestBuildFSMEndpoint:
    def test_build_fsm_returns_model(self, test_client, sample_state_history):
        resp = test_client.post(
            "/build_fsm",
            json={"asset_id": "conveyor_demo", "tag_history": sample_state_history},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "transitions" in data
        assert data["asset_id"] == "conveyor_demo"
        assert data["cycle_count"] > 0

    def test_build_fsm_empty_history(self, test_client):
        resp = test_client.post(
            "/build_fsm",
            json={"asset_id": "conveyor_demo", "tag_history": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["transitions"] == {}
        assert data["cycle_count"] == 0
