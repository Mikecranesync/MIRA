"""Phase-8 tests for the update-candidate coordinator — the trust-preserving
guarantees, tested WITHOUT a real PDF or subprocess (the extraction + grading
they orchestrate are already covered by the tool's own tests). These assert the
policy layer: no auto-promote, candidate never targets the live packs tree,
unchanged is a no-op, and the report carries provenance + trust status."""

from __future__ import annotations

from pathlib import Path

import pytest
import registry
import update_candidate as uc

# --- decide_action: unchanged is a no-op, changed regenerates, new refuses ---


def test_unchanged_is_noop_without_force():
    assert uc.decide_action(registry.UNCHANGED, force=False) == "noop"


def test_unchanged_regenerates_with_force():
    assert uc.decide_action(registry.UNCHANGED, force=True) == "regenerate"


def test_changed_by_hash_regenerates():
    assert uc.decide_action(registry.CHANGED_BY_HASH, force=False) == "regenerate"


def test_needs_initial_candidate_regenerates():
    assert uc.decide_action(registry.NEEDS_INITIAL_CANDIDATE, force=False) == "regenerate"


def test_new_manual_is_refused():
    assert uc.decide_action(registry.NEW_MANUAL, force=False) == "refuse"


# --- candidate can NEVER be written into the live served packs tree ---------


def test_assert_not_live_packs_blocks_live_tree():
    live = Path("some/root/mira-bots/shared/drive_packs/packs")
    with pytest.raises(RuntimeError, match="LIVE served packs tree"):
        uc.assert_not_live_packs(live)


def test_assert_not_live_packs_allows_candidates_dir(tmp_path):
    # A normal candidates dir must not raise.
    uc.assert_not_live_packs(tmp_path / "candidates")


# --- assembled candidate report carries provenance + trust, never promoted --

_FAKE_GRADING_REPORT = {
    "extractor_commit": "abc1234",
    "extraction_command": "python grade.py --pack powerflex_525 ...",
    "trust_status": "beta",
    "trust_status_reasons": ["schema + domain + cite-integrity all pass"],
    "residuals": ["page 98 deferred"],
    "layers": [
        {"name": "schema", "status": "pass", "summary": "loads via _parse_pack"},
        {"name": "cite", "status": "pass", "summary": "all excerpts verified"},
        {"name": "gold", "status": "pass", "summary": "no fabrication"},
        {"name": "domain", "status": "pass", "summary": "no rule violations"},
    ],
}

_ENTRY = {
    "manual_id": "rockwell_powerflex_525_520-um001",
    "vendor": "Rockwell Automation",
    "product_family": "PowerFlex 525",
    "applicable_drive_models": ["PowerFlex 525"],
    "manual_title": "PowerFlex 525 User Manual",
    "publication": "520-UM001O-EN-E",
    "revision": "O",
    "source_url": None,
    "source_classification": ["official", "downloadable_pdf"],
    "retrieved_date": "2026-07-06",
    "pdf_sha256": "old" + "0" * 61,
    "known_residuals": ["page 98 deferred"],
}


def _report():
    diff = uc.pack_diff(
        prev_pack={
            "live_decode": {"fault_codes": {"1": "A"}},
            "parameters": [{"parameter_id": "P1"}],
        },
        new_pack={
            "live_decode": {"fault_codes": {"1": "A", "2": "B"}},
            "parameters": [{"parameter_id": "P1"}, {"parameter_id": "P2"}],
        },
    )
    return uc.assemble_candidate_report(
        entry=_ENTRY,
        new_sha256="new" + "0" * 61,
        state=registry.CHANGED_BY_HASH,
        grading_report=_FAKE_GRADING_REPORT,
        diff=diff,
    )


def test_candidate_is_never_promoted():
    assert _report()["promoted"] is False


def test_candidate_report_contains_provenance():
    r = _report()
    assert r["pdf_sha256"].startswith("new")
    assert r["previously_registered_sha256"] == _ENTRY["pdf_sha256"]
    assert r["extractor_commit"] == "abc1234"
    assert r["extraction_command"]
    assert r["manual_source"]["manual_id"] == _ENTRY["manual_id"]


def test_candidate_report_contains_trust_status_and_checklist():
    r = _report()
    assert r["trust_status"] == "beta"
    assert r["trust_status"] in registry.TRUST_STATUSES
    assert r["reviewer_checklist"], "must carry a human reviewer checklist"
    # cite-integrity + domain layer results must be surfaced for the reviewer
    assert r["cite_integrity_result"]["status"] == "pass"
    assert r["domain_quality_result"]["status"] == "pass"


def test_pack_diff_detects_added_faults_and_params():
    r = _report()
    d = r["pack_diff_vs_previous"]
    assert d["faults_added"] == ["2"]
    assert d["parameters_added"] == ["P2"]
    assert d["previous_available"] is True


def test_candidate_md_marks_not_promoted():
    md = uc.render_candidate_md(_report())
    assert "CANDIDATE ONLY — NOT PROMOTED" in md
    assert "Reviewer checklist" in md
