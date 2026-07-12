"""
Deterministic tests for the Fault Dictionary Extractor (Fault Intelligence brick).
Run: pytest tests/simlab/test_fault_dictionary.py -q

Offline / read-only: only reads simlab/docs/*/fault_code_table.md. No DB, network,
cloud, or live LLM.
"""
from demo.factory_difference_engine.fault_dictionary import (
    extract_fault_dictionary, lookup_fault,
)

REQUIRED_FIELDS = {
    "asset", "code", "label", "severity", "description", "likely_cause",
    "recommended_action", "referenced_tags", "source_doc", "source_path",
    "missing_evidence", "confidence", "parse_status",
}


def test_all_asset_tables_parse():
    recs = extract_fault_dictionary()
    assets = {r["asset"] for r in recs}
    assert len(assets) == 11, "expected all 11 asset fault tables, got %s" % sorted(assets)
    assert len(recs) >= 40  # 53 today; guard against a parser regression to ~0
    assert "filler01" in assets


def test_extraction_is_deterministic():
    assert extract_fault_dictionary() == extract_fault_dictionary()


def test_every_record_has_required_fields_and_source():
    for r in extract_fault_dictionary():
        assert REQUIRED_FIELDS <= set(r), "missing fields on %s/%s" % (r.get("asset"), r.get("code"))
        assert r["source_doc"] == "fault_code_table.md"
        assert r["source_path"].endswith("/%s/fault_code_table.md" % r["asset"])  # citation preserved
        assert r["parse_status"] in ("ok", "empty")


def test_filler01_f007_low_bowl_pressure():
    f7 = lookup_fault("F007", asset="filler01")
    assert f7, "F007 should exist for filler01"
    assert "low bowl pressure" in f7["label"].lower()
    assert f7["severity"] == "FAULT"
    # F007 links to the bowl pressure signal — the future Difference Bundle join point
    assert "filler_bowl_pressure" in f7["referenced_tags"]
    assert f7["source_path"] == "simlab/docs/filler01/fault_code_table.md"


def test_referenced_tags_come_from_backticks():
    f7 = lookup_fault("F007", asset="filler01")
    # all referenced tags are snake_case tag identifiers pulled from backticks
    assert f7["referenced_tags"] == sorted(f7["referenced_tags"])
    assert all(t.islower() and "_" in t for t in f7["referenced_tags"])
    assert f7["referenced_tags"]  # non-empty


def test_missing_evidence_flags_absent_vfd_diagnostics():
    # F002 "Motor Overload" references overload but the sim has no overload signal
    f2 = lookup_fault("F002", asset="filler01")
    assert f2
    sigs = {m["suggested_signal"] for m in f2["missing_evidence"]}
    assert "overload_count" in sigs
    # a pure process fault (F007) references only present tags -> no missing evidence
    assert lookup_fault("F007", asset="filler01")["missing_evidence"] == []


def test_lookup_by_asset_and_code():
    single = lookup_fault("F001", asset="filler01")
    assert isinstance(single, dict) and single["code"] == "F001"
    across = lookup_fault("F001")  # no asset -> list across assets
    assert isinstance(across, list) and len(across) >= 1


def test_unknown_code_fails_safe():
    assert lookup_fault("NOPE", asset="filler01") == {}   # asset given -> empty dict
    assert lookup_fault("NOPE") == []                     # no asset -> empty list


def test_offline_no_side_channels():
    # Pure function of local files; runs with no env/DB/network configured.
    recs = extract_fault_dictionary()
    assert recs and all(r["confidence"] <= 1.0 for r in recs)
