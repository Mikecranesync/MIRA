"""Tests for the maintenance-causality engine.

Deterministic, offline, against the committed SYNTHETIC fixture only. These prove the PRODUCT claim:
given a symptom, MIRA explains the likely hidden cause correctly, grounded in the factory's own tags +
synthetic manuals, as ranked hypotheses (never asserted as fact).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_FC_TESTS = Path(__file__).resolve().parents[1]      # causality/
_ROOT = _FC_TESTS.parent
for _p in (str(_FC_TESTS), str(_ROOT / "factory_context"), str(_ROOT / "discovery_corpus" / "scripts"),
           str(_ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build as fc_build  # noqa: E402
import components as comp_mod  # noqa: E402
import explain as ex  # noqa: E402
import failure_modes as fm  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE


def _cmodel():
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + FIXTURE.name)
    return comp_mod.build_causality(fmodel)


def _conveyor(cm):
    return next(a for a in cm.assets() if comp_mod.classify_asset(a) == "conveyor")


def _tank(cm):
    return next(a for a in cm.assets() if comp_mod.classify_asset(a) == "tank")


# ---- the catalog: a handful of realistic maintenance problems ----

def test_catalog_has_the_eight_failure_modes():
    ids = {m.id for m in fm.CATALOG}
    assert ids == {
        "photoeye_blocked", "conveyor_jam", "vfd_not_enabled", "motor_overload",
        "sensor_drift", "low_air_pressure", "failed_interlock", "comm_loss",
    }
    for m in fm.CATALOG:
        assert m.chain and m.symptoms and m.supporting_tag_roles


def test_every_mode_has_manuals_and_checks():
    """Cite-evidence (northstar SC7): no failure mode without manual pages + technician checks."""
    k = know.load_knowledge()
    for m in fm.CATALOG:
        assert know.manual_refs(k, m.id), m.id
        assert know.checks(k, m.id), m.id


# ---- the component sublayer is inferred under assets (not asserted) ----

def test_components_inferred_under_assets():
    cm = _cmodel()
    assert cm.components and cm.bindings
    conv = _conveyor(cm)
    types = {c.component_type for c in cm.components if c.asset_uns == conv.uns_path}
    assert {"photoeye", "conveyor_motor", "vfd"}.issubset(types)
    tank_types = {c.component_type for c in cm.components if c.asset_uns == _tank(cm).uns_path}
    assert "sensor" in tank_types


def test_components_are_needs_review_with_evidence():
    cm = _cmodel()
    assert cm.evidence_violations() == []
    for c in cm.components:
        assert c.suggestion.status == "needs_review"   # inferred, not in the export -> not a fact
        assert c.suggestion.evidence


# ---- THE flagship: "why is this line blocked?" -> photoeye on the conveyor ----

def test_flagship_photoeye_is_top_ranked_cause():
    cm = _cmodel()
    conv = _conveyor(cm)
    scen = ex.inject(cm, "photoeye_blocked", conv.uns_path)
    exp = ex.explain(cm, know.load_knowledge(), "line_blocked", scen.line_uns, scen.abnormal_signals)
    assert ex.score(exp, scen)
    top = exp.ranked_causes[0]
    assert top.failure_mode_id == "photoeye_blocked"
    assert top.component_type == "photoeye"
    assert top.asset_uns == conv.uns_path
    assert top.confidence in ("high", "medium")
    # grounded: the photoeye tag is among the supporting tags
    assert any("photoeye" in t for t in top.supporting_tags)
    assert top.manual_citations and top.technician_checks
    assert top.causal_chain[0].lower().startswith("photoeye")


def test_explanation_is_ranked_hypotheses_not_fact():
    cm = _cmodel()
    conv = _conveyor(cm)
    scen = ex.inject(cm, "photoeye_blocked", conv.uns_path)
    exp = ex.explain(cm, know.load_knowledge(), "line_blocked", scen.line_uns, scen.abnormal_signals)
    assert len(exp.ranked_causes) >= 2, "should present alternatives, not a single asserted cause"
    scores = [c.score for c in exp.ranked_causes]
    assert scores == sorted(scores, reverse=True)
    assert "likely" in exp.headline.lower() and "hypothesis" in exp.headline.lower()


# ---- generic binding works beyond the conveyor ----

def test_generic_binding_sensor_drift_on_tank():
    cm = _cmodel()
    tank = _tank(cm)
    scen = ex.inject(cm, "sensor_drift", tank.uns_path)
    exp = ex.explain(cm, know.load_knowledge(), "quality_reject", scen.line_uns, scen.abnormal_signals)
    assert ex.score(exp, scen)
    assert exp.ranked_causes[0].failure_mode_id == "sensor_drift"


def test_asset_classification():
    cm = _cmodel()
    classes = {comp_mod.classify_asset(a) for a in cm.assets()}
    assert {"conveyor", "tank"}.issubset(classes)


# ---- determinism ----

def test_explanation_is_deterministic():
    cm = _cmodel()
    conv = _conveyor(cm)
    scen = ex.inject(cm, "photoeye_blocked", conv.uns_path)
    k = know.load_knowledge()
    a = ex.explain(cm, k, "line_blocked", scen.line_uns, scen.abnormal_signals).to_dict()
    b = ex.explain(cm, k, "line_blocked", scen.line_uns, scen.abnormal_signals).to_dict()
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
