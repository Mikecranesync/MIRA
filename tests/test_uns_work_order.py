"""Tests for UNS/ISA-95 work order model — mira-bots/shared/models/work_order.py."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "mira-bots"))

from shared.models.work_order import (
    UNSWorkOrder,
    apply_wo_edit,
    build_uns_wo_from_state,
    format_wo_preview,
)


# ---------------------------------------------------------------------------
# UNS topic generation
# ---------------------------------------------------------------------------


class TestUNSTopic:
    def test_full_hierarchy(self):
        wo = UNSWorkOrder(
            site="LakeWales", area="Production", line="Line1", asset="GS10-VFD-07"
        )
        assert wo.uns_topic == "FactoryLM/LakeWales/Production/Line1/GS10-VFD-07/maintenance/work_orders"

    def test_asset_only(self):
        wo = UNSWorkOrder(asset="Pump-A3")
        assert wo.uns_topic == "FactoryLM/Pump-A3/maintenance/work_orders"

    def test_no_hierarchy(self):
        wo = UNSWorkOrder()
        assert wo.uns_topic == "FactoryLM/maintenance/work_orders"

    def test_site_area_only(self):
        wo = UNSWorkOrder(site="Tampa", area="Utilities", asset="Motor-12")
        assert wo.uns_topic == "FactoryLM/Tampa/Utilities/Motor-12/maintenance/work_orders"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:
    def test_valid_wo(self):
        wo = UNSWorkOrder(asset="VFD-07", title="OC fault", fault_description="Trips on start")
        assert wo.is_valid
        assert wo.missing_fields == []

    def test_missing_asset(self):
        wo = UNSWorkOrder(title="OC fault", fault_description="Trips on start")
        assert not wo.is_valid
        assert "asset" in wo.missing_fields

    def test_missing_title(self):
        wo = UNSWorkOrder(asset="VFD-07", fault_description="Trips on start")
        assert not wo.is_valid
        assert "title" in wo.missing_fields

    def test_missing_fault_description(self):
        wo = UNSWorkOrder(asset="VFD-07", title="OC fault")
        assert not wo.is_valid
        assert "fault_description" in wo.missing_fields

    def test_all_missing(self):
        wo = UNSWorkOrder()
        assert set(wo.missing_fields) == {"asset", "title", "fault_description"}


# ---------------------------------------------------------------------------
# Preview formatting
# ---------------------------------------------------------------------------


class TestFormatPreview:
    def test_contains_asset(self):
        wo = UNSWorkOrder(asset="GS10-VFD-07", title="T", fault_description="F")
        assert "GS10-VFD-07" in format_wo_preview(wo)

    def test_contains_site_area_line(self):
        wo = UNSWorkOrder(
            site="LakeWales", area="Production", line="Line1",
            asset="VFD-07", title="T", fault_description="F",
        )
        preview = format_wo_preview(wo)
        assert "LakeWales" in preview
        assert "Production" in preview
        assert "Line1" in preview

    def test_unknown_asset_placeholder(self):
        wo = UNSWorkOrder(title="T", fault_description="F")
        assert "unknown" in format_wo_preview(wo).lower()

    def test_contains_yes_no_prompt(self):
        wo = UNSWorkOrder(asset="A", title="T", fault_description="F")
        assert "yes/no" in format_wo_preview(wo)

    def test_contains_edit_hint(self):
        wo = UNSWorkOrder(asset="A", title="T", fault_description="F")
        preview = format_wo_preview(wo)
        assert "priority" in preview.lower() or "change" in preview.lower()

    def test_fault_and_resolution_shown(self):
        wo = UNSWorkOrder(
            asset="A", title="T",
            fault_description="OC fault on startup",
            resolution="Increased accel time to 5s",
        )
        preview = format_wo_preview(wo)
        assert "OC fault on startup" in preview
        assert "Increased accel time" in preview


# ---------------------------------------------------------------------------
# Edit parsing
# ---------------------------------------------------------------------------


class TestApplyWoEdit:
    def _base(self) -> dict:
        return UNSWorkOrder(
            site="Tampa", area="Production", line="Line1",
            asset="VFD-07", title="[MIRA] VFD-07 — thermal action",
            fault_description="OC fault", priority="MEDIUM",
        ).to_dict()

    def test_priority_change(self):
        result = apply_wo_edit(self._base(), "change priority to HIGH")
        assert result is not None
        assert result["priority"] == "HIGH"

    def test_priority_critical(self):
        result = apply_wo_edit(self._base(), "set priority to CRITICAL")
        assert result["priority"] == "CRITICAL"

    def test_asset_edit(self):
        result = apply_wo_edit(self._base(), "the asset is Pump-A3")
        assert result["asset"] == "Pump-A3"

    def test_site_edit(self):
        result = apply_wo_edit(self._base(), "site is LakeWales")
        assert result["site"] == "LakeWales"

    def test_area_edit(self):
        result = apply_wo_edit(self._base(), "area is Utilities")
        assert result["area"] == "Utilities"

    def test_line_edit(self):
        result = apply_wo_edit(self._base(), "line is Line 3")
        assert result["line"] == "Line 3"

    def test_resolution_edit(self):
        result = apply_wo_edit(self._base(), "resolution is: replaced bearing, verified alignment")
        assert "replaced bearing" in result["resolution"]

    def test_no_edit_returns_none(self):
        assert apply_wo_edit(self._base(), "yes") is None
        assert apply_wo_edit(self._base(), "no") is None
        assert apply_wo_edit(self._base(), "sounds good") is None

    def test_case_insensitive(self):
        result = apply_wo_edit(self._base(), "PRIORITY HIGH")
        assert result["priority"] == "HIGH"

    def test_wo_type_edit(self):
        result = apply_wo_edit(self._base(), "change type to PREVENTIVE")
        assert result["wo_type"] == "PREVENTIVE"


# ---------------------------------------------------------------------------
# Build from FSM state
# ---------------------------------------------------------------------------


class TestBuildFromState:
    def _state(self, **overrides) -> dict:
        base = {
            "state": "RESOLVED",
            "asset_identified": "GS10 VFD Drive",
            "fault_category": "thermal",
            "context": {
                "session_context": {"site": "Tampa", "area": "Packaging"},
                "history": [
                    {"role": "user", "content": "motor tripping on OC fault"},
                    {"role": "assistant", "content": "Increase accel time C1-01 to 5s"},
                ],
            },
        }
        base.update(overrides)
        return base

    def test_site_from_session_context(self):
        wo = build_uns_wo_from_state(self._state())
        assert wo.site == "Tampa"

    def test_area_from_session_context(self):
        wo = build_uns_wo_from_state(self._state())
        assert wo.area == "Packaging"

    def test_asset_from_state(self):
        wo = build_uns_wo_from_state(self._state())
        assert "GS10 VFD Drive" in wo.asset

    def test_high_priority_for_thermal(self):
        wo = build_uns_wo_from_state(self._state())
        assert wo.priority == "HIGH"

    def test_medium_priority_default(self):
        state = self._state()
        state["fault_category"] = "mechanical"
        wo = build_uns_wo_from_state(state)
        assert wo.priority == "MEDIUM"

    def test_fault_desc_from_history_when_no_sc_field(self):
        wo = build_uns_wo_from_state(self._state())
        assert "tripping" in wo.fault_description or "OC fault" in wo.fault_description

    def test_empty_state_no_crash(self):
        wo = build_uns_wo_from_state({})
        assert isinstance(wo, UNSWorkOrder)
        assert not wo.is_valid

    def test_title_contains_asset(self):
        wo = build_uns_wo_from_state(self._state())
        assert "GS10 VFD Drive" in wo.title

    def test_to_uns_payload_roundtrip(self):
        wo = build_uns_wo_from_state(self._state())
        payload = wo.to_uns_payload()
        assert "topic" in payload
        assert "timestamp" in payload
        assert "payload" in payload
        assert payload["payload"]["site"] == "Tampa"
