"""Sabotage gates (WS7): prove each safety/privacy gate genuinely FAILS on a
violation — no vacuous greens. Hermetic; synthetic content only."""

from __future__ import annotations

import copy
import hashlib
import json

import pytest

pytest.importorskip("pydantic")

from printsense import identity_graph as ig  # noqa: E402
from printsense import package_scope  # noqa: E402
from printsense.benchmarks import designation_bench  # noqa: E402
from printsense.designations import decode  # noqa: E402


# --- Gate 1: A1/A2 aliasing hard-fails ----------------------------------------

def test_gate_a1_a2_alias_injection_is_detected(monkeypatch):
    from printsense.designations import relationships as rel_module

    def fake_relate(d1, d2):
        return [{"type": "CONFIRMED_ALIAS_OF", "from": d1.get("raw"),
                 "to": d2.get("raw")}]

    monkeypatch.setattr(rel_module, "relate", fake_relate)
    result = designation_bench.run_benchmark()
    assert result["hard_failures"]
    assert any("alias" in str(f).lower() for f in result["hard_failures"])


# --- Gate 2: false continuity hard-fails ---------------------------------------

def _fact_free(obj) -> list[str]:
    """The continuity gate: any continuity-asserting key/string is a hit."""
    import re
    blob = json.dumps(obj).lower()
    return re.findall(r"continuity|connected_to|bridged", blob)


def test_gate_false_continuity_detected_on_tampered_graph():
    index = {"sheets": [{"sheet": "1", "quality": "clear_upright", "page_id": "p1",
                         "devices": [{"tag": "-1/K01:13", "kind": "x", "ev": "obs",
                                      "provenance": {"page_id": "p1",
                                                     "section": "devices"},
                                      "designation": {"profile": "eplan_iec"}}],
                         "xrefs": [], "unresolved": []}]}
    clean = ig.build_identity_graph(index)
    assert _fact_free(clean) == []
    tampered = copy.deepcopy(clean)
    tampered["relationships"].append(
        {"type": "CONTACT_MEMBER_OF", "from": "-1/K01:13", "to": "-1/K01:14",
         "connected_to": True})
    assert _fact_free(tampered)  # the gate catches the injected continuity


# --- Gate 3: hidden safety conflict hard-fails ----------------------------------

def test_gate_safety_conflict_survives_bounded_retrieval():
    index = {"sheets": [{"sheet": "1", "quality": "clear_upright", "page_id": "p1",
                         "devices": [{"tag": "-1/K01", "kind": "x", "ev": "obs",
                                      "provenance": {},
                                      "designation": {"profile": "eplan_iec"}}],
                         "xrefs": [], "unresolved": []}]}
    g = ig.build_identity_graph(index)
    many = [{"type": "kind_mismatch", "item": f"-9/Z{i}", "safety": False}
            for i in range(50)]
    sysgraph = {"contradictions": many + [
        {"type": "contact_semantic_conflict", "chain": "61/62",
         "forms": ["NC", "NO"], "safety": True}]}
    result = ig.query_designation(g, "-1/K01", systemgraph_result=sysgraph)
    assert any(c.get("safety") for c in result["contradictions"])


# --- Gate 4: frozen 53/54 without human approval hard-fails ---------------------

def assert_pending_never_frozen(record: dict) -> None:
    if record.get("human_confirmation_status") == "pending" and \
            record.get("truth_status") == "frozen_human_confirmed":
        raise AssertionError(
            "pending human confirmation cannot coexist with a frozen truth")


def test_gate_pending_53_54_cannot_freeze():
    ok = {"chain": "53/54", "human_confirmation_status": "pending",
          "truth_status": "draft_unfrozen"}
    assert_pending_never_frozen(ok)  # no raise
    frozen_violation = {"chain": "53/54",
                        "human_confirmation_status": "pending",
                        "truth_status": "frozen_human_confirmed"}
    with pytest.raises(AssertionError):
        assert_pending_never_frozen(frozen_violation)
    # and the decoder itself never emits a confirmed status for 5x pairs
    d = decode("-21/K01:53", profile="eplan_iec")
    assert "frozen" not in json.dumps(d).lower()


# --- Gate 5: confidential-marker leakage hard-fails (positive control) ----------

def test_gate_marker_scan_positive_control():
    """Positive control: the salted scanner genuinely catches an injected
    term — standalone AND fused into an underscore identifier. (An
    underscore-CONTAINING marker cannot be caught when fused — the real
    forbidden list therefore also carries the underscore-free core token;
    this probe is deliberately underscore-free.)"""
    from test_privacy_guards import _SALT, _hash_hits
    invented = "sabotageprobezq9"
    salted = hashlib.sha256((_SALT + invented).encode()).hexdigest()
    assert _hash_hits(f"prefix {invented} suffix", {salted}) == [salted]
    assert salted in _hash_hits(f"file_{invented}_stem", {salted})
    assert _hash_hits("entirely innocent text", {salted}) == []


# --- Adversarial-review extras ---------------------------------------------------

def test_migration_records_share_no_list_objects_with_legacy():
    legacy = {"contradictions": [
        {"type": "alias_variation", "key": "1/K01",
         "forms": ["-1/K01", "-1/K01:A1"], "sheets": ["1"], "safety": False}]}
    report = ig.reinterpret_with_records(legacy)
    original = report["records"][0]["original"]
    assert original["forms"] == legacy["contradictions"][0]["forms"]
    assert original["forms"] is not legacy["contradictions"][0]["forms"]
    original["forms"].append("tamper")
    assert legacy["contradictions"][0]["forms"] == ["-1/K01", "-1/K01:A1"]


def test_cross_page_bare_tag_merge_is_flagged_not_silent():
    def dev(tag, page):
        return {"tag": tag, "kind": "x", "ev": "obs",
                "provenance": {"page_id": page, "section": "devices"},
                "designation": {"profile": "eplan_iec"}}
    index = {"sheets": [
        {"sheet": "5", "quality": "clear_upright", "page_id": "p5",
         "devices": [dev("-K1", "p5")], "xrefs": [], "unresolved": []},
        {"sheet": "9", "quality": "clear_upright", "page_id": "p9",
         "devices": [dev("-K1", "p9")], "xrefs": [], "unresolved": []},
    ]}
    g = ig.build_identity_graph(index)
    assert len([k for k in g["nodes"] if k == "-K1"]) == 1  # merged...
    assert any(a.get("kind") == "cross_page_identity_assumed"
               and a.get("designation") == "-K1"
               for a in g["ambiguities"])  # ...but never silently


def test_scope_counts_cannot_hide_edges():
    graph = {"edges": [
        {"sig": "a", "src": "1", "dst": "4", "peer": "S4", "dir": "", "cls": "dangling", "ev": "obs"},
        {"sig": "b", "src": "1", "dst": "7", "peer": "S7", "dir": "", "cls": "dangling", "ev": "obs"},
        {"sig": "c", "src": "1", "dst": None, "peer": "EXT:PSU", "dir": "", "cls": "external", "ev": "obs"},
    ]}
    index = {"sheets": [{"sheet": "1", "quality": "clear_upright"}]}
    scope = {"package_type": "photo_set", "scope_status": "partial_declared",
             "sheet_inventory": ["1", "4"]}
    result = package_scope.classify_scope(graph, index, scope)
    assert len(result["references"]) == len(graph["edges"])  # nothing vanishes
    assert sum(result["scope_counts"].values()) == len(result["references"])
    assert sum(result["original_edge_classes"].values()) == len(graph["edges"])
    # the dangling evidence is still visible via non-resolved states
    non_resolved = {k: v for k, v in result["scope_counts"].items()
                    if k not in ("resolved", "not_applicable")}
    assert sum(non_resolved.values()) == 2


def test_coil_overfire_regression_sensor_a1_is_not_a_coil():
    d = decode("-B1:A1", profile="eplan_iec")
    cp = d["connection_point"]
    assert cp["kind"] == "connection_point"
    assert cp.get("role") != "coil_or_control_terminal"
    assert cp["convention"]["state_proof"] == "never"
    # contactor A1 remains a coil
    d2 = decode("-K1:A1", profile="eplan_iec")
    assert d2["connection_point"]["role"] == "coil_or_control_terminal"


def test_coil_default_denied_for_unknown_device_class():
    """Final diff review: an A1 whose parent class cannot be determined must
    NOT default to a coil claim."""
    d = decode("101CR:A1", profile="eplan_iec")  # NFPA-style, class unknown
    cp = d["connection_point"]
    assert cp.get("role") != "coil_or_control_terminal"
    assert cp["convention"]["state_proof"] == "never"


def test_query_surfaces_nested_device_parent():
    index = {"sheets": [{"sheet": "1", "quality": "clear_upright",
                         "page_id": "p1",
                         "devices": [{"tag": "-A1-K1", "kind": "x", "ev": "obs",
                                      "provenance": {},
                                      "designation": {"profile": "eplan_iec"}}],
                         "xrefs": [], "unresolved": []}]}
    g = ig.build_identity_graph(index)
    result = ig.query_designation(g, "-A1-K1")
    assert result["parent"] is not None
    assert result["parent"]["key"] == "-A1"
