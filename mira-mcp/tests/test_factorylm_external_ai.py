"""Tests for the governed FactoryLM External AI conveyor connector tools."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_MCP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_MCP_ROOT))

from factorylm_external_ai.conveyor_context import ConveyorContextSDK
from factorylm_external_ai.mcp_server import TOOL_NAMES, build_mcp_toolset


def test_mcp_toolset_exposes_only_read_only_factorylm_tools():
    tools = build_mcp_toolset(ConveyorContextSDK())

    assert set(tools) == set(TOOL_NAMES)
    assert not any("write" in name or "start" in name or "stop" in name for name in tools)
    for definition in tools.values():
        assert definition["annotations"]["readOnlyHint"] is True
        assert definition["annotations"]["destructiveHint"] is False
        assert definition["annotations"]["openWorldHint"] is False
        assert definition["output_schema"]["type"] == "object"


def test_find_asset_returns_approved_garage_conveyor_context():
    sdk = ConveyorContextSDK()

    result = sdk.find_asset("conveyor")

    assert result["status"] == "ok"
    assert result["asset"]["asset_id"] == "conveyor_1"
    assert result["asset"]["name"] == "Conveyor 1"
    assert result["asset"]["uns_path"] == "enterprise.home_garage.conveyor_lab.conveyor_1"
    assert result["approval_status"] == "verified"
    assert result["confidence"] >= 0.9
    assert result["warnings"] == []


def test_tag_context_lookup_returns_explicit_not_found_for_missing_tag():
    sdk = ConveyorContextSDK()

    result = sdk.get_tag_context("does_not_exist")

    assert result["status"] == "not_found"
    assert result["tag"] is None
    assert result["warnings"] == ["missing_tag"]
    assert "does_not_exist" in result["message"]


def test_search_evidence_excludes_unapproved_documents_by_default():
    sdk = ConveyorContextSDK()

    result = sdk.search_evidence("90 Hz")

    assert result["status"] == "not_found"
    assert result["evidence"] == []
    assert result["warnings"] == ["missing_approved_evidence"]


def test_diagnostic_context_is_evidence_backed_and_non_control():
    sdk = ConveyorContextSDK()

    result = sdk.get_diagnostic_context("conveyor not running")

    assert result["status"] == "ok"
    assert result["asset"]["asset_id"] == "conveyor_1"
    assert result["diagnostics"]
    assert all("citation_ids" in item for item in result["diagnostics"])
    joined = json.dumps(result).lower()
    assert "start conveyor" not in joined
    assert "write tag" not in joined


def test_live_value_uses_safe_read_only_provider_and_reports_freshness():
    sdk = ConveyorContextSDK(
        live_values={
            "default_conveyor_motor_running": {
                "value": True,
                "quality": "good",
                "freshness_status": "fresh",
                "last_seen_at": "2026-06-24T12:00:00Z",
            }
        }
    )

    result = sdk.get_live_value("default_conveyor_motor_running")

    assert result["status"] == "ok"
    assert result["tag"]["tag_id"] == "default_conveyor_motor_running"
    assert result["live_value"]["value"] is True
    assert result["live_value"]["quality"] == "good"
    assert result["live_value"]["freshness_status"] == "fresh"


def test_live_value_missing_is_deterministic_not_guessing():
    sdk = ConveyorContextSDK()

    result = sdk.get_live_value("default_conveyor_motor_running")

    assert result["status"] == "not_available"
    assert result["live_value"] is None
    assert result["warnings"] == ["live_value_missing"]


def test_conveyor_status_combines_context_and_available_live_values():
    sdk = ConveyorContextSDK(
        live_values={
            "default_conveyor_motor_running": {"value": False, "quality": "good"},
            "default_conveyor_estop_active": {"value": False, "quality": "good"},
            "default_conveyor_fault_alarm": {"value": True, "quality": "good"},
            "default_mira_iocheck_vfd_vfd_frequency": {"value": 0.0, "quality": "good"},
        }
    )

    result = sdk.get_conveyor_status()

    assert result["status"] == "ok"
    assert result["asset"]["asset_id"] == "conveyor_1"
    assert result["state"]["running"] is False
    assert result["state"]["fault_alarm"] is True
    assert result["state"]["vfd_hz"] == 0.0
    assert result["warnings"] == []
