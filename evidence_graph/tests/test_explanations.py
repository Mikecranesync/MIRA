"""Tests for the explanation engine — auditable, ranked, evidence-backed, with contradicting evidence."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_EG = Path(__file__).resolve().parents[1]
_ROOT = _EG.parent
for _p in (str(_EG), str(_ROOT / "causality"), str(_ROOT / "factory_context"),
           str(_ROOT / "discovery_corpus" / "scripts"), str(_ROOT / "mira-plc-parser")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build as fc_build  # noqa: E402
import builder as gb  # noqa: E402
import components as comp_mod  # noqa: E402
import explainer as ex  # noqa: E402
import history as hist  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402
import procedures as proc  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE
HISTORY = hist.load_history()


def _setup():
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + FIXTURE.name)
    cmodel = comp_mod.build_causality(fmodel)
    graph = gb.build_evidence_graph(cmodel, know.load_knowledge(), HISTORY, proc.load_procedures())
    return cmodel, graph


def _conveyor(cm):
    return next(a for a in cm.assets() if comp_mod.classify_asset(a) == "conveyor")


def _tank(cm):
    return next(a for a in cm.assets() if comp_mod.classify_asset(a) == "tank")


# ---- the flagship: a fully-evidenced answer ----

def test_flagship_top_cause_is_photoeye_with_full_receipts():
    cm, g = _setup()
    conv = _conveyor(cm)
    obs = ex.observe(cm, "photoeye_blocked", conv.uns_path)
    exp = ex.explain_cause(g, "line_blocked", obs.line_uns, obs, HISTORY)
    assert ex.score(exp, obs)
    top = exp.hypotheses[0]
    assert top.mode_id == "photoeye_blocked"
    assert top.confidence == "high"
    # every evidence category present (show receipts)
    assert top.tag_evidence and top.asset_evidence and top.manual_evidence
    assert top.historical_evidence is not None
    assert top.recommended_checks and top.procedures
    assert any("photoeye" in c.ref for c in top.tag_evidence)
    assert top.history_summary["occurrences"] == 3


def test_explanation_is_ranked_not_a_single_fact():
    cm, g = _setup()
    conv = _conveyor(cm)
    obs = ex.observe(cm, "photoeye_blocked", conv.uns_path)
    exp = ex.explain_cause(g, "line_blocked", obs.line_uns, obs, HISTORY)
    assert len(exp.hypotheses) >= 2
    scores = [h.score for h in exp.hypotheses]
    assert scores == sorted(scores, reverse=True)
    assert "hypothesis" in exp.headline.lower()


# ---- contradicting evidence lowers confidence ----

def test_contradicting_evidence_lowers_confidence():
    cm, g = _setup()
    conv = _conveyor(cm)
    clean = ex.observe(cm, "photoeye_blocked", conv.uns_path)
    conflicted = ex.observe(cm, "photoeye_blocked", conv.uns_path, conflicting=True)
    exp_clean = ex.explain_cause(g, "line_blocked", clean.line_uns, clean, HISTORY)
    exp_conf = ex.explain_cause(g, "line_blocked", conflicted.line_uns, conflicted, HISTORY)
    p_clean = next(h for h in exp_clean.hypotheses if h.mode_id == "photoeye_blocked")
    p_conf = next(h for h in exp_conf.hypotheses if h.mode_id == "photoeye_blocked")
    assert p_clean.confidence == "high"
    assert p_conf.contradicting_evidence            # shows evidence AGAINST
    assert p_conf.contradicted is True
    assert p_conf.confidence != "high"              # confidence dropped


# ---- generic binding: a different asset/cause explains correctly ----

def test_generic_binding_sensor_drift_on_tank():
    cm, g = _setup()
    tank = _tank(cm)
    obs = ex.observe(cm, "sensor_drift", tank.uns_path)
    exp = ex.explain_cause(g, "quality_reject", obs.line_uns, obs, HISTORY)
    assert ex.score(exp, obs)
    assert exp.hypotheses[0].mode_id == "sensor_drift"


# ---- no unsupported claims + determinism ----

def test_no_hypothesis_lacks_tag_or_manual_evidence():
    cm, g = _setup()
    conv = _conveyor(cm)
    obs = ex.observe(cm, "photoeye_blocked", conv.uns_path)
    exp = ex.explain_cause(g, "line_blocked", obs.line_uns, obs, HISTORY)
    for h in exp.hypotheses:
        assert h.tag_evidence, h.mode_id
        assert h.manual_evidence, h.mode_id


def test_explanation_is_deterministic():
    cm, g = _setup()
    conv = _conveyor(cm)
    obs = ex.observe(cm, "photoeye_blocked", conv.uns_path)
    a = json.dumps(ex.explain_cause(g, "line_blocked", obs.line_uns, obs, HISTORY).to_dict(), sort_keys=True)
    b = json.dumps(ex.explain_cause(g, "line_blocked", obs.line_uns, obs, HISTORY).to_dict(), sort_keys=True)
    assert a == b
