"""Unit tests for the CMMS adapter library.

Tests cover:
- factory dispatch (create_cmms_adapter)
- configured property on each adapter
- _get / _post / _patch short-circuit when not configured
- int(asset_id) ValueError guard in create_work_order
- Atlas list_pm_schedules returns [] on non-numeric asset_id
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make mira-mcp importable without installing it
REPO_ROOT = Path(__file__).parent.parent
MIRA_MCP = REPO_ROOT / "mira-mcp"
if str(MIRA_MCP) not in sys.path:
    sys.path.insert(0, str(MIRA_MCP))

from cmms.atlas import AtlasCMMS  # noqa: E402
from cmms.factory import create_cmms_adapter  # noqa: E402
from cmms.fiix import FiixCMMS  # noqa: E402
from cmms.limble import LimbleCMMS  # noqa: E402
from cmms.maintainx import MaintainXCMMS  # noqa: E402

# ---------------------------------------------------------------------------
# Factory dispatch
# ---------------------------------------------------------------------------


class TestFactoryDispatch:
    """create_cmms_adapter returns the expected concrete type."""

    def test_atlas(self, monkeypatch):
        monkeypatch.setenv("CMMS_PROVIDER", "atlas")
        monkeypatch.setenv("ATLAS_API_USER", "u")
        monkeypatch.setenv("ATLAS_API_PASSWORD", "p")
        adapter = create_cmms_adapter("atlas")
        assert isinstance(adapter, AtlasCMMS)

    def test_maintainx(self, monkeypatch):
        monkeypatch.setenv("MAINTAINX_API_KEY", "key")
        adapter = create_cmms_adapter("maintainx")
        assert isinstance(adapter, MaintainXCMMS)

    def test_limble(self, monkeypatch):
        monkeypatch.setenv("LIMBLE_API_KEY", "key")
        adapter = create_cmms_adapter("limble")
        assert isinstance(adapter, LimbleCMMS)

    def test_fiix(self, monkeypatch):
        monkeypatch.setenv("FIIX_API_KEY", "key")
        adapter = create_cmms_adapter("fiix")
        assert isinstance(adapter, FiixCMMS)

    def test_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("ATLAS_API_USER", "u")
        monkeypatch.setenv("ATLAS_API_PASSWORD", "p")
        adapter = create_cmms_adapter("ATLAS")
        assert isinstance(adapter, AtlasCMMS)

    def test_unknown_provider_returns_none(self):
        result = create_cmms_adapter("notacmms")
        assert result is None

    def test_empty_provider_returns_none(self, monkeypatch):
        monkeypatch.delenv("CMMS_PROVIDER", raising=False)
        result = create_cmms_adapter("")
        assert result is None

    def test_none_provider_reads_env_var(self, monkeypatch):
        monkeypatch.setenv("CMMS_PROVIDER", "limble")
        monkeypatch.setenv("LIMBLE_API_KEY", "key")
        adapter = create_cmms_adapter(None)
        assert isinstance(adapter, LimbleCMMS)

    def test_none_provider_no_env_var_returns_none(self, monkeypatch):
        monkeypatch.delenv("CMMS_PROVIDER", raising=False)
        result = create_cmms_adapter(None)
        assert result is None


# ---------------------------------------------------------------------------
# Atlas adapter
# ---------------------------------------------------------------------------


class TestAtlasConfigured:
    def test_configured_true_when_credentials_set(self, monkeypatch):
        monkeypatch.setenv("ATLAS_API_USER", "admin@example.com")
        monkeypatch.setenv("ATLAS_API_PASSWORD", "s3cr3t")
        assert AtlasCMMS().configured is True

    def test_configured_false_when_user_missing(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.setenv("ATLAS_API_PASSWORD", "s3cr3t")
        assert AtlasCMMS().configured is False

    def test_configured_false_when_password_missing(self, monkeypatch):
        monkeypatch.setenv("ATLAS_API_USER", "admin@example.com")
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        assert AtlasCMMS().configured is False

    def test_configured_false_when_both_missing(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        assert AtlasCMMS().configured is False


class TestAtlasUnconfiguredReturnsError:
    """_get / _post / _patch all route through _get_token, which short-circuits."""

    async def test_get_returns_error(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        result = await AtlasCMMS()._get("/assets")
        assert "error" in result

    async def test_post_returns_error(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        result = await AtlasCMMS()._post("/work-orders", {})
        assert "error" in result

    async def test_patch_returns_error(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        result = await AtlasCMMS()._patch("/work-orders/1", {})
        assert "error" in result


class TestAtlasCreateWorkOrderGuard:
    async def test_non_numeric_asset_id_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        adapter = AtlasCMMS()
        result = await adapter.create_work_order(
            title="VFD fault",
            description="Overcurrent on VFD-001",
            asset_id="vfd-001",
        )
        assert "error" in result
        assert "vfd-001" in result["error"]

    async def test_numeric_asset_id_does_not_raise(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        # Not configured, so _post returns error — but no ValueError raised
        adapter = AtlasCMMS()
        result = await adapter.create_work_order(
            title="Test WO",
            description="Test",
            asset_id="42",
        )
        # Returns error dict from unconfigured _post, not an exception
        assert isinstance(result, dict)

    async def test_none_asset_id_skips_int_conversion(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        adapter = AtlasCMMS()
        result = await adapter.create_work_order(
            title="Test WO",
            description="Test",
            asset_id=None,
        )
        assert isinstance(result, dict)


class TestAtlasListPmSchedules:
    async def test_non_numeric_asset_id_returns_empty_list(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        adapter = AtlasCMMS()
        result = await adapter.list_pm_schedules(asset_id="vfd-001")
        assert result == []

    async def test_numeric_asset_id_passes_int_conversion(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        # Not configured — _post returns {"error": ...}, which causes .get("content", []) = []
        adapter = AtlasCMMS()
        result = await adapter.list_pm_schedules(asset_id="7")
        assert isinstance(result, list)

    async def test_none_asset_id_omits_asset_field(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        adapter = AtlasCMMS()
        result = await adapter.list_pm_schedules(asset_id=None)
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# MaintainX adapter
# ---------------------------------------------------------------------------


class TestMaintainXApiKey:
    """MaintainX stores its key on self.api_key; no configured property."""

    def test_api_key_set_when_env_present(self, monkeypatch):
        monkeypatch.setenv("MAINTAINX_API_KEY", "mx_live_abc123")
        assert MaintainXCMMS().api_key == "mx_live_abc123"

    def test_api_key_empty_when_env_absent(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        assert MaintainXCMMS().api_key == ""


class TestMaintainXUnconfiguredReturnsError:
    async def test_get_returns_error(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        result = await MaintainXCMMS()._get("/workorders")
        assert "error" in result

    async def test_post_returns_error(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        result = await MaintainXCMMS()._post("/workorders", {})
        assert "error" in result

    async def test_patch_returns_error(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        result = await MaintainXCMMS()._patch("/workorders/1", {})
        assert "error" in result


class TestMaintainXCreateWorkOrderGuard:
    async def test_non_numeric_asset_id_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        adapter = MaintainXCMMS()
        result = await adapter.create_work_order(
            title="VFD fault",
            description="Overcurrent on VFD-001",
            asset_id="vfd-001",
        )
        assert "error" in result
        assert "vfd-001" in result["error"]

    async def test_none_asset_id_skips_conversion(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        adapter = MaintainXCMMS()
        result = await adapter.create_work_order(
            title="Test",
            description="Test",
            asset_id=None,
        )
        # _post returns {"error": ...} from unconfigured path — still a dict
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Limble adapter
# ---------------------------------------------------------------------------


class TestLimbleApiKey:
    """Limble stores its key on self.api_key; no configured property."""

    def test_api_key_set_when_env_present(self, monkeypatch):
        monkeypatch.setenv("LIMBLE_API_KEY", "lmb_live_xyz")
        assert LimbleCMMS().api_key == "lmb_live_xyz"

    def test_api_key_empty_when_env_absent(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        assert LimbleCMMS().api_key == ""


class TestLimbleUnconfiguredReturnsError:
    async def test_get_returns_error(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        result = await LimbleCMMS()._get("/tasks")
        assert "error" in result

    async def test_post_returns_error(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        result = await LimbleCMMS()._post("/tasks", {})
        assert "error" in result

    async def test_patch_returns_error(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        result = await LimbleCMMS()._patch("/tasks/1", {})
        assert "error" in result


class TestLimbleCreateWorkOrderGuard:
    async def test_non_numeric_asset_id_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        adapter = LimbleCMMS()
        result = await adapter.create_work_order(
            title="VFD fault",
            description="Overcurrent on VFD-001",
            asset_id="vfd-001",
        )
        assert "error" in result
        assert "vfd-001" in result["error"]

    async def test_empty_string_asset_id_skips_conversion(self, monkeypatch):
        # Limble checks `if asset_id:` — empty string is falsy, no int() attempted
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        adapter = LimbleCMMS()
        result = await adapter.create_work_order(
            title="Test",
            description="Test",
            asset_id="",
        )
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Fiix adapter
# ---------------------------------------------------------------------------


class TestFiixApiKey:
    """Fiix stores its key on self.api_key; no configured property."""

    def test_api_key_set_when_env_present(self, monkeypatch):
        monkeypatch.setenv("FIIX_API_KEY", "fiix_live_abc")
        assert FiixCMMS().api_key == "fiix_live_abc"

    def test_api_key_empty_when_env_absent(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        assert FiixCMMS().api_key == ""


class TestFiixUnconfiguredReturnsError:
    async def test_get_returns_error(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        result = await FiixCMMS()._get("/work-orders")
        assert "error" in result

    async def test_post_returns_error(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        result = await FiixCMMS()._post("/work-orders", {})
        assert "error" in result

    async def test_patch_returns_error(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        result = await FiixCMMS()._patch("/work-orders/1", {})
        assert "error" in result


class TestFiixCreateWorkOrderGuard:
    async def test_non_numeric_asset_id_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        adapter = FiixCMMS()
        result = await adapter.create_work_order(
            title="VFD fault",
            description="Overcurrent on VFD-001",
            asset_id="vfd-001",
        )
        assert "error" in result
        assert "vfd-001" in result["error"]

    async def test_numeric_string_asset_id_passes_guard(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        adapter = FiixCMMS()
        result = await adapter.create_work_order(
            title="Test",
            description="Test",
            asset_id="99",
        )
        # _post returns {"error": ...} from unconfigured path — no exception
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Cross-adapter: unconfigured state returns error dicts, never raises
# ---------------------------------------------------------------------------


class TestUnconfiguredNeverRaises:
    """When credentials are absent, every adapter method returns a dict/list, not an exception.

    Atlas uses a configured property; MaintainX / Limble / Fiix check self.api_key directly.
    """

    def test_atlas_configured_false(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        assert AtlasCMMS().configured is False

    def test_maintainx_api_key_empty(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        assert MaintainXCMMS().api_key == ""

    def test_limble_api_key_empty(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        assert LimbleCMMS().api_key == ""

    def test_fiix_api_key_empty(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        assert FiixCMMS().api_key == ""

    async def test_atlas_get_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("ATLAS_API_USER", raising=False)
        monkeypatch.delenv("ATLAS_API_PASSWORD", raising=False)
        result = await AtlasCMMS()._get("/assets")
        assert isinstance(result, dict)
        assert "error" in result

    async def test_maintainx_get_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("MAINTAINX_API_KEY", raising=False)
        result = await MaintainXCMMS()._get("/workorders")
        assert isinstance(result, dict)
        assert "error" in result

    async def test_limble_get_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("LIMBLE_API_KEY", raising=False)
        result = await LimbleCMMS()._get("/tasks")
        assert isinstance(result, dict)
        assert "error" in result

    async def test_fiix_get_returns_error_dict(self, monkeypatch):
        monkeypatch.delenv("FIIX_API_KEY", raising=False)
        result = await FiixCMMS()._get("/work-orders")
        assert isinstance(result, dict)
        assert "error" in result
