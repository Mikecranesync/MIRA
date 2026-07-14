"""Tests for the Universal VFD Manual Compiler (document_ir -> table_discovery
-> schema_inference -> generic_table_parser -> evidence_validator ->
universal_extract), plus the dialect_registry wrapper.

Fixture: the same synthetic ``fixtures/pf_sample.pdf`` the extractor tests use
(a PowerFlex-shaped manual). Pure-unit checks for schema_inference need no PDF.
No network — LLM repair is disabled by default and never invoked here.
"""
from __future__ import annotations

from pathlib import Path

import dialect_registry
import document_ir
import evidence_validator
import records
import schema_inference as si
import table_discovery
import universal_extract

FIXTURE = Path(__file__).parent.parent / "fixtures" / "pf_sample.pdf"


# --- schema_inference (pure) ----------------------------------------------
def test_identifier_classification():
    assert si.classify_identifier("14") == "numeric"
    assert si.classify_identifier("F30001") == "alnum"
    assert si.classify_identifier("A0503") == "alnum"
    assert si.classify_identifier("Pr.04.03") == "dotted"
    assert si.classify_identifier("00.00") == "dotted"
    assert si.classify_identifier("B01.18") == "dotted"
    # prose / non-ids rejected
    assert si.classify_identifier("Description") is None
    assert si.classify_identifier("the") is None
    assert si.classify_identifier("") is None


def test_header_role_mapping_is_vendor_agnostic():
    # Different vendor phrasings collapse to the same canonical roles.
    abb = si.infer_roles(["Fault", "Cause", "What to do"], param_context=False)
    assert set(abb.values()) == {si.FAULT_ID, si.FAULT_CAUSE, si.FAULT_REMEDY}

    yaskawa = si.infer_roles(["Code", "Name", "Possible Solutions"], param_context=False)
    assert si.FAULT_REMEDY in yaskawa.values()

    params = si.infer_roles(["Code", "Name / Description", "Adjustment range", "Factory setting"],
                            param_context=True)
    assert si.PARAM_ID in params.values()
    assert si.PARAM_RANGE in params.values()
    assert si.PARAM_DEFAULT in params.values()


def test_exact_phrase_not_required_only_boosts():
    # A header with NO known vendor phrase but generic role words still resolves.
    roles = si.infer_roles(["No", "Meaning", "Remedy"], param_context=False)
    assert si.FAULT_REMEDY in roles.values()


# --- document_ir -----------------------------------------------------------
def test_document_ir_normalizes_pages():
    ir = document_ir.build_document_ir(FIXTURE, compute_sha=True)
    assert ir.n_pages_total >= 1
    assert ir.sha256  # non-empty hex
    p = ir.pages[0]
    assert p.number == 1
    assert p.n_words > 0
    assert p.ocr_status == "native"
    # word_lines cluster the words into rows
    assert len(p.word_lines) >= 1


def test_document_ir_page_filter():
    ir = document_ir.build_document_ir(FIXTURE, pages=[1], compute_sha=False)
    assert [p.number for p in ir.pages] == [1]


# --- table_discovery -------------------------------------------------------
def test_discovery_finds_candidates_without_exact_header():
    ir = document_ir.build_document_ir(FIXTURE, compute_sha=False)
    cands = table_discovery.discover_document(ir.pages, min_conf=0.3)
    assert cands, "discovery should find at least one table candidate"
    assert all(0.0 <= c.confidence <= 1.0 for c in cands)
    assert all(c.kind in ("fault", "parameter") for c in cands)


def test_group_row_cells_splits_on_gaps():
    words = [
        {"text": "F004", "x0": 10, "x1": 30, "top": 5, "bottom": 15},
        {"text": "UnderVoltage", "x0": 80, "x1": 140, "top": 5, "bottom": 15},
    ]
    cells = table_discovery.group_row_cells(words, gap=10)
    assert len(cells) == 2
    assert cells[0]["text"] == "F004"


# --- records ---------------------------------------------------------------
def test_make_record_keeps_string_id():
    r = records.make_record(
        record_type="fault", ident="oC", id_kind="mnemonic", name="Overcurrent",
        fields={"remedy": "check wiring"}, page=3, bbox=None,
        excerpt="oC Overcurrent", route="dialect:magnetek", confidence=0.95)
    assert r["id"] == "oC" and isinstance(r["id"], str)
    assert r["fields"]["remedy"] == "check wiring"
    assert r["validated"] is False


# --- evidence_validator ----------------------------------------------------
def test_validator_rejects_fabricated_excerpt():
    real = records.make_record(
        record_type="fault", ident="F004", id_kind="numeric",
        name="UnderVoltage", fields={}, page=1,
        bbox=None, excerpt="F004", route="dialect:powerflex", confidence=0.9)
    fake = records.make_record(
        record_type="fault", ident="F999", id_kind="numeric",
        name="Totally Invented", fields={}, page=1, bbox=None,
        excerpt="F999 Totally Invented Fault Never In Manual", route="generic", confidence=0.9)
    validated, rejected = evidence_validator.validate_records(FIXTURE, [real, fake])
    ids_ok = {r["id"] for r in validated}
    ids_bad = {r["id"] for r in rejected}
    assert "F004" in ids_ok
    assert "F999" in ids_bad
    assert all(r["validated"] for r in validated)


def test_validator_flags_empty_id_noise():
    noise = records.make_record(
        record_type="parameter", ident="", id_kind="numeric", name="junk",
        fields={}, page=1, bbox=None, excerpt="junk", route="generic", confidence=0.5)
    validated, rejected = evidence_validator.validate_records(FIXTURE, [noise])
    assert not validated
    assert rejected and rejected[0]["reject_reason"] == "empty id"


# --- dialect_registry ------------------------------------------------------
def test_dialect_fault_conversion_preserves_mnemonic():
    rec = dialect_registry._fault_to_record(
        {"code": None, "fault_id": "oC", "name": "Overcurrent",
         "fault_type": "—", "action": "reduce load", "page": 5, "excerpt": "oC Overcurrent"})
    assert rec["id"] == "oC"
    assert rec["id_kind"] == "mnemonic"
    assert rec["route"] == "dialect:magnetek"
    assert rec["fields"]["remedy"] == "reduce load"


def test_dialect_numeric_fault_conversion():
    rec = dialect_registry._fault_to_record(
        {"code": 4, "fault_id": "F004", "name": "UnderVoltage",
         "fault_type": "1", "action": "", "page": 1, "excerpt": "F004 UnderVoltage 1"})
    assert rec["id"] == "F004" and rec["id_kind"] == "numeric"
    assert rec["route"] == "dialect:powerflex"


# --- universal_extract (end to end) ---------------------------------------
def test_extract_manual_produces_validated_records():
    res = universal_extract.extract_manual(FIXTURE, doc_id="pf_sample")
    assert res["status"] in (universal_extract.STATUS_COMPLETE, universal_extract.STATUS_PARTIAL)
    recs = res["faults"] + res["parameters"]
    assert recs, "fixture should yield records"
    # every emitted record is validated and carries a string id + excerpt
    for r in recs:
        assert r["validated"] is True
        assert isinstance(r["id"], str) and r["id"]
        assert r["excerpt"]
    # provenance present
    assert res["document"]["sha256"]
    assert res["coverage"]["record_count"] == len(recs)


def test_zero_record_run_is_never_labelled_success():
    # A page with no table -> NO_TABLES_FOUND or TABLES_FOUND_NOT_PARSED,
    # never a silent "EXTRACTED"/COMPLETE.
    # A run over an out-of-range page finds no candidates.
    res = universal_extract.extract_manual(FIXTURE, pages=[9999], doc_id="empty")
    assert res["status"] in (
        universal_extract.STATUS_NO_TABLES,
        universal_extract.STATUS_NOT_PARSED,
    )
    assert res["coverage"]["record_count"] == 0
    assert res["status"] != "EXTRACTED"


def test_status_helper_semantics():
    assert universal_extract._compute_status([], []) == universal_extract.STATUS_NO_TABLES

    class _C:
        page = 1
    assert universal_extract._compute_status([_C()], []) == universal_extract.STATUS_NOT_PARSED
