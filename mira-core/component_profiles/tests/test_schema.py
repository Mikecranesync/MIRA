"""Tests for ComponentProfile schema — validation + auto-review-flag logic."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from component_profiles.schema import (
    ComponentProfile,
    Confidence,
    CopyrightHandling,
    DocumentType,
    FaultCode,
    SafetyWarning,
    Severity,
    SourceDocument,
)


def _minimal_payload(overall: float = 0.9) -> dict:
    return {
        "component_type": "variable_frequency_drive",
        "confidence": {"overall": overall},
    }


def test_minimal_profile_validates():
    p = ComponentProfile(**_minimal_payload())
    assert p.component_type == "variable_frequency_drive"
    assert p.fault_codes == []
    assert p.confidence.overall == 0.9
    assert p.confidence.needs_human_review is False


def test_low_confidence_flips_review_flag():
    p = ComponentProfile(**_minimal_payload(overall=0.5))
    assert p.confidence.needs_human_review is True


def test_critical_fault_flips_review_flag():
    payload = _minimal_payload()
    payload["fault_codes"] = [
        {"code": "F012", "severity": "critical"},
        {"code": "F002", "severity": "low"},
    ]
    p = ComponentProfile(**payload)
    assert p.confidence.needs_human_review is True


def test_safety_warning_flips_review_flag():
    payload = _minimal_payload()
    payload["safety_warnings"] = [{"warning": "De-energize before opening cover"}]
    p = ComponentProfile(**payload)
    assert p.confidence.needs_human_review is True


def test_no_triggers_keeps_review_flag_false():
    payload = _minimal_payload()
    payload["fault_codes"] = [{"code": "F012", "severity": "low"}]
    p = ComponentProfile(**payload)
    assert p.confidence.needs_human_review is False


def test_overall_out_of_range_rejected():
    with pytest.raises(ValidationError):
        ComponentProfile(**_minimal_payload(overall=1.5))


def test_extra_fields_rejected():
    payload = _minimal_payload()
    payload["bogus_field"] = "nope"
    with pytest.raises(ValidationError):
        ComponentProfile(**payload)


def test_fault_code_severity_enum_strict():
    payload = _minimal_payload()
    payload["fault_codes"] = [{"code": "F012", "severity": "kinda-bad"}]
    with pytest.raises(ValidationError):
        ComponentProfile(**payload)


def test_source_document_defaults():
    payload = _minimal_payload()
    payload["source_documents"] = [{"title": "PowerFlex 525 UM001"}]
    p = ComponentProfile(**payload)
    sd = p.source_documents[0]
    assert sd.document_type == DocumentType.MANUAL
    assert sd.copyright_handling == CopyrightHandling.LINK_ONLY


def test_round_trip_json():
    payload = _minimal_payload(overall=0.85)
    payload["manufacturer"] = "Allen-Bradley"
    payload["series"] = "PowerFlex 525"
    payload["model_numbers"] = ["25B-D2P3N104", "25B-D4P0N104"]
    payload["fault_codes"] = [
        {
            "code": "F004",
            "meaning": "Undervoltage",
            "likely_causes": ["Input power loss", "Brownout"],
            "technician_steps": ["Check input voltage at L1/L2/L3"],
            "reset_method": "Cycle power",
            "severity": "medium",
            "page_reference": "p.47",
        }
    ]
    p = ComponentProfile(**payload)
    blob = p.model_dump_json()
    p2 = ComponentProfile.model_validate_json(blob)
    assert p2 == p


def test_confidence_missing_information_flows_through():
    payload = _minimal_payload(overall=0.65)
    payload["confidence"]["missing_information"] = ["No PM table found"]
    p = ComponentProfile(**payload)
    assert p.confidence.missing_information == ["No PM table found"]
    assert p.confidence.needs_human_review is True


def test_load_from_external_json():
    raw = json.dumps(_minimal_payload(overall=0.9))
    p = ComponentProfile.model_validate_json(raw)
    assert p.component_type == "variable_frequency_drive"
