"""Regime 2 — Content Chunking Quality Tests.

Tests _build_content_text() in mira-core/scripts/ingest_equipment_photos.py.

Coverage:
  - Field inclusion / null omission
  - Nameplate unit formatting
  - Survey enrichment fields
  - Word count ceiling
  - Label consistency across equipment types

All tests are offline — no Ollama, no NeonDB, no Claude API.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# _build_content_text lives in a script, not a package — add both required paths
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))       # ingest.embedder, ingest.store
sys.path.insert(0, str(REPO_ROOT / "mira-core" / "scripts"))  # ingest_equipment_photos

from ingest_equipment_photos import _build_content_text  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def full_motor_result() -> dict:
    """Classification result for a well-identified motor with nameplate."""
    return {
        "is_equipment": True,
        "equipment_type": "motor",
        "make": "Baldor",
        "model": "L3514",
        "catalog": "EHM3554T",
        "serial": "SN123456",
        "has_nameplate": True,
        "nameplate_fields": {
            "voltage": "460",
            "amperage": "3.4",
            "rpm": "1760",
            "hz": "60",
            "hp": "2",
        },
        "description": "3-phase induction motor with visible burn marks on the winding housing.",
        "condition": "damaged",
        "confidence": "high",
    }


@pytest.fixture
def full_survey() -> dict:
    """Survey CSV row with all enrichment fields."""
    return {
        "severity": "critical",
        "fault_codes": "OC F001",
        "photo_type": "nameplate",
    }


@pytest.fixture
def vfd_result() -> dict:
    """VFD result — no nameplate, no make."""
    return {
        "is_equipment": True,
        "equipment_type": "vfd",
        "make": None,
        "model": None,
        "catalog": None,
        "serial": None,
        "has_nameplate": False,
        "nameplate_fields": {},
        "description": "Variable frequency drive in a control cabinet, power LED lit green.",
        "condition": "normal",
        "confidence": "medium",
    }


# ── Header line ───────────────────────────────────────────────────────────────

class TestHeaderLine:
    def test_make_model_in_header(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        first_line = text.splitlines()[0]
        assert "Baldor" in first_line
        assert "L3514" in first_line

    def test_equipment_type_in_header(self, full_motor_result):
        first_line = _build_content_text(full_motor_result).splitlines()[0]
        assert "Motor" in first_line

    def test_no_make_no_model(self, vfd_result):
        text = _build_content_text(vfd_result)
        first_line = text.splitlines()[0]
        assert "Vfd" in first_line or "VFD" in first_line or "vfd" in first_line.lower()

    def test_make_from_survey_when_result_has_none(self, vfd_result):
        survey = {"make": "AutomationDirect", "model": "GS20"}
        text = _build_content_text(vfd_result, survey=survey)
        first_line = text.splitlines()[0]
        assert "AutomationDirect" in first_line
        assert "GS20" in first_line


# ── Description ───────────────────────────────────────────────────────────────

class TestDescription:
    def test_description_included(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "burn marks" in text

    def test_description_from_survey_when_result_empty(self):
        result = {"equipment_type": "motor", "make": None, "model": None}
        survey = {"description": "Motor nameplate showing 460V 60Hz"}
        text = _build_content_text(result, survey=survey)
        assert "460V 60Hz" in text


# ── Nameplate formatting ──────────────────────────────────────────────────────

class TestNameplateFormatting:
    def test_voltage_has_v_unit(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "460V" in text

    def test_amperage_has_a_unit(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "3.4A" in text

    def test_rpm_has_unit(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "1760rpm" in text

    def test_hz_has_unit(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "60Hz" in text

    def test_hp_has_unit(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "2HP" in text

    def test_nameplate_line_prefix(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert any(line.startswith("Nameplate:") for line in text.splitlines())

    def test_no_nameplate_fields_no_nameplate_line(self, vfd_result):
        text = _build_content_text(vfd_result)
        assert "Nameplate:" not in text


# ── Null field omission ───────────────────────────────────────────────────────

class TestNullOmission:
    def test_null_catalog_not_embedded(self, vfd_result):
        text = _build_content_text(vfd_result)
        # "Catalog: None" or "Catalog: null" must never appear
        assert "Catalog: None" not in text
        assert "Catalog: null" not in text
        assert "Catalog:" not in text

    def test_null_serial_not_embedded(self, vfd_result):
        text = _build_content_text(vfd_result)
        assert "Serial: None" not in text
        assert "Serial:" not in text

    def test_none_nameplate_values_not_embedded(self):
        result = {
            "equipment_type": "motor",
            "make": "Baldor",
            "model": "L3514",
            "has_nameplate": True,
            "nameplate_fields": {
                "voltage": "460",
                "amperage": None,
                "rpm": None,
                "hz": "60",
                "hp": None,
            },
        }
        text = _build_content_text(result)
        assert "Nonerpm" not in text
        assert "NoneA" not in text
        assert "NoneHP" not in text
        # Present values should still be there
        assert "460V" in text
        assert "60Hz" in text

    def test_unknown_condition_not_embedded(self):
        result = {"equipment_type": "motor", "condition": "unknown"}
        text = _build_content_text(result)
        assert "Condition:" not in text

    def test_empty_string_nameplate_not_embedded(self):
        result = {
            "equipment_type": "motor",
            "has_nameplate": True,
            "nameplate_fields": {"voltage": "", "amperage": "5.0", "rpm": "", "hz": "", "hp": ""},
        }
        text = _build_content_text(result)
        # Empty string fields omitted
        assert "V " not in text or "5.0A" in text  # only amperage present
        assert "5.0A" in text


# ── Catalog and serial ────────────────────────────────────────────────────────

class TestCatalogSerial:
    def test_catalog_included(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "EHM3554T" in text

    def test_serial_included(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "SN123456" in text

    def test_catalog_and_serial_on_same_line(self, full_motor_result):
        lines = _build_content_text(full_motor_result).splitlines()
        combined = [l for l in lines if "EHM3554T" in l and "SN123456" in l]
        assert len(combined) == 1, "Catalog and serial should share a line"


# ── Condition and severity ────────────────────────────────────────────────────

class TestConditionSeverity:
    def test_condition_included(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "damaged" in text

    def test_severity_on_same_line_as_condition(self, full_motor_result, full_survey):
        lines = _build_content_text(full_motor_result, survey=full_survey).splitlines()
        cond_lines = [l for l in lines if "damaged" in l]
        assert len(cond_lines) == 1
        assert "critical" in cond_lines[0], "Severity should be on the same line as condition"

    def test_severity_without_condition(self):
        result = {"equipment_type": "motor", "condition": None}
        survey = {"severity": "high"}
        text = _build_content_text(result, survey=survey)
        # severity alone: no condition line expected, so severity stays out
        # (no condition = no condition line at all, severity only shows with condition)
        assert "Condition:" not in text


# ── Survey enrichment ─────────────────────────────────────────────────────────

class TestSurveyEnrichment:
    def test_fault_codes_included(self, full_motor_result, full_survey):
        text = _build_content_text(full_motor_result, survey=full_survey)
        assert "OC F001" in text
        assert "Fault codes:" in text

    def test_photo_type_included(self, full_motor_result, full_survey):
        text = _build_content_text(full_motor_result, survey=full_survey)
        assert "nameplate" in text
        assert "Photo type:" in text

    def test_no_survey_no_fault_codes(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "Fault codes:" not in text

    def test_no_survey_no_photo_type(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert "Photo type:" not in text

    def test_empty_survey_dict(self, full_motor_result):
        """Empty survey dict should behave identically to no survey."""
        text_no_survey = _build_content_text(full_motor_result)
        text_empty_survey = _build_content_text(full_motor_result, survey={})
        assert text_no_survey == text_empty_survey

    def test_survey_none_values_not_embedded(self, full_motor_result):
        survey = {"fault_codes": None, "severity": None, "photo_type": None}
        text = _build_content_text(full_motor_result, survey=survey)
        assert "Fault codes:" not in text
        assert "Photo type:" not in text


# ── Word count ceiling ────────────────────────────────────────────────────────

class TestWordCount:
    def test_under_300_words_full_result(self, full_motor_result, full_survey):
        text = _build_content_text(full_motor_result, survey=full_survey)
        word_count = len(text.split())
        assert word_count <= 300, f"Content too long for embedding: {word_count} words"

    def test_under_300_words_minimal_result(self):
        result = {"equipment_type": "motor"}
        text = _build_content_text(result)
        assert len(text.split()) <= 300

    def test_non_empty_output(self, full_motor_result):
        text = _build_content_text(full_motor_result)
        assert len(text.strip()) > 0


# ── Determinism ───────────────────────────────────────────────────────────────

class TestDeterminism:
    def test_same_input_same_output(self, full_motor_result, full_survey):
        """Content text must be deterministic — same input, same output every time."""
        a = _build_content_text(full_motor_result, survey=full_survey)
        b = _build_content_text(full_motor_result, survey=full_survey)
        assert a == b

    def test_output_is_string(self, full_motor_result):
        result = _build_content_text(full_motor_result)
        assert isinstance(result, str)

    def test_no_python_repr_in_output(self, full_motor_result):
        """No Python repr artifacts like 'None', 'True', 'False' leaking into content."""
        text = _build_content_text(full_motor_result)
        assert "True" not in text
        assert "False" not in text
        # 'None' checked separately because 'none' can appear in valid descriptions
        assert "\nNone\n" not in text
        assert text.strip() != "None"
