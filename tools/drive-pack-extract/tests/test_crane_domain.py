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
