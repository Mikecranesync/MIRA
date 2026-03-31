"""Integration tests for the MIRA RAG sidecar FastAPI app — regime 6."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add mira-sidecar to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))


@pytest.fixture
def test_client():
    """Create a FastAPI TestClient for the sidecar app."""
    from fastapi.testclient import TestClient

    # Patch providers to avoid needing real API keys
    with (
        patch("app.create_providers") as mock_factory,
        patch("app.MiraVectorStore") as mock_store_cls,
    ):
        mock_llm = MagicMock()
        mock_llm.model_name = "mock-model"
        mock_llm.complete = AsyncMock(return_value="Mock answer about VFD faults.")
        mock_llm.embed = AsyncMock(return_value=[[0.1] * 384])

        mock_embed = MagicMock()
        mock_embed.embed = AsyncMock(return_value=[[0.1] * 384])

        mock_factory.return_value = (mock_llm, mock_embed)

        mock_store = MagicMock()
        mock_store.doc_count.return_value = 5
        mock_store.query.return_value = [
            {
                "text": "Fault code OC means overcurrent",
                "metadata": {"source_file": "manual.pdf", "page": "3"},
            }
        ]
        mock_store_cls.return_value = mock_store

        from app import app

        client = TestClient(app)
        yield client


class TestStatusEndpoint:
    def test_status_returns_ok(self, test_client):
        resp = test_client.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestIngestEndpoint:
    def test_ingest_missing_path(self, test_client):
        resp = test_client.post(
            "/ingest",
            json={"filename": "test.pdf", "asset_id": "demo", "path": "/nonexistent/file.pdf"},
        )
        # Should return error for missing file
        assert resp.status_code in (400, 422, 500)

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
        assert "chunks_added" in data


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

    def test_rag_query_empty_query(self, test_client):
        resp = test_client.post(
            "/rag",
            json={"query": "", "asset_id": "", "tag_snapshot": {}},
        )
        # Should still work (empty query is valid, just returns generic response)
        assert resp.status_code in (200, 400)


class TestBuildFSMEndpoint:
    def test_build_fsm_returns_model(self, test_client, sample_state_history):
        resp = test_client.post(
            "/build_fsm",
            json={"asset_id": "conveyor_demo", "tag_history": sample_state_history},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "transitions" in data
        assert "asset_id" in data
        assert data["asset_id"] == "conveyor_demo"

    def test_build_fsm_empty_history(self, test_client):
        resp = test_client.post(
            "/build_fsm",
            json={"asset_id": "conveyor_demo", "tag_history": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["transitions"] == {}
