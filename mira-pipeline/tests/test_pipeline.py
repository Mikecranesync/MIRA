"""Unit tests for the mira-pipeline FastAPI app.

Covers the five scenarios from issue #1084:
- Happy path: valid bearer + message → OpenAI-compat response
- GSDEngine error → 200 with fallback body (pipeline catches internally)
- Missing/wrong bearer → HTTP 401
- GET /v1/models → model list containing "mira-diagnostic"
- GET /health → {status: ok} without auth

Strategy: inject stub modules into sys.modules for every heavy import that
main.py performs at the top level.  This avoids needing Ollama, NeonDB, or
any external service.  The FastAPI app is loaded without running lifespan;
we wire `main.engine` to a mock directly.
"""

from __future__ import annotations

import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock

import pytest


# ── Stub modules injected BEFORE main.py is imported ────────────────────────


def _make_stub(name: str, **attrs) -> ModuleType:
    mod = ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


def _install_stubs() -> MagicMock:
    """Inject lightweight stubs and return the mock Supervisor instance."""
    mock_engine = MagicMock()
    mock_engine.process = AsyncMock(return_value="Diagnosis: motor overheating.")
    mock_engine.process_multi_photo = AsyncMock(return_value="Multi-photo diagnosis.")
    mock_engine.reset = MagicMock()

    mock_supervisor_cls = MagicMock(return_value=mock_engine)

    # shared package
    shared_pkg = _make_stub("shared")
    shared_engine = _make_stub("shared.engine", Supervisor=mock_supervisor_cls)
    # span() is used as a context manager — __exit__ must return False so
    # exceptions propagate to the outer try/except in main.py rather than
    # being swallowed by a truthy MagicMock() return value.
    _span_cm = MagicMock()
    _span_cm.__enter__ = MagicMock(return_value=None)
    _span_cm.__exit__ = MagicMock(return_value=False)
    shared_telemetry = _make_stub(
        "shared.telemetry",
        trace=MagicMock(return_value=MagicMock(update=MagicMock())),
        span=MagicMock(return_value=_span_cm),
        flush=MagicMock(),
    )
    shared_guardrails = _make_stub("shared.guardrails")
    shared_pm_scheduler = _make_stub(
        "shared.pm_scheduler",
        run_midnight_scheduler=AsyncMock(),
    )

    for name, mod in [
        ("shared", shared_pkg),
        ("shared.engine", shared_engine),
        ("shared.telemetry", shared_telemetry),
        ("shared.guardrails", shared_guardrails),
        ("shared.pm_scheduler", shared_pm_scheduler),
    ]:
        sys.modules.setdefault(name, mod)

    # Pipeline-local modules that have side-effectful constructors
    sys.modules.setdefault("memory", _make_stub("memory", ConversationMemory=MagicMock()))
    sys.modules.setdefault("feedback_sync", _make_stub("feedback_sync", run_loop=MagicMock()))

    return mock_engine


_MOCK_ENGINE = _install_stubs()


# ── App fixture ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def app():
    """Return the FastAPI app with engine mocked; lifespan not exercised."""
    sys.modules.pop("main", None)

    import main as m  # noqa: PLC0415  (import after stub injection)

    # Bypass lifespan — set the engine global directly.
    m.engine = _MOCK_ENGINE
    m.PIPELINE_API_KEY = "test-secret"
    return m.app


@pytest.fixture
def client(app):
    from starlette.testclient import TestClient

    # raise_server_exceptions=False lets us assert on 500 status codes.
    return TestClient(app, raise_server_exceptions=False)


# ── Tests ────────────────────────────────────────────────────────────────────


class TestHealth:
    def test_health_no_auth_required(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_returns_status_ok(self, client):
        body = client.get("/health").json()
        assert body["status"] == "ok"

    def test_health_includes_engine_flag(self, client):
        body = client.get("/health").json()
        assert "engine" in body


class TestModels:
    def test_models_returns_200(self, client):
        assert client.get("/v1/models").status_code == 200

    def test_models_contains_mira_diagnostic(self, client):
        body = client.get("/v1/models").json()
        ids = [m["id"] for m in body["data"]]
        assert "mira-diagnostic" in ids

    def test_models_object_is_list(self, client):
        body = client.get("/v1/models").json()
        assert body["object"] == "list"

    def test_models_no_auth_required(self, client):
        # /v1/models is on the middleware allowlist.
        resp = client.get("/v1/models")
        assert resp.status_code == 200


class TestAuth:
    _PAYLOAD = {
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": "hello"}],
    }

    def test_missing_auth_header_returns_401(self, client):
        resp = client.post("/v1/chat/completions", json=self._PAYLOAD)
        assert resp.status_code == 401

    def test_wrong_bearer_returns_401(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json=self._PAYLOAD,
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401

    def test_valid_bearer_is_not_401(self, client):
        _MOCK_ENGINE.process = AsyncMock(return_value="ok")
        resp = client.post(
            "/v1/chat/completions",
            json=self._PAYLOAD,
            headers={"Authorization": "Bearer test-secret"},
        )
        assert resp.status_code != 401


class TestChatCompletions:
    def _post(self, client, message: str) -> dict:
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "mira-diagnostic",
                "messages": [{"role": "user", "content": message}],
            },
            headers={"Authorization": "Bearer test-secret"},
        )
        return resp

    def test_happy_path_status_200(self, client):
        _MOCK_ENGINE.process = AsyncMock(return_value="Diagnosis: motor overheating.")
        assert self._post(client, "My motor is overheating").status_code == 200

    def test_happy_path_openai_compat_shape(self, client):
        _MOCK_ENGINE.process = AsyncMock(return_value="Diagnosis: motor overheating.")
        body = self._post(client, "My motor is overheating").json()
        assert body["object"] == "chat.completion"
        assert body["model"] == "mira-diagnostic"
        assert body["choices"][0]["message"]["role"] == "assistant"
        assert body["choices"][0]["finish_reason"] == "stop"

    def test_happy_path_required_top_level_fields(self, client):
        _MOCK_ENGINE.process = AsyncMock(return_value="All clear.")
        body = self._post(client, "Status check").json()
        for field in ("id", "object", "created", "model", "choices", "usage"):
            assert field in body, f"missing field: {field}"

    def test_engine_error_returns_200_with_fallback_content(self, client):
        # When engine.process raises, the pipeline catches and returns a fallback
        # message — HTTP status stays 200 per the existing error-handling code.
        _MOCK_ENGINE.process = AsyncMock(side_effect=RuntimeError("NeonDB unavailable"))
        resp = self._post(client, "What is wrong with pump P-101?")
        assert resp.status_code == 200
        content = resp.json()["choices"][0]["message"]["content"]
        assert len(content) > 0

    def test_empty_message_returns_400(self, client):
        resp = client.post(
            "/v1/chat/completions",
            json={
                "model": "mira-diagnostic",
                "messages": [{"role": "user", "content": ""}],
            },
            headers={"Authorization": "Bearer test-secret"},
        )
        assert resp.status_code == 400
