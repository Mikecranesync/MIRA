"""Tests for the create_asset_from_nameplate MCP tool in mira-mcp/server.py.

Covers:
- Tool returns error dict when tenant is not provisioned (resolver returns None)
- Tool calls AtlasCMMS.for_tenant with correct (email, password, api_url)
- Tool calls atlas.create_asset with correct name and description
- Description includes only the non-empty nameplate fields
- Tool returns whatever atlas.create_asset returns (pass-through)
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Make mira-mcp importable without installing it
REPO_ROOT = Path(__file__).parent.parent
MIRA_MCP = REPO_ROOT / "mira-mcp"
if str(MIRA_MCP) not in sys.path:
    sys.path.insert(0, str(MIRA_MCP))

# ---------------------------------------------------------------------------
# Stub out heavy server-level dependencies so we can import server.py cleanly
# in the test runner without Docker / FastMCP / SQLite running.
# ---------------------------------------------------------------------------


def _install_server_stubs() -> None:
    """Inject lightweight stubs for modules that server.py imports at the top level
    but that are not available in the offline test environment."""
    # fastmcp — only need FastMCP constructor + .tool() decorator
    if "fastmcp" not in sys.modules:
        fastmcp_stub = types.ModuleType("fastmcp")

        class _FakeMCP:
            def __init__(self, *args, **kwargs):
                pass

            def tool(self):
                def decorator(fn):
                    return fn

                return decorator

        fastmcp_stub.FastMCP = _FakeMCP
        sys.modules["fastmcp"] = fastmcp_stub

    # starlette.middleware.base and starlette.responses
    for mod_path in (
        "starlette",
        "starlette.middleware",
        "starlette.middleware.base",
        "starlette.responses",
    ):
        if mod_path not in sys.modules:
            sys.modules[mod_path] = types.ModuleType(mod_path)

    starlette_mw_base = sys.modules["starlette.middleware.base"]
    if not hasattr(starlette_mw_base, "BaseHTTPMiddleware"):
        starlette_mw_base.BaseHTTPMiddleware = object  # type: ignore[attr-defined]

    starlette_responses = sys.modules["starlette.responses"]
    if not hasattr(starlette_responses, "JSONResponse"):
        starlette_responses.JSONResponse = dict  # type: ignore[attr-defined]


_install_server_stubs()

# Patch _ensure_schema so server.py does not try to open a real SQLite DB
# during module-level initialisation, and point DB_PATH to /tmp so the
# sqlite3.connect() inside server module-level code never fires a real path.
import os  # noqa: E402 (needed before the patch)

os.environ.setdefault("MIRA_DB_PATH", ":memory:")

with patch("sqlite3.connect"):
    # Now we can import server.py safely — _ensure_schema runs but connect is mocked
    from server import create_asset_from_nameplate  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TENANT_ID = "78917b56-aaaa-bbbb-cccc-000000000001"
_EMAIL = "acme@factorylm.com"
_PASSWORD = "derivedpassword12345678901234"  # 29 chars, representative
_API_URL = "http://atlas-api:8080"
_CREDS = (_EMAIL, _PASSWORD, _API_URL)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_atlas(create_asset_return: dict) -> MagicMock:
    """Return a mock AtlasCMMS instance whose create_asset is pre-configured."""
    mock_atlas = MagicMock()
    mock_atlas.create_asset = AsyncMock(return_value=create_asset_return)
    return mock_atlas


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_error_when_tenant_not_provisioned():
    """Tool returns an error dict when resolve_atlas_creds returns None."""
    with patch("server.resolve_atlas_creds", new=AsyncMock(return_value=None)):
        result = await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Allen-Bradley",
            model="1336 PLUS II",
        )

    assert "error" in result
    assert _TENANT_ID in result["error"]


@pytest.mark.asyncio
async def test_calls_for_tenant_with_resolved_creds():
    """AtlasCMMS.for_tenant must be called with the creds from the resolver."""
    mock_atlas = _make_mock_atlas({"id": 42, "name": "Allen-Bradley 1336 PLUS II"})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas) as mock_for_tenant,
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Allen-Bradley",
            model="1336 PLUS II",
        )

    mock_for_tenant.assert_called_once_with(_EMAIL, _PASSWORD, _API_URL)


@pytest.mark.asyncio
async def test_create_asset_called_with_correct_name():
    """Asset name is 'manufacturer model' with no extra whitespace."""
    mock_atlas = _make_mock_atlas({"id": 7})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Baldor",
            model="VM3546T",
        )

    mock_atlas.create_asset.assert_called_once()
    call_kwargs = mock_atlas.create_asset.call_args.kwargs
    assert call_kwargs["name"] == "Baldor VM3546T"


@pytest.mark.asyncio
async def test_create_asset_description_includes_all_nameplate_fields():
    """Description must include serial, voltage, hp, and fla when all are provided."""
    mock_atlas = _make_mock_atlas({"id": 8})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Baldor",
            model="VM3546T",
            serial="SN12345",
            voltage="460V",
            hp="25HP",
            fla="32A",
        )

    call_kwargs = mock_atlas.create_asset.call_args.kwargs
    desc = call_kwargs["description"]
    assert "SN12345" in desc
    assert "460V" in desc
    assert "25HP" in desc
    assert "32A" in desc


@pytest.mark.asyncio
async def test_create_asset_description_omits_empty_fields():
    """Description must not include labels for fields that were not provided."""
    mock_atlas = _make_mock_atlas({"id": 9})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Siemens",
            model="1LA7",
            voltage="230V",
            # serial, hp, fla intentionally omitted
        )

    call_kwargs = mock_atlas.create_asset.call_args.kwargs
    desc = call_kwargs["description"]
    assert "Serial" not in desc
    assert "HP" not in desc
    assert "FLA" not in desc
    assert "230V" in desc


@pytest.mark.asyncio
async def test_returns_atlas_create_asset_result():
    """Tool return value is the dict returned by atlas.create_asset (pass-through)."""
    atlas_response = {"id": 42, "name": "Allen-Bradley 1336 PLUS II", "status": "active"}
    mock_atlas = _make_mock_atlas(atlas_response)

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        result = await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Allen-Bradley",
            model="1336 PLUS II",
            serial="AB9999",
        )

    assert result == atlas_response


@pytest.mark.asyncio
async def test_create_asset_passes_serial_manufacturer_model():
    """Serial, manufacturer, and model are forwarded to atlas.create_asset."""
    mock_atlas = _make_mock_atlas({"id": 10})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Rockwell",
            model="PowerFlex 525",
            serial="PF-XYZ-001",
        )

    call_kwargs = mock_atlas.create_asset.call_args.kwargs
    assert call_kwargs["manufacturer"] == "Rockwell"
    assert call_kwargs["model"] == "PowerFlex 525"
    assert call_kwargs["serial"] == "PF-XYZ-001"


@pytest.mark.asyncio
async def test_empty_description_when_no_optional_fields():
    """Description is empty string when serial/voltage/hp/fla are all omitted."""
    mock_atlas = _make_mock_atlas({"id": 11})

    with (
        patch("server.resolve_atlas_creds", new=AsyncMock(return_value=_CREDS)),
        patch("server.AtlasCMMS.for_tenant", return_value=mock_atlas),
    ):
        await create_asset_from_nameplate(
            tenant_id=_TENANT_ID,
            manufacturer="Baldor",
            model="VM3546T",
        )

    call_kwargs = mock_atlas.create_asset.call_args.kwargs
    assert call_kwargs["description"] == ""
