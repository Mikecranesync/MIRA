"""v3 fault_entries are now REACHABLE through the answer path (D1 fix).

Before this fix, `fault_entries` (schema v3, string-keyed, case-sensitive,
per-fault citation) were parsed by the loader but consumed by no answer/card
code — so a mnemonic-coded drive (Magnetek crane VFD: `oC`, `LL1`, `bb`)
answered nothing. These tests pin the reachable behavior AND prove the int-keyed
v2 path is unchanged.

Hermetic: a synthetic v3 pack built on the committed v2 GS10 fixture (minimal
fabrication) + a monkeypatched `load_pack`. No network, no LLM, $0.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from shared.drive_packs import ask, loader

_FIX = pathlib.Path(__file__).parent / "fixtures" / "drive_packs" / "gs10_v2_pack.json"

_FAULT_ENTRIES = [
    {"fault_id": "oC", "name": "Over Current", "action": "Check motor leads and load; verify accel rate.",
     "source_citation": {"doc": "Synthetic Drive Manual", "page": "10", "excerpt": "oC Over Current fault."},
     "wire_value": None, "provenance_tier": "manual_cited"},
    {"fault_id": "OC", "name": "Output Contactor Open", "action": "Verify the output contactor and its aux contact.",
     "source_citation": {"doc": "Synthetic Drive Manual", "page": "11", "excerpt": "OC Output Contactor open."},
     "wire_value": None, "provenance_tier": "manual_cited"},
    {"fault_id": "LL1", "name": "Low Level 1", "action": "Check level sensor 1 wiring.",
     "source_citation": {"doc": "Synthetic Drive Manual", "page": "12", "excerpt": "LL1 Low Level 1."},
     "wire_value": None, "provenance_tier": "manual_cited"},
    {"fault_id": "bb", "name": "Base Block", "action": "Check the external base-block input.",
     "source_citation": {"doc": "Synthetic Drive Manual", "page": "13", "excerpt": "bb Base Block active."},
     "wire_value": 5, "references_parameters": ["P09.03"], "provenance_tier": "manual_cited"},
]


def _v3_pack():
    raw = json.loads(_FIX.read_text(encoding="utf-8"))
    raw["pack_id"] = "synthetic_v3_mnemonic"
    raw["schema_version"] = 3
    raw["fault_entries"] = _FAULT_ENTRIES
    return loader._parse_pack(raw, "synthetic_v3_mnemonic", "test-fixture")


@pytest.fixture
def v3(monkeypatch):
    pack = _v3_pack()
    monkeypatch.setattr(ask, "load_pack", lambda pid: pack)
    return pack


def test_mnemonic_fault_now_answerable(v3):
    r = ask.answer_fault_code("synthetic_v3_mnemonic", "oC")
    assert r.matched and r.answer_source == "drive_pack" and r.matched_kind == "fault"
    assert "oC" in r.answer and "Over Current" in r.answer
    # per-fault citation (D3): the entry's OWN source, not the whole pack list
    assert r.citations and r.citations[0]["page"] == "10"


def test_case_sensitive_oc_vs_OC_are_distinct(v3):
    lower = ask.answer_fault_code("synthetic_v3_mnemonic", "oC")
    upper = ask.answer_fault_code("synthetic_v3_mnemonic", "OC")
    assert lower.matched and upper.matched
    assert "Over Current" in lower.answer
    assert "Output Contactor" in upper.answer
    assert lower.answer != upper.answer  # D4: not collapsed


def test_digit_bearing_mnemonic_answerable(v3):
    r = ask.answer_fault_code("synthetic_v3_mnemonic", "LL1")
    assert r.matched and "Low Level" in r.answer


def test_numeric_wire_value_match(v3):
    r = ask.answer_fault_code("synthetic_v3_mnemonic", "5")
    assert r.matched and "Base Block" in r.answer  # bb has wire_value 5


def test_unknown_code_declines_honestly(v3):
    r = ask.answer_fault_code("synthetic_v3_mnemonic", "ZZ9")
    assert not r.matched and r.answer_source == "none" and not r.citations


def test_answer_question_reaches_fault_entries(v3):
    r = ask.answer_question("synthetic_v3_mnemonic", "on this drive, what does LL1 mean?")
    assert r.matched and r.matched_kind == "fault" and "Low Level" in r.answer


def test_ocr_extracts_digit_bearing_not_pure_letter(v3):
    pack = _v3_pack()
    # digit-bearing v3 id extracts from OCR text
    assert "LL1" in ask.extract_pack_fault_codes(pack, "the keypad display shows LL1")
    # pure-letter id stays EXPLICIT-ONLY (OCR-collision safety) — not auto-extracted
    assert "oC" not in ask.extract_pack_fault_codes(pack, "oC appears intermittently")


def test_v2_pack_unchanged_no_fault_entries():
    # a real v2 pack has no fault_entries; the int-keyed path is byte-for-byte intact
    pack = loader.load_pack("durapulse_gs10")
    assert pack.fault_entries == []
    r = ask.answer_fault_code("durapulse_gs10", "58")
    assert r.matched and "CE10" in r.answer  # int-keyed lookup still works
