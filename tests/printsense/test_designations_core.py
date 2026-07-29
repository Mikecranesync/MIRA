"""European designation decoder — core D17 matrix (items 1-8, 10-16, 20-29).

Hermetic, synthetic designations only (generic IEC-style examples from the
directive; no customer content). Failing-first: this file was written before
printsense/designations existed.
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("pydantic")

from printsense import designations as dz  # noqa: E402


def _decode(raw, profile="eplan_iec", **kw):
    return dz.decode(raw, profile=profile, **kw)


# --- D17 1-3: base device and connection points ------------------------------

def test_01_base_device():
    d = _decode("-21/K01")
    assert d["schema_version"] == "1.0"
    assert d["raw"] == "-21/K01"
    assert d["base_designation"] == "-21/K01"
    assert d["connection_point"] is None
    assert d["entity_plan"]["parent_device"] == "-21/K01"
    assert d["entity_plan"]["child_entity"] is None


def test_02_03_connection_points_a1_a2():
    for cp in ("A1", "A2"):
        d = _decode(f"-21/K01:{cp}")
        assert d["base_designation"] == "-21/K01"
        assert d["connection_point"]["raw"] == cp
        assert d["connection_point"]["role"] == "coil_or_control_terminal"
        assert d["entity_plan"] == {
            "parent_device": "-21/K01",
            "child_entity": f"-21/K01:{cp}",
            "relationship": "COIL_TERMINAL_OF",
        }


def test_04_05_shared_parent_distinct_children():
    d1, d2 = _decode("-21/K01:A1"), _decode("-21/K01:A2")
    assert d1["entity_plan"]["parent_device"] == d2["entity_plan"]["parent_device"]
    assert d1["entity_plan"]["child_entity"] != d2["entity_plan"]["child_entity"]


def test_06_a1_a2_are_never_aliases():
    d1, d2 = _decode("-21/K01:A1"), _decode("-21/K01:A2")
    rels = {r["type"] for r in dz.relate(d1, d2)}
    assert "SAME_BASE_DEVICE" in rels
    assert not rels & {"PROBABLE_ALIAS_OF", "CONFIRMED_ALIAS_OF"}


# --- D17 7-8, 10: contact pairs and changeover groups -------------------------

def test_07_13_14_related_contact_pair():
    d = _decode("-21/K01:13")
    c = d["connection_point"]
    assert c["kind"] == "contact_terminal"
    assert c["pair_key"] == "13-14"
    assert c["convention"]["function_digit"] == "3"
    assert c["convention"]["role"] == "NO_by_convention"
    assert c["convention"]["state_proof"] == "never"


def test_08_21_22_is_a_distinct_pair():
    d13, d21 = _decode("-21/K01:13"), _decode("-21/K01:21")
    assert d21["connection_point"]["pair_key"] == "21-22"
    assert d13["connection_point"]["pair_key"] != d21["connection_point"]["pair_key"]
    rels = {r["type"] for r in dz.relate(d13, d21)}
    assert "SAME_BASE_DEVICE" in rels
    assert "CONTACT_MEMBER_OF" not in rels  # different groups


def test_10_changeover_group():
    g = dz.changeover_group("11", "12", "14")
    assert g["common"] == "11"
    assert g["nc_branch"] == "11-12"
    assert g["no_branch"] == "11-14"
    assert g["group_key"] == "11-12-14"
    assert g["state_proof"] == "never"


# --- D17 11-12: profile-dependent class codes, unresolved segments -----------

def test_11_class_code_stays_profile_dependent():
    d = _decode("-21/K01", profile=None)
    seg = next(s for s in d["segments"] if s.get("class_code") == "K")
    assert seg["candidate_classes"]
    assert seg["selected_class"] is None
    assert seg["requires_project_legend"] is True


def test_12_structure_segment_meaning_stays_unresolved():
    d = _decode("-21/K01")
    seg = next(s for s in d["segments"] if s["raw"] == "-21")
    assert seg["meaning"] is None
    assert "-21" in [u["raw"] for u in d["unresolved_segments"]]


# --- D17 13-15: separator semantics under profiles ----------------------------

def test_13_colon_separates_connection_point_under_eplan():
    d = _decode("-21/K01:A1", profile="eplan_iec")
    assert d["connection_point"]["raw"] == "A1"


def test_14_slash_ambiguous_without_profile():
    d = _decode("-21/K01", profile=None)
    assert any(a.get("separator") == "/" and len(a.get("candidates", [])) >= 2
               for a in d["ambiguities"])


def test_15_slash_interpretation_changes_with_profile():
    amb_unknown = _decode("-21/K01", profile="unknown_european")["ambiguities"]
    amb_eplan = _decode("-21/K01", profile="eplan_iec")["ambiguities"]
    assert any(a.get("separator") == "/" for a in amb_unknown)
    assert not any(a.get("separator") == "/" for a in amb_eplan)


# --- D17 16, 25: page context and relative designations -----------------------

def test_16_page_context_supplies_omitted_hierarchy():
    d = _decode("K01", page_context={"prefix": "=A1+CAB2"})
    assert d["displayed_designation"] == "K01"
    assert d["resolved_full_designation"] == "=A1+CAB2-K01"


def test_25_relative_reference_resolved_from_context():
    d = _decode("-K01", page_context={"prefix": "=A1+CAB2"})
    assert d["resolved_full_designation"] == "=A1+CAB2-K01"
    no_ctx = _decode("-K01")
    assert no_ctx["resolved_full_designation"] is None


# --- D17 20-23: lexical guarantees --------------------------------------------

def test_20_decimal_comma_never_splits():
    d = _decode("4G1,5", profile=None)
    assert d["raw"] == "4G1,5"
    assert not any(s["raw"] in {"1", "5"} for s in d["segments"])


@pytest.mark.parametrize("raw", [
    "-21/K01:A1", "=21+K01-A1", "4.4 / X24V.3", "4G1,5",
    "  -X1:5 ", "-W12:GNYE", "::--//", "13–14",
])
def test_21_raw_round_trip(raw):
    lexed = dz.lex(raw)
    assert "".join(t["raw"] for t in lexed["tokens"]) == raw
    assert lexed["raw"] == raw


def test_22_deterministic_serialization():
    a = json.dumps(_decode("-21/K01:A1"), sort_keys=True)
    b = json.dumps(_decode("-21/K01:A1"), sort_keys=True)
    assert a == b


def test_23_malformed_designation_never_crashes():
    d = _decode("::--//", profile=None)
    assert d["unresolved_segments"]
    assert d["diagnostics"]


# --- D17 24: mixed notation ----------------------------------------------------

def test_24_nfpa_style_tag_flagged_not_forced():
    d = _decode("101CR", profile="eplan_iec")
    assert any("profile" in w.lower() or "notation" in w.lower()
               for w in d["warnings"])
    assert d["entity_plan"]["relationship"] is None


# --- D17 26-29: structural distinctions ---------------------------------------

def test_26_nested_device_path():
    d = _decode("-A1-K1", profile="eplan_iec")
    assert d["nested_device_path"] == ["A1", "K1"]
    assert d["base_designation"] == "-A1-K1"


def test_27_terminal_strip_vs_port():
    term = _decode("-X1:5")
    assert term["connection_point"]["kind"] == "terminal"
    port = _decode("-U1:X2")
    assert port["connection_point"]["kind"] in {"port", "connector_pin"}


def test_28_connector_pin():
    d = _decode("-XS3:B2")
    assert d["connection_point"]["kind"] == "connector_pin"


def test_29_contact_vs_connection_point_kinds_differ():
    contact = _decode("-21/K01:13")["connection_point"]["kind"]
    coil = _decode("-21/K01:A1")["connection_point"]["kind"]
    assert contact == "contact_terminal"
    assert coil == "connection_point"
    assert contact != coil


# --- distinct raw forms stay distinct (D1) -------------------------------------

@pytest.mark.parametrize("a,b", [
    ("-21/K01:A1", "-21/K01-A1"),
    ("-21/K01:A1", "=21+K01-A1"),
    ("/K01", "K01"),
    ("K01", "-K01"),
])
def test_d1_materially_different_tokens_not_conflated(a, b):
    da, db = _decode(a, profile=None), _decode(b, profile=None)
    assert da["raw"] != db["raw"]
    assert da["normalized"] != db["normalized"] or da["raw"] == db["raw"]
