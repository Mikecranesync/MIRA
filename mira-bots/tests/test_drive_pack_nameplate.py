"""Tests for nameplate-photo → drive-pack resolution (Task 4, ADR-0025 §1a).

Fixtures mirror the real structured-vision output shape produced by
``mira-core/mira-ingest/main.py::_parse_structured_description`` (see
``mira-core/mira-ingest/tests/test_structured_vision.py``):
``{"component": ..., "symptom": ..., "condition": ..., "description": ...}``.
No vision/LLM call happens here — these dicts are hand-built fixtures.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import DrivePack, resolve_pack_from_vision

PACK_ID = "durapulse_gs10"


def test_resolves_via_component_full_series_name():
    vision_output = {
        "component": "DURApulse GS10",
        "symptom": "",
        "condition": "faulted",
        "description": "DURApulse GS10 VFD nameplate",
    }
    pack = resolve_pack_from_vision(vision_output)
    assert isinstance(pack, DrivePack)
    assert pack.pack_id == PACK_ID


def test_resolves_via_component_with_symptom_present():
    """The real structured-vision shape: component + symptom + condition."""
    vision_output = {
        "component": "GS10 VFD",
        "symptom": "F004 fault",
        "condition": "faulted",
        "description": "GS10 VFD showing F004 overcurrent fault",
    }
    pack = resolve_pack_from_vision(vision_output)
    assert isinstance(pack, DrivePack)
    assert pack.pack_id == PACK_ID


def test_gs20_is_honestly_none_not_stretched_to_match_gs10():
    """GS20 is a real sibling model of GS10 — NOT GS10. No GS20 pack exists
    yet, so the honest answer is None, never a false-positive GS10 match."""
    vision_output = {
        "component": "GS20 VFD",
        "symptom": "F004 fault",
        "condition": "faulted",
        "description": "GS20 VFD showing F004 overcurrent fault",
    }
    assert resolve_pack_from_vision(vision_output) is None


def test_unrelated_drive_returns_none():
    vision_output = {
        "component": "PowerFlex 525",
        "symptom": "",
        "condition": "",
        "description": "PowerFlex 525 nameplate",
    }
    assert resolve_pack_from_vision(vision_output) is None


def test_empty_dict_returns_none():
    assert resolve_pack_from_vision({}) is None


def test_component_none_returns_none_no_exception():
    assert resolve_pack_from_vision({"component": None}) is None


def test_none_input_returns_none_no_exception():
    assert resolve_pack_from_vision(None) is None


def test_non_dict_input_returns_none_no_exception():
    assert resolve_pack_from_vision("GS10 VFD") is None  # type: ignore[arg-type]


def test_missing_component_key_entirely_returns_none_no_exception():
    """A malformed vision dict lacking the 'component' key at all — must not raise."""
    assert resolve_pack_from_vision({"symptom": "F004 fault", "condition": "faulted"}) is None


def test_resolves_via_manufacturer_and_model_fields_when_no_component():
    """When 'component' is absent but manufacturer+model are present, those
    fields alone are enough to resolve the pack."""
    vision_output = {
        "manufacturer": "AutomationDirect",
        "model": "GS10",
        "symptom": "",
        "condition": "",
        "description": "",
    }
    pack = resolve_pack_from_vision(vision_output)
    assert isinstance(pack, DrivePack)
    assert pack.pack_id == PACK_ID


def test_resolves_via_description_only_when_component_absent():
    vision_output = {"description": "nameplate reads DURApulse GS10, 1HP"}
    pack = resolve_pack_from_vision(vision_output)
    assert isinstance(pack, DrivePack)
    assert pack.pack_id == PACK_ID
