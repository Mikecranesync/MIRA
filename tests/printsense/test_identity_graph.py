"""Phase C identity graph — decoder-key consumption (WS3/WS5/WS7 items
1-12, 20-22). Hermetic; synthetic fixtures only."""

from __future__ import annotations

import copy
import json

import pytest

pytest.importorskip("pydantic")

from printsense import identity_graph as ig  # noqa: E402
from printsense.designations import LegendRule  # noqa: E402


def _index() -> dict:
    """A pageset-shaped index with designation blocks (decoder opt-in on)."""
    def dev(tag, page, sheet):
        return {"tag": tag, "kind": "x", "ev": "obs", "confidence": 0.9,
                "provenance": {"page_id": page, "photo_sha256": "ab" * 32,
                               "extractor": {"model": "m"}, "section": "devices"},
                "designation": {"profile": "eplan_iec"}}
    return {"sheets": [
        {"sheet": "21", "quality": "clear_upright", "page_id": "p21",
         "devices": [dev("-21/K01", "p21", "21"),
                     dev("-21/K01:A1", "p21", "21"),
                     dev("-21/K01:A2", "p21", "21"),
                     dev("-21/K01:13", "p21", "21"),
                     dev("-21/K01:14", "p21", "21"),
                     dev("-X1:5", "p21", "21"),
                     dev("-XS3:B2", "p21", "21"),
                     dev("-U1:X2", "p21", "21"),
                     dev("-W12:GNYE", "p21", "21"),
                     dev("-A1-K1", "p21", "21")],
         "xrefs": [], "unresolved": []},
    ]}


def _graph(index=None, **kw):
    return ig.build_identity_graph(index or _index(), **kw)


def _rels(graph, rtype):
    return [r for r in graph["relationships"] if r["type"] == rtype]


# --- WS7 1-4: decoder keys -> typed entities ---------------------------------

def test_01_decoder_keys_drive_entity_construction():
    g = _graph()
    assert "-21/K01" in g["nodes"]
    assert g["nodes"]["-21/K01"]["entity_type"] == "Device"
    assert g["nodes"]["-21/K01"]["pages"] == ["p21"]


def test_02_03_a1_a2_separate_nodes_one_parent():
    g = _graph()
    a1, a2 = g["nodes"]["-21/K01:A1"], g["nodes"]["-21/K01:A2"]
    assert a1 is not a2 and a1["key"] != a2["key"]
    parents = {r["to"] for r in _rels(g, "CHILD_CONNECTION_POINT_OF")
               if r["from"] in ("-21/K01:A1", "-21/K01:A2")}
    assert parents == {"-21/K01"}
    # and never aliases
    assert not [r for r in g["relationships"]
                if "ALIAS" in r["type"]
                and {r["from"], r["to"]} == {"-21/K01:A1", "-21/K01:A2"}]


def test_04_coil_terminals_typed():
    g = _graph()
    assert g["nodes"]["-21/K01:A1"]["entity_type"] == "Coil"
    coil_rels = {(r["from"], r["to"]) for r in _rels(g, "COIL_TERMINAL_OF")}
    assert ("-21/K01:A1", "-21/K01") in coil_rels
    assert ("-21/K01:A2", "-21/K01") in coil_rels


def test_entity_taxonomy_distinct():
    g = _graph()
    types = {k: v["entity_type"] for k, v in g["nodes"].items()}
    assert types["-21/K01:13"] == "Contact"
    assert types["-21/K01:13-14"] == "ContactGroup"
    assert types["-X1:5"] == "Terminal"
    assert types["-XS3"] == "Connector"
    assert types["-XS3:B2"] == "ConnectionPoint"
    assert types["-U1:X2"] == "Port"
    assert types["-W12:GNYE"] == "ConductorEndpoint"
    # contact group membership without continuity claims
    members = {r["from"] for r in _rels(g, "CONTACT_MEMBER_OF")}
    assert {"-21/K01:13", "-21/K01:14"} <= members
    blob = json.dumps(g).lower()
    assert "continuity" not in blob and "connected_to" not in blob


def test_connector_pin_relationship():
    g = _graph()
    assert ("-XS3:B2", "-XS3") in {(r["from"], r["to"])
                                   for r in _rels(g, "CONNECTOR_PIN_OF")}


# --- WS7 8-12: evidence-gated dormant relationships --------------------------

def test_08_nested_device_only_with_evidence():
    g = _graph()
    nested = _rels(g, "NESTED_DEVICE_OF")
    assert ("-A1-K1" in {r["from"] for r in nested}) or \
        any(r["evidence"].get("nested_path") for r in nested)
    # a plain device never gets a synthesized nested relation
    assert "-21/K01" not in {r["from"] for r in nested}


def test_09_relative_reference_only_with_context():
    index = _index()
    index["sheets"][0]["context_prefix"] = "=A1+CAB2"
    index["sheets"][0]["devices"].append(
        {"tag": "K05", "kind": "x", "ev": "obs", "confidence": 0.8,
         "provenance": {"page_id": "p21", "section": "devices"},
         "designation": {"profile": "eplan_iec"}})
    g = ig.build_identity_graph(index)
    rel = _rels(g, "RELATIVE_REFERENCE_TO")
    assert any(r["from"] == "K05" and r["to"] == "=A1+CAB2-K05" for r in rel)
    assert all(r["stage"] == "page_context" for r in rel)
    # without context: no relative relations at all
    g2 = _graph()
    assert not _rels(g2, "RELATIVE_REFERENCE_TO")


def test_10_project_equivalence_requires_confirmed_rule():
    proposed = LegendRule(source_page="7", source_region=None,
                          raw_text="K05 == -21/K05",
                          mapping={"designation_equivalence":
                                   ["K05", "-21/K05"]},
                          human_confirmation_status="proposed")
    confirmed = LegendRule(source_page="7", source_region=None,
                           raw_text="K05 == -21/K05",
                           mapping={"designation_equivalence":
                                    ["K05", "-21/K05"]},
                           human_confirmation_status="confirmed")
    g_prop = _graph(legends=[proposed])
    assert not _rels(g_prop, "PROJECT_EQUIVALENT_OF")
    g_conf = _graph(legends=[confirmed])
    eq = _rels(g_conf, "PROJECT_EQUIVALENT_OF")
    assert eq and eq[0]["human_confirmed"] is True
    assert eq[0]["stage"] == "project_profile"


def test_11_12_revision_variants_and_conflict():
    index = _index()
    index["sheets"].append(
        {"sheet": "21", "quality": "clear_upright", "page_id": "p21b",
         "revision": "B", "devices": [], "xrefs": [], "unresolved": []})
    index["sheets"][0]["revision"] = "A"
    g = ig.build_identity_graph(index)
    rev = _rels(g, "REVISION_VARIANT_OF")
    assert rev and rev[0]["stage"] == "revision"
    assert any(a.get("kind") == "revision_conflict" for a in g["ambiguities"])
    # without revision metadata: nothing emitted
    assert not _rels(_graph(), "REVISION_VARIANT_OF")


# --- WS5: stage attribution ----------------------------------------------------

def test_every_relationship_states_stage_and_confidence():
    index = _index()
    index["sheets"][0]["context_prefix"] = "=A1+CAB2"
    g = ig.build_identity_graph(index)
    for r in g["relationships"]:
        assert r["stage"] in {"token", "page_context", "project_profile",
                              "revision"}
        assert 0.0 <= r["confidence"] <= 1.0
        assert "human_confirmed" in r


# --- WS7 20: safety contradictions visible in retrieval ------------------------

def test_20_query_keeps_safety_contradictions_visible():
    g = _graph()
    sysgraph = {"contradictions": [
        {"type": "contact_semantic_conflict", "chain": "61/62",
         "sheets": ["6"], "forms": ["NC", "NO"], "safety": True},
        {"type": "kind_mismatch", "item": "-99/Z9", "safety": False},
    ]}
    result = ig.query_designation(g, "-21/K01", systemgraph_result=sysgraph)
    assert any(c.get("safety") for c in result["contradictions"])
    # children retrievable; A1 independently addressable
    child_keys = {c["key"] for c in result["children"]}
    assert {"-21/K01:A1", "-21/K01:A2"} <= child_keys
    r2 = ig.query_designation(g, "-21/K01:A1")
    assert r2["parent"]["key"] == "-21/K01"
    assert r2["node"]["key"] == "-21/K01:A1"


# --- WS7 5-7, 22: migration records --------------------------------------------

def _legacy() -> dict:
    return {"contradictions": [
        {"type": "alias_variation", "key": "21/K01",
         "forms": ["-21/K01", "-21/K01:A1", "-21/K01:A2"], "sheets": ["21"],
         "safety": False}]}


def test_05_22_legacy_untouched_and_records_versioned():
    legacy = _legacy()
    before = copy.deepcopy(legacy)
    report = ig.reinterpret_with_records(legacy, index=_index())
    assert legacy == before
    assert report["migration_version"] == "1.0"
    rec = report["records"][0]
    assert rec["legacy_classification"] == "alias_variation"
    assert rec["members"][1]["typed_relationship"] == "COIL_TERMINAL_OF"
    assert rec["members"][1]["parent_designation"] == "-21/K01"
    assert rec["profile"] == "eplan_iec"
    assert rec["source_pages"] == ["p21"]
    assert rec["members"][1]["source_field_path"] == "devices"


def test_07_alias_count_never_increases():
    report = ig.reinterpret_with_records(_legacy(), index=_index())
    aliases = [m for r in report["records"] for m in r["members"]
               if "ALIAS" in m["typed_relationship"]]
    assert len(aliases) == 0  # legacy had 0 confirmed aliases; still 0


# --- WS7 21: determinism ---------------------------------------------------------

def test_21_serialization_deterministic():
    a = json.dumps(_graph(), sort_keys=True)
    b = json.dumps(_graph(), sort_keys=True)
    assert a == b
