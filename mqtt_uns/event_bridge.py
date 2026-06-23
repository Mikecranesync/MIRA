"""The bridge between the wire and the brain.

The ONLY place Phase 4 touches the explanation engine. It builds the brain (context model + evidence
graph + history) deterministically from the same synthetic fixtures every prior phase uses, turns a
Phase 2 scenario into a wire event, turns a received wire event back into a Phase 3 observation, and
runs the Phase 3 explainer -> answer card. The transport never changes the reasoning; this module
proves it by running the exact same `explain_cause` + `render_card` the offline path uses.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # mqtt_uns/
_ROOT = _HERE.parent
_EG = _ROOT / "evidence_graph"
_CAUS = _ROOT / "causality"
_FC = _ROOT / "factory_context"
_PH0 = _ROOT / "discovery_corpus" / "scripts"
_PARSER = _ROOT / "mira-plc-parser"
for _p in (str(_HERE), str(_EG), str(_CAUS), str(_FC), str(_PH0), str(_PARSER)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import answer_card as card  # noqa: E402  (evidence_graph.answer_card)
import build as fcb  # noqa: E402  (factory_context.build)
import builder as gb  # noqa: E402  (evidence_graph.builder)
import components as comp  # noqa: E402  (causality.components)
import explainer as ex  # noqa: E402  (evidence_graph.explainer)
import history as eg_hist  # noqa: E402  (evidence_graph.history)
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402  (causality.knowledge)
import procedures as eg_proc  # noqa: E402  (evidence_graph.procedures)
import schemas  # noqa: E402  (mqtt_uns.schemas)


def build_brain():
    """Deterministically build (context model, evidence graph, history) from the synthetic fixtures."""
    project = iie.load(iie.DEFAULT_FIXTURE)
    fmodel = fcb.build_model(project, "discovery_corpus/fixtures/" + Path(iie.DEFAULT_FIXTURE).name)
    cmodel = comp.build_causality(fmodel)
    history = eg_hist.load_history()
    graph = gb.build_evidence_graph(cmodel, know.load_knowledge(), history, eg_proc.load_procedures())
    return cmodel, graph, history


def event_from_scenario(cmodel, mode_id: str, asset_uns: str, conflicting: bool = False):
    """Phase 2 -> wire: build the symptom observation and pack it into a MaintenanceEvent."""
    obs = ex.observe(cmodel, mode_id, asset_uns, conflicting=conflicting)
    return schemas.MaintenanceEvent(
        event_type=mode_id, asset_uns=asset_uns, line_uns=obs.line_uns, symptom=obs.symptom,
        abnormal_signals=sorted(obs.abnormal), healthy_signals=sorted(obs.healthy), conflicting=conflicting,
    )


def observation_from_event(event) -> "ex.Observation":
    """Wire -> Phase 3: reconstruct the exact observation the offline path would have used."""
    return ex.Observation(
        abnormal=frozenset(event.abnormal_signals), healthy=frozenset(event.healthy_signals),
        symptom=event.symptom, line_uns=event.line_uns, asset_uns=event.asset_uns, mode_id=event.event_type,
    )


def explain_event(graph, history, event):
    """Run the Phase 3 explainer + answer card for a (wire or offline) event. Returns (explanation, card)."""
    obs = observation_from_event(event)
    exp = ex.explain_cause(graph, event.symptom, event.line_uns, obs, history)
    return exp, card.render_card(exp, graph)
