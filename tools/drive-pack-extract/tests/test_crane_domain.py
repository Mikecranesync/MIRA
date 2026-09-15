"""Fixture tests for the crane-domain grading supplement (domain_rules).

The live G+ Mini scout run extracts an EMPTY pack, so it does NOT exercise the
crane rules — these synthetic fixtures do. Two invariants:
  1. A crane-safety fault/param present in a CRANE-family pack must be cited;
     uncited -> hard fail. Cited -> clean.
  2. The supplement is FAMILY-GATED: an identical uncited "brake" entry in a
     PowerFlex pack is NOT a crane violation (the base rubric is never weakened).

Pure logic — no network, no PDF.
"""

from __future__ import annotations

import pathlib
import sys

_TOOL_DIR = pathlib.Path(__file__).resolve().parents[1]
_GRADING_DIR = _TOOL_DIR / "grading"
for _p in (str(_GRADING_DIR), str(_TOOL_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from domain_rules import _crane_domain_violations, _is_crane_family, check_domain  # noqa: E402


def _magnetek_pack(**over):
    pack = {
        "family": {"manufacturer": "Magnetek", "series": "IMPULSE G+ Mini",
                   "aliases": ["g+ mini"]},
        "live_decode": {"fault_codes": {}},
        "parameters": [],
        "keypad_navigation": [],
        "provenance": {"items": {}, "sources": []},
    }
    pack.update(over)
    return pack


def test_uncited_crane_brake_fault_hard_fails():
    pack = _magnetek_pack(
        live_decode={"fault_codes": {51: "Brake Answer Back Fault"}},
        provenance={"items": {}, "sources": []},  # no cited corrective action
    )
    v = _crane_domain_violations(pack)
    assert v, "an uncited crane-safety brake fault must hard-fail"
    assert any("brake" in x.lower() for x in v)


def test_cited_crane_brake_fault_passes():
    pack = _magnetek_pack(
        live_decode={"fault_codes": {51: "Brake Answer Back Fault"}},
        provenance={"items": {}, "sources": [
            {"doc": "144-25085", "page": "137", "excerpt": "BE Brake answer-back — check brake wiring"},
        ]},
    )
    assert _crane_domain_violations(pack) == []


def test_uncited_crane_param_hard_fails_then_passes_when_cited():
    uncited = _magnetek_pack(parameters=[
        {"parameter_id": "C08.16", "name": "Brake Release Torque"},  # no source_citation
    ])
    assert _crane_domain_violations(uncited), "uncited crane-safety param must hard-fail"

    cited = _magnetek_pack(parameters=[
        {"parameter_id": "C08.16", "name": "Brake Release Torque",
         "source_citation": {"excerpt": "C08.16 Brake Release Torque = 50%", "page": "100"}},
    ])
    assert _crane_domain_violations(cited) == []


def test_supplement_is_family_gated_powerflex_unaffected():
    # Same uncited "brake" content, but a PowerFlex family -> NOT a crane
    # violation. The base rubric must be untouched for non-crane packs.
    pf = {
        "family": {"manufacturer": "Rockwell Automation", "series": "PowerFlex 40",
                   "aliases": ["pf40"]},
        "live_decode": {"fault_codes": {5: "Brake Fault"}},
        "parameters": [],
        "keypad_navigation": [],
        "provenance": {"items": {}, "sources": []},
    }
    assert not _is_crane_family(pf)
    assert _crane_domain_violations(pf) == []


def test_check_domain_folds_in_crane_failure():
    # End-to-end: the supplement is scored inside the domain layer.
    pack = _magnetek_pack(live_decode={"fault_codes": {51: "Brake Answer Back Fault"}})
    result = check_domain(pack)
    assert result.status == "fail"
    assert any("crane-safety" in d for d in result.details)


# --- runtime surface: fault_entries[] (schema_version 3, RUN_C item 3) --------
# G+ Mini is mnemonic-only: live_decode.fault_codes is {} and every fault lives
# in fault_entries[] (string fault_id). The crane hard-fail must extend to this
# surface or it sees ZERO faults on a real runtime crane pack.


def test_uncited_crane_fault_entry_hard_fails():
    pack = _magnetek_pack(fault_entries=[
        {"fault_id": "BE0", "name": "Brake Answer-Back signal lost during run",
         "action": "1. Check brake answer back circuit."},  # no source_citation
    ])
    v = _crane_domain_violations(pack)
    assert v, "an uncited crane-safety fault_entry must hard-fail"
    assert any("fault_entry" in x and "BE0" in x for x in v)


def test_cited_crane_fault_entry_passes():
    pack = _magnetek_pack(fault_entries=[
        {"fault_id": "BE0", "name": "Brake Answer-Back signal lost during run",
         "action": "1. Check brake answer back circuit.",
         "source_citation": {"doc": "144-25085", "page": "135",
                             "excerpt": "BE0 Brake Answer-Back signal lost during run."}},
    ])
    assert _crane_domain_violations(pack) == []


def test_crane_fault_entry_cited_but_no_action_hard_fails():
    # A cited crane-safety fault with no corrective action is still a hard fail —
    # the plan requires a CITED CORRECTIVE ACTION, not just a citation.
    pack = _magnetek_pack(fault_entries=[
        {"fault_id": "LL2", "name": "Lower Limit 2 — STOP", "action": "",
         "source_citation": {"doc": "144-25085", "page": "136", "excerpt": "LL2 Lower Limit 2"}},
    ])
    v = _crane_domain_violations(pack)
    assert v, "a crane-safety fault_entry with no corrective action must hard-fail"
    assert any("LL2" in x and "action" in x.lower() for x in v)


def test_crane_fault_entry_flagged_by_safety_id_even_when_name_lacks_keyword():
    # Defense-in-depth: a garbled/keyword-free name must NOT let a safety-critical
    # id (BE*/LL*/UL*/LC/STO/PG) slip through uncited. UL3 here has no safety word.
    pack = _magnetek_pack(fault_entries=[
        {"fault_id": "UL3", "name": "Indicator 3 status changed", "action": ""},
    ])
    v = _crane_domain_violations(pack)
    assert v, "a safety-critical fault-id must be caught even if its name lost the keyword"
    assert any("UL3" in x for x in v)


def test_fault_entry_supplement_is_family_gated_powerflex_unaffected():
    # Same uncited "brake" fault_entry, but a PowerFlex family -> NOT a crane
    # violation. The base rubric must be untouched for non-crane packs.
    pf = {
        "family": {"manufacturer": "Rockwell Automation", "series": "PowerFlex 40",
                   "aliases": ["pf40"]},
        "live_decode": {"fault_codes": {}},
        "parameters": [],
        "keypad_navigation": [],
        "provenance": {"items": {}, "sources": []},
        "fault_entries": [
            {"fault_id": "F5", "name": "Brake Fault", "action": ""},
        ],
    }
    assert not _is_crane_family(pf)
    assert _crane_domain_violations(pf) == []


def test_check_domain_folds_in_fault_entry_crane_failure():
    pack = _magnetek_pack(fault_entries=[
        {"fault_id": "BE0", "name": "Brake Answer-Back signal lost during run", "action": ""},
    ])
    result = check_domain(pack)
    assert result.status == "fail"
    assert any("crane-safety fault_entry" in d for d in result.details)


def test_real_candidate_fault_entries_are_all_cited():
    # Regression: the real 77-entry G+ Mini candidate pack's safety-critical
    # fault_entries are all cited with actions -> the runtime crane check adds
    # NO new violations for the shipped pack.
    import json
    import pathlib
    pack_path = (pathlib.Path(__file__).resolve().parents[1]
                 / "candidates" / "magnetek_impulse_g_plus_mini" / "pack.json")
    if not pack_path.exists():
        import pytest
        pytest.skip("candidate pack.json not present")
    pack = json.loads(pack_path.read_text())
    fault_entry_violations = [
        v for v in _crane_domain_violations(pack) if "fault_entry" in v
    ]
    assert fault_entry_violations == [], fault_entry_violations
