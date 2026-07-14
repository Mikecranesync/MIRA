"""Unit tests for the deterministic graph-integrity gates (``printsense.gates``).

Each test demonstrates one failure class on a minimal synthetic graph, plus the clean
case that must pass (the PRD §19.1 matrix). An ATV340-shaped mini-graph proves the
truth-free structural import-blockers fire together (durable spec §3). Dangling-reference
detection is deliberately deferred to the rubric-truth slice — verified here-adjacent that
truth-free dangling checks false-positive on the rich SCU2 graph.
"""

from __future__ import annotations

from printsense import gates


def _codes(failures: list[dict]) -> list[str]:
    return sorted(f["gate"] for f in failures)


# ---- G4 duplicate_identifier ------------------------------------------------


def test_duplicate_ids_flagged():
    g = {
        "devices": [{"tag": "M"}, {"tag": "M"}],
        "terminals": [{"tag": "CN9:PA/+"}, {"tag": "CN9:PA/+"}],
    }
    f = gates.check_duplicate_ids(g)
    assert _codes(f) == ["duplicate_identifier"]
    assert "M" in f[0]["items"] and "CN9:PA/+" in f[0]["items"]


def test_duplicate_ids_variant_qualified_passes():
    # Variant-qualified ids are distinct tags -> not a duplicate (the intended fix).
    g = {"devices": [{"tag": "S1S2:M"}, {"tag": "S3:M"}]}
    assert gates.check_duplicate_ids(g) == []


def test_duplicate_ids_ignores_unreadable():
    g = {"terminals": [{"tag": "UNREADABLE"}, {"tag": "UNREADABLE"}]}
    assert gates.check_duplicate_ids(g) == []


# ---- G8 off_page_from_pagination -------------------------------------------


def test_off_page_from_pagination_flagged():
    g = {
        "package": {"sheet": "1/2"},
        "off_page_references": [{"tag": "2/2", "evidence": "Footer '1/2'"}],
    }
    f = gates.check_off_page_from_pagination(g)
    assert _codes(f) == ["off_page_from_pagination"]
    assert f[0]["items"] == ["2/2"]


def test_off_page_real_reference_passes():
    # A genuine off-page ref (sheet coordinate / destination) is not bare N/M pagination.
    g = {
        "package": {"sheet": "1/2"},
        "off_page_references": [{"tag": "SH3-A5", "detail": "to sheet 3, zone A5"}],
    }
    assert gates.check_off_page_from_pagination(g) == []


def test_off_page_none_passes():
    assert gates.check_off_page_from_pagination({"package": {"sheet": "1/2"}}) == []


# ---- run_gates aggregation + ATV340 shape ----------------------------------


def test_run_gates_clean_graph():
    g = {"devices": [{"tag": "M"}], "terminals": [{"tag": "CN10:U"}]}
    r = gates.run_gates(g)
    assert r["codes"] == []
    assert r["failures"] == []


def test_run_gates_atv340_shape_fires_structural_blockers():
    # A minimal ATV340-shaped graph. The truth-free structural defects (unqualified
    # duplicate ids + pagination-as-off-page) fire here; the dangling CN3 and the
    # exact-label/path defects are caught in the rubric-truth slice.
    g = {
        "package": {"sheet": "1/2"},
        "devices": [{"tag": "ENC"}, {"tag": "ATV340"}],
        "terminals": [
            {"tag": "CN9:PA/+"}, {"tag": "CN9:PA/+"},  # S1/S2 vs S3, unqualified
            {"tag": "CN9:PC/-"}, {"tag": "CN9:PC/-"},
        ],
        "off_page_references": [{"tag": "2/2", "evidence": "Footer '1/2'"}],
    }
    r = gates.run_gates(g)
    assert r["codes"] == ["duplicate_identifier", "off_page_from_pagination"]


# ---- G1 exact_label_mismatch (rubric-truth) --------------------------------


def test_exact_label_mismatch_flagged():
    # The ATV340 graph emitted DO1/DO2 for the printed DQ1/DQ2 (digital outputs).
    g = {"plc_io_channels": [{"tag": "DO1"}, {"tag": "DO2"}]}
    rubric = {"categories": {"device": {"expected": ["DQ1", "DQ2"], "known_misreads": ["DO1", "DO2"]}}}
    f = gates.check_exact_label(g, rubric)
    assert _codes(f) == ["exact_label_mismatch"]
    assert "DO1" in f[0]["items"] and "DO2" in f[0]["items"]


def test_exact_label_clean_passes():
    g = {"plc_io_channels": [{"tag": "DQ1"}, {"tag": "DQ2"}]}
    rubric = {"categories": {"device": {"expected": ["DQ1", "DQ2"], "known_misreads": ["DO1", "DO2"]}}}
    assert gates.check_exact_label(g, rubric) == []


def test_exact_label_digits_not_fuzzy_collapsed():
    # 15.7 vs 15.5 is the error we grade; the misread token must match on digits.
    g = {"terminals": [{"tag": "15.5"}]}
    rubric = {"categories": {"xref": {"expected": ["15.7"], "known_misreads": ["15.5"]}}}
    assert _codes(gates.check_exact_label(g, rubric)) == ["exact_label_mismatch"]


def test_exact_label_no_rubric_passes():
    g = {"plc_io_channels": [{"tag": "DO1"}]}
    assert gates.check_exact_label(g, None) == []
    assert gates.check_exact_label(g, {}) == []


# ---- G3 dangling_reference (rubric-truth; require_refs_resolve) -------------


def test_dangling_reference_flagged():
    # The RS422 link references bare CN3, which is defined by no entity.
    g = {
        "devices": [{"tag": "ENC"}, {"tag": "ATV340"}],
        "network_links": [{"tag": "RS422 (CN3 ENC)", "connects": ["ENC", "CN3", "ATV340"]}],
    }
    f = gates.check_dangling_refs(g, {"require_refs_resolve": True})
    assert _codes(f) == ["dangling_reference"]
    assert "CN3" in f[0]["items"]


def test_dangling_reference_all_resolve_passes():
    g = {
        "devices": [{"tag": "ENC"}, {"tag": "ATV340"}, {"tag": "CN3"}],
        "network_links": [{"tag": "RS422", "connects": ["ENC", "CN3", "ATV340"]}],
    }
    assert gates.check_dangling_refs(g, {"require_refs_resolve": True}) == []


def test_dangling_reference_ignores_unreadable():
    g = {"devices": [{"tag": "A"}], "network_links": [{"tag": "L", "connects": ["UNREADABLE"]}]}
    assert gates.check_dangling_refs(g, {"require_refs_resolve": True}) == []


def test_dangling_reference_disabled_without_flag():
    # THE LESSON: run truth-free, legit cross-sheet / sub-terminal refs false-positive.
    # Without require_refs_resolve, the gate MUST NOT fire (an import blocker needs ~0 FPs).
    g = {"devices": [{"tag": "A"}], "network_links": [{"tag": "L", "connects": ["+SCU1/5.3", "-A1-X3:2"]}]}
    assert gates.check_dangling_refs(g, {}) == []
    assert gates.check_dangling_refs(g, None) == []


# ---- G7 incorrect_connector_ownership (rubric.paths signal/from) ------------


def test_connector_ownership_flagged():
    # RS422 belongs to CN4/PTO; the graph put it on CN3 (the encoder connector).
    g = {"network_links": [{"tag": "RS422 (CN3 ENC)", "connects": ["ENC", "CN3", "ATV340"]}]}
    rubric = {"paths": [{"name": "rs422", "signal": "RS422", "from": "CN4", "forbidden_from": ["CN3"]}]}
    f = gates.check_connector_ownership(g, rubric)
    assert _codes(f) == ["incorrect_connector_ownership"]
    assert "CN3" in f[0]["items"]


def test_connector_ownership_correct_passes():
    g = {"network_links": [{"tag": "RS422 CN4", "connects": ["PTO", "CN4", "ATV340"]}]}
    rubric = {"paths": [{"name": "rs422", "signal": "RS422", "from": "CN4", "forbidden_from": ["CN3"]}]}
    assert gates.check_connector_ownership(g, rubric) == []


def test_connector_ownership_no_rubric_passes():
    g = {"network_links": [{"tag": "RS422 (CN3 ENC)", "connects": ["CN3"]}]}
    assert gates.check_connector_ownership(g, {}) == []


# ---- G5/G6 functional-path (variant crossover + forbidden member) ----------

_BRAKING_RUBRIC = {
    "paths": [{
        "name": "braking", "match": ["brak"], "variant": "S1S2",
        "endpoints": ["CN10:PBe", "CN10:PB"],
        "forbidden_members": ["CN9:PC/-", "CN9:PA/+"],
        "member_variants": {
            "CN10:PB": "S1S2", "CN10:PBe": "S1S2",
            "CN9:PA/+": "dc_bus", "CN9:PC/-": "dc_bus", "CN8:PB": "S3",
        },
    }]
}


def test_functional_path_forbidden_member_and_crossover_flagged():
    # ATV340 merged one braking path mixing DC-bus PC/- into the brake loop
    # AND conflating the per-variant (S1S2 vs dc_bus) terminals.
    g = {"functional_paths": [{
        "name": "DC bus / dynamic braking",
        "sequence": ["CN9:PA/+", "CN9:PC/-", "CN10:PB", "CN10:PBe", "Braking resistor"],
    }]}
    codes = _codes(gates.check_functional_paths(g, _BRAKING_RUBRIC))
    assert "incompatible_functional_path" in codes
    assert "variant_crossover" in codes


def test_functional_path_clean_passes():
    g = {"functional_paths": [{
        "name": "dynamic braking (S1&S2)",
        "sequence": ["CN10:PBe", "CN10:PB", "Braking resistor"],
    }]}
    assert gates.check_functional_paths(g, _BRAKING_RUBRIC) == []


def test_functional_path_no_rubric_passes():
    g = {"functional_paths": [{"name": "braking", "sequence": ["CN9:PC/-"]}]}
    assert gates.check_functional_paths(g, {}) == []


# ---- G12 safety_critical_misread -------------------------------------------


def test_safety_critical_missing_flagged():
    g = {"terminals": [{"tag": "CN6:DI1"}]}  # STO safety terminals absent from the graph
    rubric = {"safety_critical": ["CN2:STO_A", "CN2:STO_B"]}
    f = gates.check_safety_critical(g, rubric)
    assert _codes(f) == ["safety_critical_misread"]
    assert "CN2:STO_A" in f[0]["items"]


def test_safety_critical_present_passes():
    g = {"terminals": [{"tag": "CN2:STO_A"}, {"tag": "CN2:STO_B"}]}
    rubric = {"safety_critical": ["CN2:STO_A", "CN2:STO_B"]}
    assert gates.check_safety_critical(g, rubric) == []


def test_safety_critical_no_rubric_passes():
    assert gates.check_safety_critical({"terminals": [{"tag": "CN6:DI1"}]}, {}) == []


# ---- run_gates rubric branch -----------------------------------------------


def test_run_gates_runs_rubric_gates_when_rubric_present():
    g = {
        "devices": [{"tag": "L2"}],
        "plc_io_channels": [{"tag": "DO1"}],
        "network_links": [{"tag": "L", "connects": ["CN3"]}],
    }
    rubric = {
        "categories": {"device": {"expected": ["DQ1"], "known_misreads": ["DO1"]}},
        "require_refs_resolve": True,
    }
    r = gates.run_gates(g, rubric)
    assert "exact_label_mismatch" in r["codes"]
    assert "dangling_reference" in r["codes"]


def test_run_gates_skips_rubric_gates_without_rubric():
    # Same graph, no rubric -> only structural gates run; neither fires here.
    g = {
        "plc_io_channels": [{"tag": "DO1"}],
        "network_links": [{"tag": "L", "connects": ["CN3"]}],
    }
    r = gates.run_gates(g)
    assert r["codes"] == []
    assert r["safety_critical_misreads"] == []
