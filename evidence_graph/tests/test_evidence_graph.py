"""Tests for the evidence graph — no anonymous facts, all node kinds, the cause→evidence chain."""
from __future__ import annotations

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
import history as hist  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402
import models as gm  # noqa: E402
import procedures as proc  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE


def _graph():
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + FIXTURE.name)
    cmodel = comp_mod.build_causality(fmodel)
    return cmodel, gb.build_evidence_graph(cmodel, know.load_knowledge(), hist.load_history(),
                                           proc.load_procedures())


def test_graph_has_no_anonymous_facts_or_dangling_edges():
    _, g = _graph()
    assert g.violations() == []


def test_all_node_kinds_present():
    _, g = _graph()
    kinds = {n.kind for n in g.nodes.values()}
    for k in (gm.NodeKind.ASSET, gm.NodeKind.SIGNAL, gm.NodeKind.UNS_PATH, gm.NodeKind.CAUSE,
              gm.NodeKind.FAILURE_MODE, gm.NodeKind.MANUAL, gm.NodeKind.PROCEDURE,
              gm.NodeKind.HISTORICAL_EVENT, gm.NodeKind.CORRECTIVE_ACTION, gm.NodeKind.TECHNICIAN_ACTION):
        assert k in kinds, "missing node kind %s" % k


def test_every_node_has_source_and_evidence_ref():
    _, g = _graph()
    for n in g.nodes.values():
        assert n.source.strip(), n.id
        assert n.evidence_ref.strip(), n.id


def test_cause_chain_edges_exist():
    cm, g = _graph()
    conv = next(a for a in cm.assets() if comp_mod.classify_asset(a) == "conveyor")
    cause_id = conv.uns_path + "::photoeye_blocked"
    assert cause_id in g.nodes
    # the cause must connect to asset, failure mode, a supporting signal, a manual, history, an action
    assert g.out_edges(cause_id, gm.EdgeKind.LOCATED_ON)
    assert g.out_edges(cause_id, gm.EdgeKind.IS_A)
    assert g.out_edges(cause_id, gm.EdgeKind.SUPPORTED_BY)
    assert g.out_edges(cause_id, gm.EdgeKind.CITES)
    assert g.out_edges(cause_id, gm.EdgeKind.PRECEDED_BY)
    assert g.out_edges(cause_id, gm.EdgeKind.RECOMMENDS)
    # the supporting signals include the photoeye tag
    sup = [e.dst for e in g.out_edges(cause_id, gm.EdgeKind.SUPPORTED_BY)]
    assert any("photoeye" in s for s in sup)


def test_historical_event_remediated_by_corrective_action():
    _, g = _graph()
    hist_nodes = g.by_kind(gm.NodeKind.HISTORICAL_EVENT)
    assert hist_nodes
    for hn in hist_nodes:
        assert g.out_edges(hn.id, gm.EdgeKind.REMEDIATED_BY)
