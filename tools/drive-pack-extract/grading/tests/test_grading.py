"""Self-tests for the drive-pack grading harness.

All fixtures here are small, synthetic, inline dicts — the real 34MB
PowerFlex manual is never read. The one PDF touched is the tiny synthetic
``fixtures/pf_sample.pdf`` already used by ``tests/test_extract.py``, for the
cite-integrity layer only.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import cite_check
import domain_rules
import gold_score
import grade
import report
import schema_check
from report import LayerResult, build_report, compute_trust_status

FIXTURE_PDF = Path(__file__).resolve().parent.parent.parent / "fixtures" / "pf_sample.pdf"

# ---------------------------------------------------------------------------
# Shared synthetic fixtures — a tiny, internally-consistent v2 pack + gold set
# ---------------------------------------------------------------------------


def _toy_pack() -> dict:
    return {
        "pack_id": "toy_drive",
        "schema_version": 2,
        "family": {"manufacturer": "Toy Co", "series": "Toy 100", "aliases": ["toy100"]},
        "nameplate": {"match_keywords": ["toy100"]},
        "live_decode": {
            "status_bits": {},
            "cmd_word": {},
            "fault_codes": {"81": "DSI Comm Loss", "4": "UnderVoltage"},
            "registers": {},
        },
        "envelope": {},
        "knowledge": {},
        "provenance": {
            "items": {"live_decode.fault_codes": "manual_cited", "parameters": "manual_cited"},
            "sources": [
                {"doc": "Toy Manual", "page": "10", "excerpt": "F081 DSI Comm Loss 2"},
                {"doc": "Toy Manual", "page": "11", "excerpt": "F004 UnderVoltage 1"},
            ],
        },
        "parameters": [
            {
                "parameter_id": "C125",
                "name": "Comm Loss Action",
                "purpose": "Sets action on comm loss",
                "value_meanings": [],
                "default": '0 "Fault"',
                "range": None,
                "unit": None,
                "related_faults": ["F081"],
                "source_citation": {
                    "doc": "Toy Manual",
                    "page": "20",
                    "excerpt": "C125 Comm Loss Action 0 Fault",
                },
                "provenance_tier": "manual_cited",
            },
            {
                "parameter_id": "P045",
                "name": "Comm Loss Time",
                "purpose": "Sets timeout",
                "value_meanings": [],
                "default": "5.0",
                "range": "0.1/60.0",
                "unit": "s",
                "related_faults": [],
                "source_citation": {
                    "doc": "Toy Manual",
                    "page": "21",
                    "excerpt": "P045 Comm Loss Time 5.0",
                },
                "provenance_tier": "manual_cited",
            },
        ],
        "keypad_navigation": [],
    }


def _toy_gold() -> dict:
    return {
        "manual": {
            "vendor": "Toy Co",
            "family": "Toy 100",
            "publication": "TOY-001",
            "filename": "toy.pdf",
            "sha256": "deadbeef",
        },
        "faults": [
            {
                "fault_id": "F081",
                "code": 81,
                "name": "DSI Comm Loss",
                "fault_type": "2",
                "references_parameters": ["C125"],
                "page": 10,
                "diagnostic_critical": True,
            },
            {
                "fault_id": "F004",
                "code": 4,
                "name": "UnderVoltage",
                "fault_type": "1",
                "references_parameters": [],
                "page": 11,
                "diagnostic_critical": True,
            },
        ],
        "parameters": [
            {
                "parameter_id": "C125",
                "name": "Comm Loss Action",
                "range": None,
                "default": '0 "Fault"',
                "unit": None,
                "related_parameters": [],
                "related_faults": ["F081"],
                "page": 20,
                "diagnostic_critical": True,
            },
            {
                "parameter_id": "P045",
                "name": "Comm Loss Time",
                "range": "0.1/60.0",
                "default": "5.0",
                "unit": "s",
                "related_parameters": [],
                "related_faults": [],
                "page": 21,
                "diagnostic_critical": False,
            },
        ],
        "edge_cases": [],
    }


def _write_pack(tmp_path: Path, pack_id: str, pack: dict) -> Path:
    pack_dir = tmp_path / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    (pack_dir / "pack.json").write_text(json.dumps(pack), encoding="utf-8")
    return tmp_path


# ---------------------------------------------------------------------------
# Layer A — schema_check
# ---------------------------------------------------------------------------


def test_schema_check_passes_a_good_pack(tmp_path):
    packs_dir = _write_pack(tmp_path, "toy_drive", _toy_pack())
    result = schema_check.check_schema("toy_drive", packs_dir=packs_dir)
    assert result.status == "pass"
    assert result.metrics["fault_count"] == 2
    assert result.metrics["param_count"] == 2


def test_schema_check_fails_a_pack_missing_a_required_key(tmp_path):
    bad_pack = _toy_pack()
    del bad_pack["envelope"]
    packs_dir = _write_pack(tmp_path, "toy_drive", bad_pack)
    result = schema_check.check_schema("toy_drive", packs_dir=packs_dir)
    assert result.status == "fail"
    assert "envelope" in result.summary


def test_schema_check_fails_on_missing_pack(tmp_path):
    result = schema_check.check_schema("does_not_exist", packs_dir=tmp_path)
    assert result.status == "fail"


# ---------------------------------------------------------------------------
# Layer B — cite_check (uses the tiny synthetic fixture PDF)
# ---------------------------------------------------------------------------


def test_cite_check_skips_when_manual_absent():
    result = cite_check.check_citations(_toy_pack(), None)
    assert result.status == "skipped"


def test_cite_check_verifies_a_real_excerpt_against_the_fixture_pdf():
    pack = {
        "parameters": [],
        "keypad_navigation": [],
        "provenance": {
            "sources": [
                {"doc": "PF Sample", "page": "1", "excerpt": "F004 UnderVoltage"},
            ]
        },
    }
    result = cite_check.check_citations(pack, FIXTURE_PDF)
    assert result.status == "pass"
    assert result.metrics["verified_count"] == 1
    assert result.metrics["unverifiable_count"] == 0


def test_cite_check_flags_dropped_diagnostic_critical_citation():
    pack = {
        "parameters": [
            {
                "parameter_id": "C125",
                "source_citation": {"page": "1", "excerpt": "this text is nowhere on the page"},
            }
        ],
        "keypad_navigation": [],
        "provenance": {"sources": []},
    }
    gold = {"parameters": [{"parameter_id": "C125", "diagnostic_critical": True}], "faults": []}
    result = cite_check.check_citations(pack, FIXTURE_PDF, gold=gold)
    assert result.status == "fail"
    assert "C125" in result.metrics["dropped_diagnostic_critical"]


def test_cite_check_verifies_a_chapter_section_page_label_whole_document():
    """A GS10-style citation with a chapter-section page label ("4-188") — which
    can't be resolved to an integer pdfplumber page — is verified WHOLE-DOCUMENT
    (the excerpt exists on some page). It counts as verified, tallied distinctly."""
    pack = {
        "parameters": [
            {
                "parameter_id": "P09.03",
                "source_citation": {"page": "4-188", "excerpt": "F004 UnderVoltage"},
            }
        ],
        "keypad_navigation": [],
        "provenance": {"sources": []},
    }
    result = cite_check.check_citations(pack, FIXTURE_PDF)
    assert result.status == "pass"
    assert result.metrics["verified_count"] == 1
    assert result.metrics["verified_by_label_count"] == 1
    assert result.metrics["unverifiable_count"] == 0


def test_cite_check_chapter_section_label_still_catches_fabrication():
    """The whole-document fallback must NOT be a free pass — a fabricated excerpt
    on a chapter-section page is still unverifiable (and a dropped diagnostic-
    critical citation still hard-fails)."""
    pack = {
        "parameters": [
            {
                "parameter_id": "P09.03",
                "source_citation": {"page": "4-188", "excerpt": "invented text nowhere in manual"},
            }
        ],
        "keypad_navigation": [],
        "provenance": {"sources": []},
    }
    gold = {"parameters": [{"parameter_id": "P09.03", "diagnostic_critical": True}], "faults": []}
    result = cite_check.check_citations(pack, FIXTURE_PDF, gold=gold)
    assert result.status == "fail"
    assert result.metrics["unverifiable_count"] == 1
    assert "P09.03" in result.metrics["dropped_diagnostic_critical"]


# ---------------------------------------------------------------------------
# Layer C — gold_score
# ---------------------------------------------------------------------------


def test_gold_score_perfect_match():
    result = gold_score.score_against_gold(_toy_pack(), _toy_gold())
    assert result.status == "pass"
    assert result.metrics["overall_recall"] == 1.0
    assert result.metrics["overall_precision"] == 1.0
    assert result.metrics["diagnostic_critical_precision"] == 1.0
    assert result.metrics["diagnostic_critical_recall"] == 1.0
    assert result.metrics["overall_fault_recall"] == 1.0
    assert result.metrics["diagnostic_critical_fault_recall"] == 1.0
    assert result.metrics["fabrication_detected"] is False


def test_gold_score_computes_precision_recall_on_2fault_2param_toy_with_one_gap():
    pack = _toy_pack()
    pack["parameters"] = [p for p in pack["parameters"] if p["parameter_id"] != "P045"]
    result = gold_score.score_against_gold(pack, _toy_gold())
    # total_gold = 2 faults + 2 params + 1 fault->param link (F081 -> C125,
    # scored as its own recall item per GRADING_SPEC.md §C — the link is
    # unaffected by dropping P045) = 5; matched = 2 faults + 1 param (C125) +
    # 1 link (C125 is still in the pack with related_faults=["F081"]) = 4.
    assert result.metrics["total_gold"] == 5
    assert result.metrics["matched_gold"] == 4
    assert result.metrics["overall_recall"] == 4 / 5
    # precision is over the graded (present) intersection only — the missing
    # param was never "present" to grade, so precision on what WAS present
    # stays perfect.
    assert result.metrics["overall_precision"] == 1.0
    assert result.metrics["fabrication_detected"] is False


def test_gold_score_detects_fabricated_value_as_hard_fail():
    pack = _toy_pack()
    pack["live_decode"]["fault_codes"]["81"] = "Totally Different Name"
    result = gold_score.score_against_gold(pack, _toy_gold())
    assert result.status == "fail"
    assert result.metrics["fabrication_detected"] is True
    assert any("contradiction" in d for d in result.details)


def test_gold_score_detects_param_id_planted_in_related_faults():
    pack = _toy_pack()
    # P045 wrongly claims C125 (a parameter id, not a fault id) as a related fault.
    pack["parameters"][1]["related_faults"] = ["C125"]
    result = gold_score.score_against_gold(pack, _toy_gold())
    assert result.status == "fail"
    assert result.metrics["fabrication_detected"] is True
    assert any("fabrication" in d for d in result.details)


def test_gold_score_edge_cases():
    pack = _toy_pack()
    gold = _toy_gold()
    gold["edge_cases"] = [
        {
            "kind": "comma_group_skip",
            "ids": ["P046"],
            "page": 5,
            "expectation": "must not appear in pack",
        },
        {
            "kind": "related_parameters_not_faults",
            "ids": ["P045"],
            "page": 21,
            "expectation": "P045.related_faults must contain only fault ids",
        },
    ]
    result = gold_score.score_against_gold(pack, gold)
    assert result.metrics["edge_case_results"]["comma_group_skip:P046"] == "pass"
    assert result.metrics["edge_case_results"]["related_parameters_not_faults:P045"] == "pass"


# ---------------------------------------------------------------------------
# related_parameters — now a SCORED recall item (param<->param link, e.g.
# C125->P045), same gold-floor semantics as the fault->param link. Previously
# this was informational-only because ParameterCard had no such field; now
# that the schema carries it, a missing expected entry must lower recall
# (never a fabrication), and pack entries not in gold must never be flagged.
# ---------------------------------------------------------------------------


def test_gold_score_related_parameters_present_scores_as_recall():
    pack = _toy_pack()
    pack["parameters"][0]["related_parameters"] = ["P045"]  # C125 -> P045
    gold = _toy_gold()
    gold["parameters"][0]["related_parameters"] = ["P045"]
    result = gold_score.score_against_gold(pack, gold)
    # _toy_gold's baseline total_gold is 5 (2 faults + 2 params + 1 fault->param
    # link); one related_parameters expectation adds one more scored item = 6,
    # and it's satisfied, so matched_gold also grows by one to 6.
    assert result.metrics["total_gold"] == 6
    assert result.metrics["matched_gold"] == 6
    assert result.metrics["overall_recall"] == 1.0
    assert result.metrics["fabrication_detected"] is False
    assert not any("informational" in d or "not scored" in d for d in result.details)


def test_gold_score_related_parameters_missing_is_recall_gap_not_fabrication():
    pack = _toy_pack()
    # C125 has no related_parameters in the pack — gold expects P045.
    gold = _toy_gold()
    gold["parameters"][0]["related_parameters"] = ["P045"]
    result = gold_score.score_against_gold(pack, gold)
    assert result.metrics["total_gold"] == 6
    assert result.metrics["matched_gold"] == 5  # the missing link isn't matched
    assert result.metrics["overall_recall"] == 5 / 6
    assert result.metrics["fabrication_detected"] is False
    assert any("related_parameters" in d and "missing from pack" in d for d in result.details)


def test_gold_score_related_parameters_extra_entry_not_flagged():
    pack = _toy_pack()
    # Pack claims an extra related_parameters entry gold has no opinion on —
    # gold is a floor, not a ceiling, so this must NOT be treated as a
    # fabrication or extra/precision penalty.
    pack["parameters"][0]["related_parameters"] = ["P045", "P999"]
    gold = _toy_gold()  # gold's C125.related_parameters stays []
    result = gold_score.score_against_gold(pack, gold)
    assert result.metrics["fabrication_detected"] is False
    assert result.metrics["overall_precision"] == 1.0


def _link_gold() -> dict:
    """Synthetic gold: one diagnostic-critical fault (F_A) linked to param X,
    one non-critical fault (F_B) linked to param Y. Used to prove the
    fault->param link is a SCORED recall input, not a cosmetic detail line."""
    return {
        "faults": [
            {
                "fault_id": "F_A",
                "code": 100,
                "name": "Fault A",
                "fault_type": "1",
                "references_parameters": ["X"],
                "page": 1,
                "diagnostic_critical": True,
            },
            {
                "fault_id": "F_B",
                "code": 101,
                "name": "Fault B",
                "fault_type": "1",
                "references_parameters": ["Y"],
                "page": 2,
                "diagnostic_critical": False,
            },
        ],
        "parameters": [],
        "edge_cases": [],
    }


def test_gold_score_fault_param_link_is_scored_recall_not_cosmetic():
    """Non-critical link (F_B -> Y) is MISSING from the pack; diagnostic-
    critical link (F_A -> X) is present. Expect: overall recall < 1.0 (the
    missing non-critical link is a real recall deduction), diagnostic-
    critical recall == 1.0 (F_A -> X is intact), and no fabrication (a
    missing link is a recall miss, never a fabrication)."""
    pack = {
        "live_decode": {"fault_codes": {"100": "Fault A", "101": "Fault B"}},
        "parameters": [
            {"parameter_id": "X", "related_faults": ["F_A"]},
            # Y is deliberately absent -> F_B -> Y link is missing.
        ],
    }
    result = gold_score.score_against_gold(pack, _link_gold())
    assert result.metrics["overall_recall"] < 1.0
    assert result.metrics["diagnostic_critical_recall"] == 1.0
    assert result.metrics["fabrication_detected"] is False
    assert any("F_B -> param Y link MISSING" in d for d in result.details)


def test_gold_score_missing_diagnostic_critical_link_drops_dc_recall():
    """Variant: the diagnostic-critical link (F_A -> X) is ALSO missing.
    diagnostic_critical_recall must drop below 1.0."""
    pack = {
        "live_decode": {"fault_codes": {"100": "Fault A", "101": "Fault B"}},
        "parameters": [],  # neither X nor Y present -> both links missing
    }
    result = gold_score.score_against_gold(pack, _link_gold())
    assert result.metrics["diagnostic_critical_recall"] < 1.0
    assert result.metrics["overall_recall"] < 1.0
    assert result.metrics["fabrication_detected"] is False
    assert any("F_A -> param X link MISSING" in d for d in result.details)


# ---------------------------------------------------------------------------
# Layer D — domain_rules
# ---------------------------------------------------------------------------


def test_domain_rules_clean_pack_passes():
    result = domain_rules.check_domain(_toy_pack())
    assert result.status == "pass"
    assert result.details == []


def test_domain_rules_flags_junk_fault_name():
    pack = _toy_pack()
    pack["live_decode"]["fault_codes"]["4"] = "Rockwell Automation Publication 520-UM001"
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("junk name" in d for d in result.details)


def test_domain_rules_flags_param_id_in_related_faults():
    pack = _toy_pack()
    pack["parameters"][1]["related_faults"] = ["C125"]
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("leaked param-id link" in d for d in result.details)


def test_domain_rules_flags_bad_parameter_id_shape():
    pack = _toy_pack()
    pack["parameters"][0]["parameter_id"] = "F081"
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("does not match" in d for d in result.details)


def test_domain_rules_flags_duplicate_parameter_id():
    pack = _toy_pack()
    dup = copy.deepcopy(pack["parameters"][0])
    pack["parameters"].append(dup)
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("duplicate" in d for d in result.details)


# ---------------------------------------------------------------------------
# Family-aware ID conventions (refs #2516): GS10 uses dotted params (P09.03) and
# alphanumeric fault mnemonics (CE10); PowerFlex uses A105/F081. Each family's
# ids must grade, the OTHER family's ids are wrong-family contamination, and the
# param-id-leak guard stays absolute for every family.
# ---------------------------------------------------------------------------
def _family_pack(family: dict, params: list[dict]) -> dict:
    return {
        "pack_id": "t",
        "family": family,
        "live_decode": {"fault_codes": {}},
        "parameters": params,
        "keypad_navigation": [],
        "provenance": {"items": {"parameters": "manual_cited"}, "sources": []},
    }


_GS10 = {"manufacturer": "AutomationDirect", "series": "DURApulse GS10", "aliases": ["GS10"]}
_PF = {"manufacturer": "Rockwell Automation", "series": "PowerFlex 525", "aliases": ["pf525"]}


def test_domain_rules_accepts_gs10_conventions():
    """GS10 dotted param P09.03 + mnemonic fault ref CE10 are valid FOR GS10."""
    pack = _family_pack(_GS10, [{"parameter_id": "P09.03", "related_faults": ["CE10"]}])
    assert domain_rules.check_domain(pack).status == "pass"


def test_domain_rules_powerflex_conventions_still_grade():
    pack = _family_pack(_PF, [{"parameter_id": "C125", "related_faults": ["F081"]}])
    assert domain_rules.check_domain(pack).status == "pass"


def test_domain_rules_catches_powerflex_param_in_gs10_pack():
    pack = _family_pack(_GS10, [{"parameter_id": "A105", "related_faults": []}])
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("durapulse parameter convention" in d for d in result.details)


def test_domain_rules_catches_powerflex_fault_ref_in_gs10_pack():
    pack = _family_pack(_GS10, [{"parameter_id": "P09.03", "related_faults": ["F081"]}])
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("not a valid durapulse fault reference" in d for d in result.details)


def test_domain_rules_catches_gs10_param_in_powerflex_pack():
    pack = _family_pack(_PF, [{"parameter_id": "P09.03", "related_faults": []}])
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("powerflex parameter convention" in d for d in result.details)


def test_domain_rules_catches_gs10_fault_ref_in_powerflex_pack():
    pack = _family_pack(_PF, [{"parameter_id": "C125", "related_faults": ["CE10"]}])
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("not a valid powerflex fault reference" in d for d in result.details)


def test_domain_rules_leak_guard_absolute_under_gs10_convention():
    """A parameter id in related_faults is a leak for EVERY family — even one
    that is itself a valid GS10-shaped id (P09.03 referencing another param)."""
    pack = _family_pack(
        _GS10,
        [
            {"parameter_id": "P09.03", "related_faults": ["P09.04"]},  # P09.04 is a param id
            {"parameter_id": "P09.04", "related_faults": []},
        ],
    )
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("leaked param-id link" in d for d in result.details)


def test_domain_rules_unknown_family_falls_back_to_strict_powerflex():
    """An unrecognized family gets the strict PowerFlex convention — NOT a broad
    relaxation: a GS10-style dotted id in an unknown-family pack is flagged."""
    unknown = {"manufacturer": "Mystery Co", "series": "MX9000"}
    pack = _family_pack(unknown, [{"parameter_id": "P09.03", "related_faults": []}])
    assert domain_rules.check_domain(pack).status == "fail"


def test_domain_rules_flags_duplicate_fault_code_citation():
    pack = _toy_pack()
    pack["provenance"]["sources"].append(
        {"doc": "Toy Manual", "page": "10", "excerpt": "F081 DSI Comm Loss 2"}
    )
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("duplicate" in d and "F081" in d for d in result.details)


def test_domain_rules_flags_uncited_non_null_value():
    pack = _toy_pack()
    pack["parameters"][1]["source_citation"]["excerpt"] = ""
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("uncited value" in d for d in result.details)


def test_domain_rules_flags_empty_view_only_warning():
    pack = _toy_pack()
    pack["keypad_navigation"].append(
        {
            "goal": "view comm loss action",
            "keypad_steps": ["press MENU"],
            "view_only_warning": "  ",
            "source_citation": {"doc": "Toy Manual", "page": "5", "excerpt": "x"},
            "confidence_tier": "low",
            "provenance_tier": "manual_cited",
        }
    )
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("empty view_only_warning" in d for d in result.details)


def test_domain_rules_flags_bad_provenance_tier():
    pack = _toy_pack()
    pack["provenance"]["items"]["live_decode.fault_codes"] = "verified"
    result = domain_rules.check_domain(pack)
    assert result.status == "fail"
    assert any("not one of" in d for d in result.details)


# ---------------------------------------------------------------------------
# Layer E — report / trust status
# ---------------------------------------------------------------------------


def _clean_layer(name: str) -> LayerResult:
    return LayerResult(name=name, status="pass", summary="ok")


def test_trust_status_rejected_on_schema_fail():
    schema_result = LayerResult(name="schema", status="fail", summary="bad")
    cite_result = _clean_layer("cite_integrity")
    gold_result = LayerResult(
        name="gold_score",
        status="pass",
        summary="ok",
        metrics={
            "overall_recall": 1.0,
            "diagnostic_critical_precision": 1.0,
            "diagnostic_critical_fault_recall": 1.0,
            "overall_fault_recall": 1.0,
            "fabrication_detected": False,
        },
    )
    domain_result = _clean_layer("domain_rules")

    status, reasons = compute_trust_status(
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
    )
    assert status == "rejected"
    assert any("schema" in r for r in reasons)


def test_trust_status_internal_only_when_cite_skipped():
    schema_result = _clean_layer("schema")
    domain_result = _clean_layer("domain_rules")
    cite_result = LayerResult(
        name="cite_integrity",
        status="skipped",
        summary="manual not available",
        metrics={"verified_count": 0, "unverifiable_count": 0, "dropped_diagnostic_critical": []},
    )
    gold_result = LayerResult(
        name="gold_score",
        status="pass",
        summary="ok",
        metrics={
            "overall_recall": 1.0,
            "diagnostic_critical_precision": 1.0,
            "diagnostic_critical_fault_recall": 1.0,
            "overall_fault_recall": 1.0,
            "fabrication_detected": False,
        },
    )
    status, reasons = compute_trust_status(
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
    )
    assert status == "internal_only"
    assert any("cite-integrity did not run" in r for r in reasons)


def test_trust_status_beta_on_all_pass_manual_only():
    schema_result = _clean_layer("schema")
    domain_result = _clean_layer("domain_rules")
    cite_result = LayerResult(
        name="cite_integrity",
        status="pass",
        summary="ok",
        metrics={"verified_count": 4, "unverifiable_count": 0, "dropped_diagnostic_critical": []},
    )
    gold_result = LayerResult(
        name="gold_score",
        status="pass",
        summary="ok",
        metrics={
            "overall_recall": 1.0,
            "diagnostic_critical_precision": 1.0,
            "diagnostic_critical_fault_recall": 1.0,
            "overall_fault_recall": 1.0,
            "fabrication_detected": False,
        },
    )
    status, reasons = compute_trust_status(
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
    )
    assert status == "beta"
    assert any("trusted" in r for r in reasons)


def test_build_report_end_to_end_and_write(tmp_path):
    pack = _toy_pack()
    gold = _toy_gold()

    schema_result = schema_check.check_schema(
        "toy_drive", packs_dir=_write_pack(tmp_path / "packs", "toy_drive", pack)
    )
    cite_result = cite_check.check_citations(pack, None, gold=gold)
    gold_result = gold_score.score_against_gold(pack, gold)
    domain_result = domain_rules.check_domain(pack)

    rendered = build_report(
        pack_id="toy_drive",
        pack_dict=pack,
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
        manual_path=None,
        manual_sha256=None,
        extractor_commit="abc1234",
        extraction_command="python grade.py --pack toy_drive --gold gold.json",
        residuals=[],
        generated_at="2026-07-06T00:00:00Z",
    )
    # manual not available -> cite skipped -> caps at internal_only
    assert rendered["trust_status"] == "internal_only"

    json_path, md_path = report.write_report(rendered, tmp_path / "out")
    assert json_path.is_file()
    assert md_path.is_file()
    written = json.loads(json_path.read_text(encoding="utf-8"))
    assert written["pack"]["pack_id"] == "toy_drive"
    assert "INTERNAL_ONLY" in md_path.read_text(encoding="utf-8")


def test_build_report_stores_manual_basename_not_absolute_path():
    """The report is a committed, reproducible artifact — it must record the
    manual by FILENAME, never a machine-specific absolute/temp path (the manual
    itself is never committed). Guards the local-path leak fixed in report.py."""
    ok = LayerResult(name="x", status="pass", summary="s")
    rendered = build_report(
        pack_id="toy_drive",
        pack_dict=_toy_pack(),
        schema_result=ok,
        cite_result=ok,
        gold_result=ok,
        domain_result=ok,
        manual_path=r"C:\Users\someone\AppData\Local\Temp\scratch\pf525_520-um001.pdf",
        manual_sha256="deadbeef",
    )
    assert rendered["manual"]["path"] == "pf525_520-um001.pdf"
    assert "Temp" not in (rendered["manual"]["path"] or "")


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------


def test_grade_cli_end_to_end(tmp_path):
    packs_dir = _write_pack(tmp_path / "packs", "toy_drive", _toy_pack())
    gold_path = tmp_path / "gold.json"
    gold_path.write_text(json.dumps(_toy_gold()), encoding="utf-8")
    out_dir = tmp_path / "out"

    exit_code = grade.main(
        [
            "--pack",
            "toy_drive",
            "--gold",
            str(gold_path),
            "--packs-dir",
            str(packs_dir),
            "--out",
            str(out_dir),
        ]
    )
    # no --manual -> cite-integrity skipped -> internal_only, never rejected
    assert exit_code == 0
    assert (out_dir / "grading_report.json").is_file()
    assert (out_dir / "grading_report.md").is_file()
