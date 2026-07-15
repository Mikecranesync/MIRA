"""European designation decoder — safety, epistemics, legend, migration
(D17 items 9, 17-19, 30-32; 33-34 run via the existing privacy guards).

Hermetic, synthetic content only."""

from __future__ import annotations

import copy
import json

import pytest

pytest.importorskip("pydantic")

from printsense import designations as dz  # noqa: E402

_STATE_WORDS = ("energized", "energised", "currently closed", "currently open",
                "is closed", "is open", "safe state", "de-energized", "proven")


def _all_strings(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _all_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_strings(v)
    elif isinstance(obj, str):
        yield obj


# --- D17 9 / D12: 53/54 conventional decode, never state proof ---------------

def test_09_5354_convention_without_state_claims():
    d = dz.decode("-21/K01:53", profile="eplan_iec")
    c = d["connection_point"]
    assert c["pair_key"] == "53-54"
    assert c["convention"]["role"] == "NO_by_convention"
    assert c["convention"]["state_proof"] == "never"
    # nothing anywhere in the decoded object asserts an operating state
    for s in _all_strings(d):
        assert not any(w in s.lower() for w in _STATE_WORDS), s
    # the explanation must carry the not-proof language and the pending caveat
    text = dz.explain(d).lower()
    assert "not" in text and ("state" in text or "energiz" in text)


def test_09b_mirror_and_positively_driven_never_inferred():
    d = dz.decode("-21/K01:53", profile="eplan_iec")
    for s in _all_strings(d):
        assert "mirror" not in s.lower()
        assert "positively driven" not in s.lower()


# --- D17 17: conflicting project legend -> ambiguity, not override -----------

def test_17_conflicting_legend_produces_ambiguity():
    legend = dz.LegendRule(
        source_page="7", source_region=None,
        raw_text="K = Kabelverteiler (project legend)",
        mapping={"class_code": "K", "meaning": "project_specific_distribution"},
        human_confirmation_status="proposed", confidence=0.7, scope="package")
    d = dz.decode("-21/K01", profile="eplan_iec", legends=[legend])
    seg = next(s for s in d["segments"] if s.get("class_code") == "K")
    assert seg["selected_class"] is None
    assert any("legend" in json.dumps(a).lower() for a in d["ambiguities"])


# --- D17 18: manufacturer rule enriches, never overwrites --------------------

def test_18_manufacturer_rule_enriches_without_overwrite():
    d = dz.decode("-21/K01:A1", profile="eplan_iec",
                  device_profile={"family": "generic_contactor",
                                  "terminals": {"A1": "coil_plus_candidate"}})
    assert d["raw"] == "-21/K01:A1"
    assert d["connection_point"]["raw"] == "A1"
    assert d["connection_point"].get("manufacturer_note") == "coil_plus_candidate"
    # polarity still not asserted as fact
    assert d["connection_point"]["convention"].get("polarity", "unknown") == "unknown"


# --- D17 19 / D15: OCR candidates are offered, never silently applied --------

def test_19_ocr_variant_yields_candidate_correction():
    d = dz.decode("-21/K0I:A1", profile="eplan_iec")
    assert d["raw"] == "-21/K0I:A1"  # raw untouched
    cands = [c for a in d["ambiguities"] for c in a.get("candidates", [])
             if c.get("kind") == "ocr_correction"]
    assert any(c["text"] == "K01" for c in cands)
    assert all(c.get("reason") and c.get("confidence") for c in cands)


# --- D17 30: safety findings survive bounded rendering ------------------------

def test_30_safety_items_survive_bounded_explain():
    d = dz.decode("-21/K01:53", profile="eplan_iec")
    text = dz.explain(d, max_items=1)
    assert "53" in text
    assert "not" in text.lower()  # the not-a-state-proof caveat is never trimmed


# --- D17 31: Phase B graph migrates without data loss --------------------------

def _phase_b_graph():
    return {
        "devices": [], "edges": [], "violations": [],
        "contradictions": [
            {"type": "alias_variation", "key": "21/K01",
             "forms": ["-21/K01", "-21/K01:A1", "-21/K01:A2"],
             "sheets": ["21"], "safety": False},
            {"type": "alias_variation", "key": "24/A10",
             "forms": ["-24/A10", "-24/A10U"],
             "sheets": ["15", "24"], "safety": False},
        ],
        "summary": {"contradictions": 2},
    }


def test_31_migration_reclassifies_without_touching_original():
    graph = _phase_b_graph()
    before = copy.deepcopy(graph)
    report = dz.migrate_alias_variations(graph, profile="eplan_iec")
    assert graph == before  # input untouched — no data loss, no mutation
    assert report["total"] == 2
    k01 = next(r for r in report["reinterpretations"] if r["key"] == "21/K01")
    kinds = {m["relationship"] for m in k01["members"]}
    assert "CHILD_CONNECTION_POINT_OF" in kinds or "COIL_TERMINAL_OF" in kinds
    assert "SAME_EXACT_DESIGNATION" in kinds  # the base form itself
    assert not {"CONFIRMED_ALIAS_OF"} & kinds
    # the truncated-suffix family cannot be resolved from forms alone
    a10 = next(r for r in report["reinterpretations"] if r["key"] == "24/A10")
    assert a10["members"] and any(
        m["relationship"] in {"PROBABLE_ALIAS_OF", "AMBIGUOUS_WITH", "UNRESOLVED"}
        for m in a10["members"])
    counts = report["counts"]
    assert set(counts) >= {"same_base_device", "child_connection_point",
                           "probable_alias", "unresolved", "contradiction"}


# --- D17 32: frozen grading paths remain untouched -----------------------------

def test_32_frozen_modules_do_not_import_designations():
    import pathlib
    import re
    root = pathlib.Path(dz.__file__).resolve().parents[1]
    import_pattern = re.compile(
        r"^\s*(from\s+\S*designations|import\s+\S*designations)", re.MULTILINE)
    for frozen in ("grader.py", "gates.py", "grade_case.py"):
        text = (root / frozen).read_text(encoding="utf-8")
        assert not import_pattern.search(text), f"{frozen} must stay frozen"
