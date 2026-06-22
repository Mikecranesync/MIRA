"""Tests for the AI tag classifier.

Uses a mock completer so no LLM calls are made.
"""

from __future__ import annotations

import json
import pytest

from ingest.extractors.tag_classifier import (
    TagClassification,
    classify_tag,
    classify_tags_batch,
    _parse_response,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MockCompleter:
    """Stateless mock: pre-loaded responses keyed by call index."""

    def __init__(self, responses: list[str]):
        self._responses = responses
        self._calls = 0

    async def complete(self, messages: list[dict], max_tokens: int = 256) -> tuple[str, dict]:  # noqa: ARG002
        del messages, max_tokens  # unused in mock
        resp = self._responses[self._calls % len(self._responses)]
        self._calls += 1
        return resp, {}


def _resp(category: str, confidence: float = 0.9, component: str | None = "motor") -> str:
    return json.dumps({
        "category": category,
        "candidate_component_type": component,
        "candidate_line_token": "conveyor",
        "candidate_asset_token": "motor",
        "confidence": confidence,
    })


# ---------------------------------------------------------------------------
# TagClassification model
# ---------------------------------------------------------------------------

class TestTagClassification:
    def test_frozen(self):
        tc = TagClassification(
            tag_path="[default]Motor/Speed",
            category="motor_speed",
            candidate_component_type="motor",
            candidate_line_token=None,
            candidate_asset_token=None,
            suggested_uns_path="signal.speed.speed",
            confidence=0.9,
        )
        with pytest.raises(Exception):
            tc.category = "unknown"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------

class TestParseResponse:
    def test_valid_response(self):
        raw = _resp("motor_speed", confidence=0.9)
        result = _parse_response(raw, "[default]Motor/Speed", "")
        assert result.category == "motor_speed"
        assert result.confidence == 0.9
        assert result.candidate_component_type == "motor"

    def test_low_confidence_becomes_unknown(self):
        raw = _resp("motor_current", confidence=0.3)
        result = _parse_response(raw, "HR101", "")
        assert result.category == "unknown"

    def test_invalid_json_falls_back_to_unknown(self):
        result = _parse_response("not json", "HR100", "")
        assert result.category == "unknown"
        assert result.confidence == 0.0

    def test_empty_response_falls_back_to_unknown(self):
        result = _parse_response("", "HR100", "")
        assert result.category == "unknown"

    def test_markdown_fence_stripped(self):
        raw = "```json\n" + _resp("fault_status") + "\n```"
        result = _parse_response(raw, "C2", "")
        assert result.category == "fault_status"

    def test_unknown_category_coerced(self):
        raw = json.dumps({"category": "not_a_real_cat", "confidence": 0.9})
        result = _parse_response(raw, "tag", "")
        assert result.category == "unknown"

    def test_null_component_becomes_none(self):
        raw = json.dumps({
            "category": "setpoint",
            "candidate_component_type": "null",
            "candidate_line_token": None,
            "candidate_asset_token": None,
            "confidence": 0.8,
        })
        result = _parse_response(raw, "SP_ref", "")
        assert result.candidate_component_type is None


# ---------------------------------------------------------------------------
# UNS path building
# ---------------------------------------------------------------------------

class TestUnsPathBuilding:
    def test_path_with_equipment_anchor(self):
        raw = _resp("motor_speed")
        result = _parse_response(raw, "[default]Motor/Speed", "enterprise.factorylm.garage.bench.conveyor")
        # must start with the anchor
        assert result.suggested_uns_path.startswith("enterprise.factorylm.garage.bench.conveyor")
        # must not hand-format (no f-string style "enterprise.x.y")
        assert "signal.speed" in result.suggested_uns_path

    def test_path_without_anchor_is_relative(self):
        raw = _resp("motor_current", component="motor")
        result = _parse_response(raw, "HR101", "")
        assert "signal.current" in result.suggested_uns_path
        # relative form — no enterprise prefix
        assert not result.suggested_uns_path.startswith("enterprise.")

    def test_fault_status_signal_segment(self):
        raw = _resp("fault_status", component=None)
        result = _parse_response(raw, "C2_fault_reset", "")
        assert "signal.fault" in result.suggested_uns_path


# ---------------------------------------------------------------------------
# classify_tag (async, with mock router)
# ---------------------------------------------------------------------------

class TestClassifyTag:
    @pytest.mark.asyncio
    async def test_motor_speed_tag(self):
        router = _MockCompleter([_resp("motor_speed")])
        tag = {
            "tag_path": "[default]Mira_Monitored/Motor/Speed",
            "data_type": "float",
            "engineering_unit": "RPM",
            "description": "Motor speed in RPM from GS10 VFD output",
        }
        result = await classify_tag(tag, router)
        assert result.category == "motor_speed"
        assert result.confidence >= 0.5
        assert result.tag_path == tag["tag_path"]

    @pytest.mark.asyncio
    async def test_accepts_canonical_tag_dict(self):
        """CanonicalTag.__dict__ fields should be accepted."""
        router = _MockCompleter([_resp("motor_current")])
        tag = {
            "tag_id": "Lake_Wales.Bench.Conveyor.Motor.Current",
            "data_type": "float",
            "engineering_unit": "A",
        }
        result = await classify_tag(tag, router)
        assert result.category == "motor_current"

    @pytest.mark.asyncio
    async def test_router_failure_returns_unknown(self):
        router = _MockCompleter([""])  # empty = all providers failed
        tag = {"tag_path": "HR100", "data_type": "int"}
        result = await classify_tag(tag, router)
        assert result.category == "unknown"
        assert result.confidence == 0.0

    @pytest.mark.asyncio
    async def test_equipment_path_anchors_uns(self):
        router = _MockCompleter([_resp("motor_temp")])
        tag = {"tag_path": "[default]Motor/Temp", "data_type": "float", "engineering_unit": "C"}
        anchor = "enterprise.factorylm.garage.bench.conveyor"
        result = await classify_tag(tag, router, equipment_path=anchor)
        assert result.suggested_uns_path.startswith(anchor)


# ---------------------------------------------------------------------------
# classify_tags_batch
# ---------------------------------------------------------------------------

class TestClassifyTagsBatch:
    @pytest.mark.asyncio
    async def test_batch_returns_one_per_tag(self):
        responses = [_resp(c) for c in ["motor_speed", "motor_current", "fault_status"]]
        router = _MockCompleter(responses)
        tags = [
            {"tag_path": "HR100", "data_type": "int"},
            {"tag_path": "HR101", "data_type": "float"},
            {"tag_path": "C2",    "data_type": "bool"},
        ]
        results = await classify_tags_batch(tags, router)
        assert len(results) == 3
        assert results[0].category == "motor_speed"
        assert results[1].category == "motor_current"
        assert results[2].category == "fault_status"

    @pytest.mark.asyncio
    async def test_empty_batch(self):
        router = _MockCompleter([])
        results = await classify_tags_batch([], router)
        assert results == []
