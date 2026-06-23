"""Tests for the Phase 1 contextualizer.

Deterministic, offline, against the committed SYNTHETIC fixture only. These prove the Phase 1
contract: evidence export -> approval-ready contextual model + UNS draft, where nothing inferred is
presented as fact (every suggestion carries evidence + confidence + a human approval action).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_FC = Path(__file__).resolve().parents[1]
_ROOT = _FC.parent
for _p in (str(_FC), str(_ROOT / "mira-plc-parser"), str(_ROOT / "discovery_corpus" / "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build as build_mod  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import run_phase1  # noqa: E402
import uns_draft  # noqa: E402
from model import CONFIDENCE_BANDS, ApprovalStatus  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE
SOURCE = "discovery_corpus/fixtures/" + FIXTURE.name


def _model():
    return build_mod.build_model(iie.load(FIXTURE), SOURCE)


# ---- the contextual model is built from evidence ----

def test_entities_for_every_structural_level():
    c = _model().counts()
    for lvl in ("enterprise", "site", "area", "line", "asset"):
        assert c[lvl] >= 1, f"missing {lvl}"


# ---- THE core guarantee: no fact without evidence ----

def test_no_fact_without_evidence():
    assert _model().evidence_violations() == []


def test_every_suggestion_has_evidence_confidence_status_and_approval():
    for s in _model().all_suggestions():
        assert s.evidence, s.statement
        assert s.evidence[0].locator, "evidence must point back to a source locator"
        assert s.confidence in CONFIDENCE_BANDS
        assert s.status in {st.value for st in ApprovalStatus}
        assert s.approval_needed.strip()
        assert s.statement.strip()


# ---- approval-ready: the machine never auto-approves ----

def test_nothing_is_auto_approved():
    for s in _model().all_suggestions():
        assert s.status in (ApprovalStatus.SUGGESTED.value, ApprovalStatus.NEEDS_REVIEW.value)


# ---- UNS draft ----

def test_entity_uns_paths_are_lowercase_dotted_slugs():
    for n in _model().entities():
        assert n.uns_path == n.uns_path.lower()
        assert " " not in n.uns_path
        assert n.uns_path.startswith("synthetic_beverage_co")


def test_live_signals_get_categorised_uns_paths():
    sigs = [n for n in _model().signals() if n.archetype in uns_draft.LIVE_ARCHETYPES]
    assert sigs, "expected live signals"
    paths = [n.uns_path for n in sigs]
    assert all(p for p in paths), "every live signal must have a UNS path"
    # the four required signal kinds map to a category segment
    assert any(".status." in p for p in paths)       # blocked/starved/state/running
    assert any(".production." in p for p in paths)    # counts
    assert any(".process." in p for p in paths)       # tank analogs


def test_blocked_starved_count_state_are_present_in_the_draft():
    names = [n.name.lower() for n in _model().signals() if n.uns_path]
    assert any("blocked" in n for n in names)
    assert any("starved" in n for n in names)
    assert any("counts." in n for n in names)
    assert any(n.startswith("state.") for n in names)


def test_static_metadata_excluded_from_uns_draft():
    for n in _model().signals():
        if n.archetype == "static_metadata":
            assert n.uns_path == "", n.name


# ---- uncertainty is honored: inference is suggested, not fact ----

def test_feeds_relationships_are_inferred_low_and_needs_review():
    feeds = [r for r in _model().relationships if r.rel_type == "feeds"]
    assert feeds, "expected at least one inferred upstream/downstream relationship"
    for r in feeds:
        assert r.suggestion.confidence == "low"
        assert r.suggestion.status == ApprovalStatus.NEEDS_REVIEW.value


def test_contains_relationships_are_structural_high():
    contains = [r for r in _model().relationships if r.rel_type == "contains"]
    assert contains
    for r in contains:
        assert r.suggestion.confidence == "high"


def test_cell_layer_is_proposed_not_asserted():
    cells = _model().by_level("cell")
    assert cells, "expected a proposed cell layer"
    for n in cells:
        assert n.suggestion.confidence == "low"
        assert n.suggestion.status == ApprovalStatus.NEEDS_REVIEW.value


def test_unknown_signals_are_flagged_for_review():
    for n in _model().signals():
        if n.archetype == "unknown":
            assert n.suggestion.status == ApprovalStatus.NEEDS_REVIEW.value


# ---- the Phase 1 success condition + determinism ----

def test_success_condition_met():
    assert run_phase1.success_condition(_model()) == []


def test_uns_category_mapping():
    assert uns_draft.signal_category("live_counter") == "production"
    assert uns_draft.signal_category("live_bool") == "status"
    assert uns_draft.signal_category("live_analog") == "process"
    assert uns_draft.signal_category("static_metadata") is None


def test_determinism_model_is_byte_stable():
    a = json.dumps(_model().to_dict(), sort_keys=True)
    b = json.dumps(_model().to_dict(), sort_keys=True)
    assert a == b
