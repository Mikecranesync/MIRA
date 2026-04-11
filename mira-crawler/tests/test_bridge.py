"""Tests for the Task Bridge API (bridge.py).

All external dependencies (Redis, Celery broker, task modules) are mocked.
Tests run fully offline without a running Redis or Celery worker.
"""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

VALID_TOKEN = "test-bridge-key-abc123"
AUTH_HEADER = {"Authorization": f"Bearer {VALID_TOKEN}"}
WRONG_HEADER = {"Authorization": "Bearer wrong-key"}


def _make_client(api_key: str = VALID_TOKEN) -> TestClient:
    """Build a TestClient with TASK_BRIDGE_API_KEY patched to api_key."""
    with patch.dict("os.environ", {"TASK_BRIDGE_API_KEY": api_key}):
        # Re-import bridge so module-level TASK_BRIDGE_API_KEY picks up the patch.
        # Use importlib to reload cleanly each time.
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)
        return TestClient(bridge_mod.app)


@pytest.fixture()
def client() -> TestClient:
    return _make_client()


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


class TestHealth:
    def test_health_returns_200(self) -> None:
        """GET /health is public — no auth required."""
        mock_redis = MagicMock()
        mock_redis.ping.return_value = True

        with patch("redis.Redis", return_value=mock_redis):
            client = _make_client()
            response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["redis"] == "ok"

    def test_health_degraded_on_redis_error(self) -> None:
        """GET /health returns 200 with degraded status when Redis is unreachable."""
        with patch("redis.Redis", side_effect=Exception("Connection refused")):
            client = _make_client()
            response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert "error" in data["redis"]

    def test_health_no_auth_required(self) -> None:
        """Health endpoint must not require Authorization header."""
        mock_redis = MagicMock()
        with patch("redis.Redis", return_value=mock_redis):
            client = _make_client()
            # Explicitly omit auth header
            response = client.get("/health")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Auth enforcement on POST /tasks/{task_name}
# ---------------------------------------------------------------------------


class TestAuth:
    def test_no_auth_header_returns_401(self, client: TestClient) -> None:
        """POST without Authorization header → 401."""
        response = client.post("/tasks/discover")
        assert response.status_code == 401

    def test_wrong_token_returns_401(self, client: TestClient) -> None:
        """POST with wrong token → 401."""
        response = client.post("/tasks/discover", headers=WRONG_HEADER)
        assert response.status_code == 401

    def test_malformed_header_returns_401(self, client: TestClient) -> None:
        """POST with non-Bearer scheme → 401."""
        response = client.post("/tasks/discover", headers={"Authorization": "Basic abc"})
        assert response.status_code == 401

    def test_status_endpoint_requires_auth(self, client: TestClient) -> None:
        """GET /tasks/status/{id} without auth → 401."""
        response = client.get("/tasks/status/some-task-id")
        assert response.status_code == 401

    def test_status_endpoint_wrong_token_returns_401(self, client: TestClient) -> None:
        """GET /tasks/status/{id} with wrong token → 401."""
        response = client.get("/tasks/status/some-task-id", headers=WRONG_HEADER)
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /tasks/{task_name} — valid trigger
# ---------------------------------------------------------------------------


class TestTriggerTask:
    def _mock_task_fn(self) -> MagicMock:
        """Build a mock that behaves like a Celery task with .delay() → AsyncResult."""
        mock_async_result = MagicMock()
        mock_async_result.id = "mock-task-id-9999"
        mock_task = MagicMock()
        mock_task.delay.return_value = mock_async_result
        return mock_task

    def test_valid_trigger_returns_202(self, client: TestClient) -> None:
        """POST /tasks/discover with valid auth → 202 with task_id."""
        mock_task = self._mock_task_fn()

        with patch("bridge._resolve_task", return_value=mock_task):
            response = client.post("/tasks/discover", headers=AUTH_HEADER)

        assert response.status_code == 202
        data = response.json()
        assert data["task_id"] == "mock-task-id-9999"
        assert data["task_name"] == "discover"
        assert data["status"] == "queued"

    def test_task_delay_is_called(self, client: TestClient) -> None:
        """Verifies .delay() is invoked exactly once when triggering a task."""
        mock_task = self._mock_task_fn()

        with patch("bridge._resolve_task", return_value=mock_task):
            client.post("/tasks/ingest", headers=AUTH_HEADER)

        mock_task.delay.assert_called_once()

    def test_all_registry_tasks_accepted(self) -> None:
        """Every task name in TASK_REGISTRY must be accepted (no 404)."""
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)

        mock_task = MagicMock()
        mock_task.delay.return_value = MagicMock(id="mock-id")

        task_client = TestClient(bridge_mod.app)
        with patch.dict("os.environ", {"TASK_BRIDGE_API_KEY": VALID_TOKEN}):
            with patch("bridge.TASK_BRIDGE_API_KEY", VALID_TOKEN):
                with patch("bridge._resolve_task", return_value=mock_task):
                    for name in bridge_mod.TASK_REGISTRY:
                        resp = task_client.post(f"/tasks/{name}", headers=AUTH_HEADER)
                        assert resp.status_code == 202, f"Task {name!r} returned {resp.status_code}"

    def test_unknown_task_returns_404(self, client: TestClient) -> None:
        """POST /tasks/nonexistent → 404."""
        response = client.post("/tasks/nonexistent_task_xyz", headers=AUTH_HEADER)
        assert response.status_code == 404
        assert "Unknown task" in response.json()["detail"]

    def test_import_error_returns_422(self, client: TestClient) -> None:
        """If task module cannot be imported, returns 422."""
        with patch("bridge._resolve_task", side_effect=ImportError("module not found")):
            response = client.post("/tasks/rss", headers=AUTH_HEADER)

        assert response.status_code == 422
        assert "could not be imported" in response.json()["detail"]


# ---------------------------------------------------------------------------
# GET /tasks/status/{task_id}
# ---------------------------------------------------------------------------


class TestTaskStatus:
    def _mock_async_result(
        self,
        state: str = "PENDING",
        ready: bool = False,
        successful: bool = False,
        failed: bool = False,
        result: object = None,
    ) -> MagicMock:
        mock_result = MagicMock()
        mock_result.state = state
        mock_result.ready.return_value = ready
        mock_result.successful.return_value = successful
        mock_result.failed.return_value = failed
        mock_result.result = result
        return mock_result

    def test_pending_task(self, client: TestClient) -> None:
        """PENDING task — status returned, no result key."""
        mock_result = self._mock_async_result(state="PENDING")

        with patch("bridge.AsyncResult", return_value=mock_result):
            response = client.get("/tasks/status/abc-123", headers=AUTH_HEADER)

        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == "abc-123"
        assert data["status"] == "PENDING"
        assert "result" not in data
        assert "error" not in data

    def test_success_task(self, client: TestClient) -> None:
        """SUCCESS task — status and result both returned."""
        mock_result = self._mock_async_result(
            state="SUCCESS",
            ready=True,
            successful=True,
            result={"inserted": 42, "skipped": 3},
        )

        with patch("bridge.AsyncResult", return_value=mock_result):
            response = client.get("/tasks/status/def-456", headers=AUTH_HEADER)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "SUCCESS"
        assert data["result"]["inserted"] == 42
        assert "error" not in data

    def test_failed_task(self, client: TestClient) -> None:
        """FAILURE task — error message returned."""
        mock_result = self._mock_async_result(
            state="FAILURE",
            ready=True,
            successful=False,
            failed=True,
            result=Exception("NeonDB connection timed out"),
        )

        with patch("bridge.AsyncResult", return_value=mock_result):
            response = client.get("/tasks/status/ghi-789", headers=AUTH_HEADER)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "FAILURE"
        assert "NeonDB connection timed out" in data["error"]
        assert "result" not in data

    def test_started_task(self, client: TestClient) -> None:
        """STARTED task — status only, no result."""
        mock_result = self._mock_async_result(state="STARTED")

        with patch("bridge.AsyncResult", return_value=mock_result):
            response = client.get("/tasks/status/jkl-000", headers=AUTH_HEADER)

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "STARTED"
        assert "result" not in data


# ---------------------------------------------------------------------------
# Task registry integrity
# ---------------------------------------------------------------------------


class TestTaskRegistry:
    def test_registry_has_all_expected_tasks(self) -> None:
        """All 12 expected task names must be present in TASK_REGISTRY."""
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)

        expected = {
            "discover", "ingest", "foundational", "rss", "sitemaps",
            "youtube", "reddit", "patents", "gdrive", "freshness",
            "photos", "report",
        }
        assert expected == set(bridge_mod.TASK_REGISTRY.keys())

    def test_registry_values_are_2_tuples(self) -> None:
        """Each registry value must be a (module_path, func_name) tuple."""
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)

        for name, value in bridge_mod.TASK_REGISTRY.items():
            assert isinstance(value, tuple), f"{name}: expected tuple, got {type(value)}"
            assert len(value) == 2, f"{name}: expected 2-tuple, got length {len(value)}"
            module_path, func_name = value
            assert isinstance(module_path, str) and module_path, f"{name}: empty module_path"
            assert isinstance(func_name, str) and func_name, f"{name}: empty func_name"

    def test_photos_route_points_to_correct_task(self) -> None:
        """photos route must target ingest_equipment_photos, not ingest_foundational_kb."""
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)

        assert bridge_mod.TASK_REGISTRY["photos"] == ("tasks.foundational", "ingest_equipment_photos")


# ---------------------------------------------------------------------------
# C1: hmac.compare_digest auth check
# ---------------------------------------------------------------------------


class TestHmacAuth:
    def test_auth_uses_hmac_compare(self) -> None:
        """_require_auth must use hmac.compare_digest — not plain != comparison."""
        import importlib

        import bridge as bridge_mod

        importlib.reload(bridge_mod)

        source = inspect.getsource(bridge_mod._require_auth)
        assert "compare_digest" in source, (
            "_require_auth must use hmac.compare_digest to prevent timing attacks"
        )


# ---------------------------------------------------------------------------
# m1: JSON body forwarded as kwargs to .delay()
# ---------------------------------------------------------------------------


class TestTriggerTaskJsonBody:
    def _mock_task_fn(self) -> MagicMock:
        mock_async_result = MagicMock()
        mock_async_result.id = "mock-task-id-body"
        mock_task = MagicMock()
        mock_task.delay.return_value = mock_async_result
        return mock_task

    def test_post_with_json_body_forwards_kwargs(self, client: TestClient) -> None:
        """POST with JSON object body → kwargs forwarded to .delay()."""
        mock_task = self._mock_task_fn()

        with patch("bridge._resolve_task", return_value=mock_task):
            response = client.post(
                "/tasks/discover",
                headers=AUTH_HEADER,
                json={"start_url": "https://example.com"},
            )

        assert response.status_code == 202
        mock_task.delay.assert_called_once_with(start_url="https://example.com")

    def test_post_with_empty_body_no_kwargs(self, client: TestClient) -> None:
        """POST with no body → .delay() called with no kwargs."""
        mock_task = self._mock_task_fn()

        with patch("bridge._resolve_task", return_value=mock_task):
            response = client.post("/tasks/discover", headers=AUTH_HEADER)

        assert response.status_code == 202
        mock_task.delay.assert_called_once_with()

    def test_post_with_invalid_json_returns_415(self, client: TestClient) -> None:
        """POST with non-JSON body → 415 Unsupported Media Type."""
        with patch("bridge._resolve_task", return_value=self._mock_task_fn()):
            response = client.post(
                "/tasks/discover",
                headers={**AUTH_HEADER, "Content-Type": "application/json"},
                content=b"not json",
            )

        assert response.status_code == 415

    def test_post_with_non_object_json_returns_400(self, client: TestClient) -> None:
        """POST with JSON array (not object) body → 400 Bad Request."""
        with patch("bridge._resolve_task", return_value=self._mock_task_fn()):
            response = client.post(
                "/tasks/discover",
                headers=AUTH_HEADER,
                json=[1, 2, 3],
            )

        assert response.status_code == 400
