"""Tests for shared.models.work_order — apply_wo_edit, build_uns_wo_from_state, UNSWorkOrder."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.models.work_order import UNSWorkOrder, apply_wo_edit, format_wo_preview


# ---------------------------------------------------------------------------
# apply_wo_edit — field update patterns
# ---------------------------------------------------------------------------


def _draft(**kwargs) -> dict:
    return UNSWorkOrder(**kwargs).to_dict()


class TestApplyWoEdit:
    def test_fault_is_x_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "fault is high differential pressure")
        assert result is not None
        assert result["fault_description"] == "high differential pressure"

    def test_fault_description_is_x_matches(self):
        """Regression: 'fault description is X' was silently dropped before the fix."""
        d = _draft()
        result = apply_wo_edit(d, "fault description is high differential filter pressure")
        assert result is not None
        assert result["fault_description"] == "high differential filter pressure"

    def test_fault_description_is_x_with_the_prefix(self):
        """'The fault description is X' — common natural language phrasing."""
        d = _draft()
        result = apply_wo_edit(d, "The fault description is high differential filter pressure")
        assert result is not None
        assert result["fault_description"] == "high differential filter pressure"

    def test_description_is_x_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "description is overheating motor")
        assert result is not None
        assert result["fault_description"] == "overheating motor"

    def test_problem_is_x_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "problem is bearing noise on startup")
        assert result is not None
        assert result["fault_description"] == "bearing noise on startup"

    def test_issue_is_x_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "issue is VFD tripping on OL fault")
        assert result is not None
        assert result["fault_description"] == "VFD tripping on OL fault"

    def test_asset_is_x_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "asset is Koolfog Pump A3")
        assert result is not None
        assert result["asset"] == "Koolfog Pump A3"

    def test_priority_high_matches(self):
        d = _draft()
        result = apply_wo_edit(d, "change priority to HIGH")
        assert result is not None
        assert result["priority"] == "HIGH"

    def test_unrecognised_message_returns_none(self):
        d = _draft()
        result = apply_wo_edit(d, "yes please log it")
        assert result is None

    def test_does_not_mutate_original_draft(self):
        d = _draft(asset="Original")
        apply_wo_edit(d, "asset is New Asset")
        assert d["asset"] == "Original"

    def test_no_change_returns_none(self):
        d = _draft(fault_description="already set")
        result = apply_wo_edit(d, "fault is already set")
        assert result is None


# ---------------------------------------------------------------------------
# UNSWorkOrder validation
# ---------------------------------------------------------------------------


class TestUNSWorkOrderValidation:
    def test_valid_when_all_required_fields_present(self):
        wo = UNSWorkOrder(asset="Pump A3", title="[MIRA] Pump A3 action", fault_description="overheating")
        assert wo.is_valid is True

    def test_invalid_when_asset_missing(self):
        wo = UNSWorkOrder(title="[MIRA] action", fault_description="overheating")
        assert wo.is_valid is False
        assert "asset" in wo.missing_fields

    def test_invalid_when_fault_description_missing(self):
        wo = UNSWorkOrder(asset="Pump A3", title="[MIRA] Pump A3 action")
        assert wo.is_valid is False
        assert "fault_description" in wo.missing_fields

    def test_missing_fields_empty_when_valid(self):
        wo = UNSWorkOrder(asset="Pump A3", title="[MIRA] Pump A3 action", fault_description="overheating")
        assert wo.missing_fields == []


# ---------------------------------------------------------------------------
# format_wo_preview
# ---------------------------------------------------------------------------


class TestFormatWoPreview:
    def test_contains_asset(self):
        wo = UNSWorkOrder(asset="Koolfog Pump", title="[MIRA] action", fault_description="pressure")
        preview = format_wo_preview(wo)
        assert "Koolfog Pump" in preview

    def test_contains_fault_description(self):
        wo = UNSWorkOrder(asset="A", title="T", fault_description="high differential filter pressure")
        preview = format_wo_preview(wo)
        assert "high differential filter pressure" in preview

    def test_contains_confirmation_prompt(self):
        wo = UNSWorkOrder(asset="A", title="T", fault_description="F")
        preview = format_wo_preview(wo)
        assert "yes/no" in preview.lower() or "yes" in preview.lower()
