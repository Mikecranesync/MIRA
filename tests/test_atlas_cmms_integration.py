"""Unit tests for bot → Atlas CMMS work-order integration.

Tests the AtlasCMMSClient thin wrapper (calls mira-mcp REST proxy) and the
engine-level hooks: _build_wo_draft, _handle_cmms_pending.

All HTTP calls are mocked — no live VPS required.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# engine.py / guardrails.py use `X | Y` union syntax in signatures, which
# requires Python 3.10+ at runtime without from __future__ import annotations.
# These tests run on the VPS (3.12) and are skipped on the dev node (3.9).
_REQUIRES_PY310 = pytest.mark.skipif(
    sys.version_info < (3, 10), reason="engine.py requires Python 3.10+"
)

# Make mira-bots/shared importable without installing
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS_SHARED = REPO_ROOT / "mira-bots" / "shared"
if str(MIRA_BOTS_SHARED.parent) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS_SHARED.parent))

from shared.integrations.atlas_cmms import AtlasCMMSClient  # noqa: E402

# ---------------------------------------------------------------------------
# AtlasCMMSClient — unit tests (mocked httpx)
# ---------------------------------------------------------------------------


class TestAtlasCMMSClientConfigured:
    def test_configured_with_url(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="key")
        assert client.configured is True

    def test_configured_with_env_url(self, monkeypatch):
        monkeypatch.setenv("MCP_BASE_URL", "http://test-mcp:8001")
        client = AtlasCMMSClient(api_key="")
        assert client.configured is True

    def test_headers_include_bearer_when_key_set(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="secret")
        assert client._headers()["Authorization"] == "Bearer secret"

    def test_headers_omit_auth_when_no_key(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="")
        assert "Authorization" not in client._headers()


class TestAtlasCMMSClientCreateWorkOrder:
    async def test_success_returns_id(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": 42, "status": "OPEN"}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.post = AsyncMock(return_value=mock_resp)
            mock_cls.return_value = mock_http

            result = await client.create_work_order(
                title="GS10 overcurrent",
                description="VFD fault diagnosed",
                priority="HIGH",
            )

        assert result["id"] == 42
        assert "error" not in result

    async def test_http_error_returns_error_dict(self):
        import httpx as _httpx

        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.text = "service unavailable"
        mock_resp.raise_for_status.side_effect = _httpx.HTTPStatusError(
            "503", request=MagicMock(), response=mock_resp
        )

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.post = AsyncMock(return_value=mock_resp)
            mock_cls.return_value = mock_http

            result = await client.create_work_order(
                title="Test", description="Test"
            )

        assert "error" in result
        assert "503" in result["error"]

    async def test_connection_error_returns_error_dict(self):
        import httpx as _httpx

        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.post = AsyncMock(
                side_effect=_httpx.ConnectError("connection refused")
            )
            mock_cls.return_value = mock_http

            result = await client.create_work_order(
                title="Test", description="Test"
            )

        assert "error" in result

    async def test_title_truncated_to_100_chars(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": 1}
        mock_resp.raise_for_status = MagicMock()

        captured_payload: dict = {}

        async def _capture_post(url, headers, json):
            captured_payload.update(json)
            return mock_resp

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.post = _capture_post
            mock_cls.return_value = mock_http

            await client.create_work_order(
                title="A" * 200,
                description="Test",
            )

        assert len(captured_payload["title"]) <= 100

    async def test_description_truncated_to_2000_chars(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": 1}
        mock_resp.raise_for_status = MagicMock()

        captured_payload: dict = {}

        async def _capture_post(url, headers, json):
            captured_payload.update(json)
            return mock_resp

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.post = _capture_post
            mock_cls.return_value = mock_http

            await client.create_work_order(
                title="Test",
                description="B" * 5000,
            )

        assert len(captured_payload["description"]) <= 2000


class TestAtlasCMMSClientHealthCheck:
    async def test_health_check_true_on_200(self):
        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")
        mock_resp = MagicMock()
        mock_resp.status_code = 200

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_cls.return_value = mock_http

            result = await client.health_check()

        assert result is True

    async def test_health_check_false_on_connection_error(self):
        import httpx as _httpx

        client = AtlasCMMSClient(base_url="http://mira-mcp:8001", api_key="tok")

        with patch("httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            mock_http.get = AsyncMock(side_effect=_httpx.ConnectError("refused"))
            mock_cls.return_value = mock_http

            result = await client.health_check()

        assert result is False


# ---------------------------------------------------------------------------
# Engine hooks — _build_wo_draft and _handle_cmms_pending
# ---------------------------------------------------------------------------


def _make_engine_state(
    state_name: str = "RESOLVED",
    asset: str = "Yaskawa V1000, 3HP 460V",
    fault: str = "power",
    history: list | None = None,
) -> dict:
    """Build a minimal conversation_state dict for testing."""
    return {
        "chat_id": "test-123",
        "state": state_name,
        "context": {
            "session_context": {},
            "history": history
            or [
                {"role": "user", "content": "VFD throwing OC fault"},
                {"role": "assistant", "content": "Check the acceleration time."},
                {"role": "user", "content": "Increased accel time — fixed it."},
                {"role": "assistant", "content": "Great, that resolved the OC fault."},
            ],
        },
        "asset_identified": asset,
        "fault_category": fault,
        "exchange_count": 4,
        "final_state": "RESOLVED",
    }


@_REQUIRES_PY310
class TestBuildWoDraft:
    """engine._build_wo_draft builds sensible WO metadata from resolved state."""

    def _get_supervisor(self):
        """Return a minimal Supervisor-like object with _build_wo_draft."""
        # Import lazily — avoids heavy engine init in unit tests.
        # We test the method directly by patching __init__.
        with patch("shared.engine.Supervisor.__init__", return_value=None):
            from shared.engine import Supervisor

            sv = Supervisor.__new__(Supervisor)
            return sv

    def test_title_includes_asset(self):
        sv = self._get_supervisor()
        state = _make_engine_state(asset="GS10, 5HP 460V")
        draft = sv._build_wo_draft(state)
        assert "GS10" in draft["title"]

    def test_title_capped_at_100_chars(self):
        sv = self._get_supervisor()
        state = _make_engine_state(asset="A" * 200)
        draft = sv._build_wo_draft(state)
        assert len(draft["title"]) <= 100

    def test_description_contains_equipment_and_fault(self):
        sv = self._get_supervisor()
        state = _make_engine_state(asset="Yaskawa V1000", fault="thermal")
        draft = sv._build_wo_draft(state)
        assert "Yaskawa V1000" in draft["description"]
        assert "thermal" in draft["description"]

    def test_description_includes_conversation_history(self):
        sv = self._get_supervisor()
        history = [
            {"role": "user", "content": "Motor is overheating"},
            {"role": "assistant", "content": "Check ambient temperature."},
        ]
        state = _make_engine_state(history=history)
        draft = sv._build_wo_draft(state)
        assert "overheating" in draft["description"]

    def test_high_priority_for_power_fault(self):
        sv = self._get_supervisor()
        state = _make_engine_state(fault="power")
        draft = sv._build_wo_draft(state)
        assert draft["priority"] == "HIGH"

    def test_high_priority_for_thermal_fault(self):
        sv = self._get_supervisor()
        state = _make_engine_state(fault="thermal")
        draft = sv._build_wo_draft(state)
        assert draft["priority"] == "HIGH"

    def test_medium_priority_for_unknown_fault(self):
        sv = self._get_supervisor()
        state = _make_engine_state(fault="vibration")
        draft = sv._build_wo_draft(state)
        assert draft["priority"] == "MEDIUM"

    def test_asset_label_in_draft(self):
        sv = self._get_supervisor()
        state = _make_engine_state(asset="GS10 VFD")
        draft = sv._build_wo_draft(state)
        assert draft["asset_label"] == "GS10 VFD"

    def test_missing_asset_uses_fallback(self):
        sv = self._get_supervisor()
        state = _make_engine_state()
        state["asset_identified"] = None
        draft = sv._build_wo_draft(state)
        assert "Unknown equipment" in draft["title"]


@_REQUIRES_PY310
class TestHandleCmmsPending:
    """engine._handle_cmms_pending routes yes/no and creates or skips WO."""

    def _get_supervisor(self):
        with patch("shared.engine.Supervisor.__init__", return_value=None):
            from shared.engine import Supervisor

            sv = Supervisor.__new__(Supervisor)
            sv.mcp_base_url = "http://mira-mcp:8001"
            sv.mcp_api_key = "test-key"
            sv.db_path = ":memory:"
            return sv

    async def test_yes_triggers_wo_creation(self):
        sv = self._get_supervisor()
        state = _make_engine_state()
        state["context"]["cmms_pending"] = True
        state["context"]["cmms_wo_draft"] = {
            "title": "[MIRA] GS10 — power action",
            "description": "...",
            "priority": "HIGH",
            "asset_label": "GS10",
        }

        sv._record_exchange = MagicMock()
        sv._post_cmms_work_order = AsyncMock(return_value="Work order #99 created. Asset: GS10.")

        result = await sv._handle_cmms_pending("chat-1", "yes", state, "trace-1")

        sv._post_cmms_work_order.assert_awaited_once()
        assert "Work order #99" in result["reply"]
        assert result["next_state"] == "RESOLVED"

    async def test_no_skips_wo_creation(self):
        sv = self._get_supervisor()
        state = _make_engine_state()
        state["context"]["cmms_pending"] = True
        state["context"]["cmms_wo_draft"] = {"title": "T", "description": "D", "priority": "M", "asset_label": "X"}

        sv._record_exchange = MagicMock()
        sv._post_cmms_work_order = AsyncMock()

        result = await sv._handle_cmms_pending("chat-1", "no thanks", state, "trace-1")

        sv._post_cmms_work_order.assert_not_awaited()
        assert "no work order" in result["reply"].lower()

    async def test_cmms_error_returns_fallback_message(self):
        sv = self._get_supervisor()
        state = _make_engine_state()
        state["context"]["cmms_pending"] = True
        state["context"]["cmms_wo_draft"] = {"title": "T", "description": "D", "priority": "M", "asset_label": "X"}

        sv._record_exchange = MagicMock()
        sv._post_cmms_work_order = AsyncMock(side_effect=RuntimeError("HTTP 503"))

        result = await sv._handle_cmms_pending("chat-1", "yes", state, "trace-1")

        assert "manually" in result["reply"].lower()
        assert result["next_state"] == "RESOLVED"

    async def test_cmms_pending_cleared_after_handling(self):
        sv = self._get_supervisor()
        state = _make_engine_state()
        state["context"]["cmms_pending"] = True
        state["context"]["cmms_wo_draft"] = {"title": "T", "description": "D", "priority": "M", "asset_label": "X"}

        sv._record_exchange = MagicMock()
        sv._post_cmms_work_order = AsyncMock(return_value="Work order #1 created.")

        await sv._handle_cmms_pending("chat-1", "yes", state, "trace-1")

        assert "cmms_pending" not in state["context"]
        assert "cmms_wo_draft" not in state["context"]

    async def test_various_yes_phrases_trigger_creation(self):
        yes_phrases = ["yes", "yeah", "sure", "ok", "create it", "log it", "y"]
        for phrase in yes_phrases:
            sv = self._get_supervisor()
            state = _make_engine_state()
            state["context"]["cmms_pending"] = True
            state["context"]["cmms_wo_draft"] = {
                "title": "T", "description": "D", "priority": "M", "asset_label": "X"
            }
            sv._record_exchange = MagicMock()
            sv._post_cmms_work_order = AsyncMock(return_value="Work order #1 created.")

            await sv._handle_cmms_pending("chat-1", phrase, state, "trace-1")

            sv._post_cmms_work_order.assert_awaited_once(), f"'{phrase}' should trigger creation"
