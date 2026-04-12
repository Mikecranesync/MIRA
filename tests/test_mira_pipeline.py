"""Tests for mira-pipeline OpenAI-compatible API."""

from __future__ import annotations

import json
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock

# ── Mock shared module hierarchy before importing main ────────────────────────

_mock_gsd_engine_cls = MagicMock()
_mock_gsd_engine_inst = MagicMock()
_mock_gsd_engine_inst.process = AsyncMock(return_value="Test diagnostic response")
_mock_gsd_engine_inst.reset = MagicMock()
_mock_gsd_engine_cls.return_value = _mock_gsd_engine_inst


def _setup_shared_mock():
    """Insert mock shared module so main.py can import from shared.gsd_engine."""
    shared = ModuleType("shared")
    shared.gsd_engine = ModuleType("shared.gsd_engine")
    shared.gsd_engine.GSDEngine = _mock_gsd_engine_cls  # type: ignore[attr-defined]
    sys.modules["shared"] = shared
    sys.modules["shared.gsd_engine"] = shared.gsd_engine


_setup_shared_mock()

# Now set env vars and import main
import os  # noqa: E402

os.environ.setdefault("MIRA_DB_PATH", "/tmp/test.db")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://fake:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "test-key")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "test-collection")
os.environ.setdefault("PIPELINE_API_KEY", "test-pipeline-key")

# Add mira-pipeline to path so main is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-pipeline"))

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Inject mock engine directly (startup event may not fire in test context)
main.engine = _mock_gsd_engine_inst

client = TestClient(main.app)
AUTH_HEADER = {"Authorization": "Bearer test-pipeline-key"}


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_health():
    """GET /health returns 200 with status ok — no auth required."""
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "engine" in body


def test_models_list():
    """GET /v1/models returns OpenAI-compatible model list with mira-diagnostic."""
    resp = client.get("/v1/models", headers=AUTH_HEADER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["object"] == "list"
    assert len(body["data"]) == 1
    model = body["data"][0]
    assert model["id"] == "mira-diagnostic"
    assert model["owned_by"] == "factorylm"


def test_chat_completions_text():
    """POST /v1/chat/completions with text message returns proper OpenAI format."""
    _mock_gsd_engine_inst.process.reset_mock()
    payload = {
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": "VFD shows fault code F7"}],
        "user": "test-user-42",
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 200
    body = resp.json()

    # Verify OpenAI response structure
    assert body["object"] == "chat.completion"
    assert body["model"] == "mira-diagnostic"
    assert len(body["choices"]) == 1
    choice = body["choices"][0]
    assert choice["message"]["role"] == "assistant"
    assert choice["message"]["content"] == "Test diagnostic response"
    assert choice["finish_reason"] == "stop"
    assert "usage" in body

    # Verify engine.process was called with correct args
    _mock_gsd_engine_inst.process.assert_awaited_once_with(
        chat_id="test-user-42",
        message="VFD shows fault code F7",
        photo_b64=None,
        platform="openwebui",
    )


def test_chat_completions_no_message():
    """POST with empty messages returns 400."""
    payload = {
        "model": "mira-diagnostic",
        "messages": [{"role": "system", "content": "You are helpful"}],
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 400


def test_chat_completions_multimodal():
    """POST with image_url content extracts base64 correctly."""
    _mock_gsd_engine_inst.process.reset_mock()
    fake_b64 = "iVBORw0KGgoAAAANSUhEUg=="
    payload = {
        "model": "mira-diagnostic",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is on this nameplate?"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{fake_b64}"},
                    },
                ],
            }
        ],
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 200

    _mock_gsd_engine_inst.process.assert_awaited_once_with(
        chat_id="openwebui_anonymous",
        message="What is on this nameplate?",
        photo_b64=fake_b64,
        platform="openwebui",
    )


def test_streaming_response():
    """POST with stream=True returns SSE event stream with data chunks."""
    _mock_gsd_engine_inst.process.reset_mock()
    payload = {
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": "Check motor bearings"}],
        "stream": True,
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    # Parse SSE events
    raw = resp.text
    events = [line for line in raw.strip().split("\n\n") if line.startswith("data:")]
    assert len(events) == 3  # content chunk, finish chunk, [DONE]

    # First chunk: content
    first = json.loads(events[0].removeprefix("data: "))
    assert first["object"] == "chat.completion.chunk"
    assert first["choices"][0]["delta"]["content"] == "Test diagnostic response"
    assert first["choices"][0]["finish_reason"] is None

    # Second chunk: finish
    second = json.loads(events[1].removeprefix("data: "))
    assert second["choices"][0]["finish_reason"] == "stop"
    assert second["choices"][0]["delta"] == {}

    # Third: [DONE]
    assert events[2].strip() == "data: [DONE]"


def test_chat_completions_dict_user():
    """POST with user as dict extracts id for chat_id."""
    _mock_gsd_engine_inst.process.reset_mock()
    payload = {
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": "pump vibration"}],
        "user": {"id": "user-abc-123", "email": "tech@factory.com", "name": "Tech"},
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 200
    _mock_gsd_engine_inst.process.assert_awaited_once_with(
        chat_id="user-abc-123",
        message="pump vibration",
        photo_b64=None,
        platform="openwebui",
    )


def test_chat_completions_metadata_chat_id():
    """POST with metadata.chat_id used when user is None."""
    _mock_gsd_engine_inst.process.reset_mock()
    payload = {
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": "bearing noise"}],
        "metadata": {"chat_id": "chat-xyz-789"},
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=AUTH_HEADER)
    assert resp.status_code == 200
    _mock_gsd_engine_inst.process.assert_awaited_once_with(
        chat_id="chat-xyz-789",
        message="bearing noise",
        photo_b64=None,
        platform="openwebui",
    )
