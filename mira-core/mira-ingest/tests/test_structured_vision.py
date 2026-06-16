"""Tests for structured vision output parsing (#220 Bug D)."""

from __future__ import annotations

import sys
from pathlib import Path

# Add mira-ingest to path so we can import main's helpers without running the app
INGEST_ROOT = Path(__file__).parent.parent
if str(INGEST_ROOT) not in sys.path:
    sys.path.insert(0, str(INGEST_ROOT))


# ── _parse_structured_description ──────────────────────────────────────────


class TestParseStructured:
    def test_parses_clean_json(self):
        from main import _parse_structured_description

        raw = (
            '{"component": "GS20 VFD", "symptom": "F004 fault", '
            '"condition": "faulted", '
            '"description": "GS20 VFD showing F004 overcurrent fault"}'
        )
        result = _parse_structured_description(raw)
        assert result["component"] == "GS20 VFD"
        assert result["symptom"] == "F004 fault"
        assert result["condition"] == "faulted"
        assert "overcurrent" in result["description"]

    def test_strips_markdown_fences(self):
        from main import _parse_structured_description

        raw = '```json\n{"component": "PF525", "symptom": "", "condition": "", "description": "PowerFlex 525"}\n```'
        result = _parse_structured_description(raw)
        assert result["component"] == "PF525"

    def test_extracts_embedded_json_from_prose(self):
        from main import _parse_structured_description

        raw = 'Here is the analysis: {"component": "motor", "symptom": "bearing noise", "condition": "operating", "description": "Motor nameplate"} hope this helps!'
        result = _parse_structured_description(raw)
        assert result["component"] == "motor"
        assert result["symptom"] == "bearing noise"

    def test_fallback_when_not_json(self):
        from main import _parse_structured_description

        raw = "This is a VFD showing a fault code. Check input voltage."
        result = _parse_structured_description(raw)
        assert result["description"] == raw
        assert result["component"] == ""
        assert result["symptom"] == ""
        assert result["condition"] == ""

    def test_empty_input_returns_default_dict(self):
        from main import _parse_structured_description

        result = _parse_structured_description("")
        assert set(result.keys()) == {"component", "symptom", "condition", "description"}
        assert all(v == "" for v in result.values())

    def test_missing_fields_default_to_empty(self):
        """JSON with only a subset of fields gets defaults for the rest."""
        from main import _parse_structured_description

        raw = '{"component": "pump", "description": "centrifugal pump"}'
        result = _parse_structured_description(raw)
        assert result["component"] == "pump"
        assert result["description"] == "centrifugal pump"
        assert result["symptom"] == ""
        assert result["condition"] == ""

    def test_non_dict_json_falls_back(self):
        """If LLM returns a list or string, fallback to default shape."""
        from main import _parse_structured_description

        raw = '["not", "a", "dict"]'
        result = _parse_structured_description(raw)
        assert result["description"] == raw

    def test_coerces_non_string_values(self):
        """Numeric or nested values are coerced to strings."""
        from main import _parse_structured_description

        raw = '{"component": 42, "symptom": null, "condition": true, "description": "test"}'
        result = _parse_structured_description(raw)
        # All values are strings after parsing
        for k in ("component", "symptom", "condition", "description"):
            assert isinstance(result[k], str)


# ── Prompt structure tests ────────────────────────────────────────────────


class TestPromptStructure:
    def test_prompt_requests_json(self):
        """DESCRIBE_SYSTEM tells the model to return JSON."""
        from main import DESCRIBE_SYSTEM

        assert "JSON" in DESCRIBE_SYSTEM or "json" in DESCRIBE_SYSTEM

    def test_prompt_names_four_fields(self):
        """Prompt mentions all four structured fields."""
        from main import DESCRIBE_SYSTEM

        for field in ("component", "symptom", "condition", "description"):
            assert field in DESCRIBE_SYSTEM, f"Missing field in prompt: {field}"

    def test_prompt_blocks_invented_fault_codes(self):
        """Prompt says never invent fault codes (Rule 10 alignment)."""
        from main import DESCRIBE_SYSTEM

        assert "Never invent" in DESCRIBE_SYSTEM or "never invent" in DESCRIBE_SYSTEM.lower()
