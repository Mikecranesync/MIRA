"""Verification harness tests for the FactoryLM external AI stack."""

from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_MCP_ROOT = _REPO / "mira-mcp"
sys.path.insert(0, str(_MCP_ROOT))
sys.path.insert(0, str(_REPO / "scripts"))

from starlette.testclient import TestClient

from factorylm_external_ai.api_adapter import create_api_app
from factorylm_external_ai.conveyor_context import ConveyorContextSDK
from factorylm_external_ai.mcp_server import build_mcp_toolset
from verify_factorylm_external_ai_stack import (
    contains_placeholder_text,
    exposed_unsafe_names,
    response_has_required_context,
)


def test_api_adapter_wraps_sdk_asset_search_and_missing_asset():
    app = create_api_app(ConveyorContextSDK())
    client = TestClient(app)

    found = client.get("/api/external-ai/assets/search", params={"q": "conveyor"})
    assert found.status_code == 200
    found_json = found.json()
    assert found_json["status"] == "ok"
    assert found_json["asset_id"] == "conveyor_1"
    assert found_json["uns_path"] == "enterprise.home_garage.conveyor_lab.conveyor_1"

    missing = client.get("/api/external-ai/assets/search", params={"q": "boiler"})
    assert missing.status_code == 404
    missing_json = missing.json()
    assert missing_json["status"] == "not_found"
    assert missing_json["warnings"] == ["missing_asset"]


def test_api_adapter_exposes_only_read_only_routes():
    app = create_api_app(ConveyorContextSDK())
    routes = sorted(getattr(route, "path", "") for route in app.routes)

    assert not exposed_unsafe_names(routes)
    assert "/api/external-ai/assets/search" in routes
    assert "/api/external-ai/assets/{asset_id:str}/context" in routes
    assert "/api/external-ai/assets/{asset_id:str}/tags" in routes
    assert "/api/external-ai/assets/{asset_id:str}/evidence" in routes
    assert "/api/external-ai/assets/{asset_id:str}/diagnostics" in routes


def test_anti_fake_checks_reject_empty_placeholder_and_missing_context():
    assert contains_placeholder_text({"answer": "TODO placeholder conveyor response"})
    assert not response_has_required_context({})
    assert not response_has_required_context({"asset_id": "conveyor_1"})
    assert response_has_required_context(
        {
            "asset_id": "conveyor_1",
            "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
            "tags": [{"tag_id": "default_conveyor_motor_running"}],
        }
    )


def test_mcp_tool_metadata_is_callable_and_read_only():
    tools = build_mcp_toolset(ConveyorContextSDK())

    assert not exposed_unsafe_names(tools.keys())
    result = tools["factorylm_find_asset"]["handler"](query="conveyor")
    assert result["status"] == "ok"
    assert result["asset_id"] == "conveyor_1"
    for definition in tools.values():
        assert definition["annotations"]["readOnlyHint"] is True
        assert callable(definition["handler"])
