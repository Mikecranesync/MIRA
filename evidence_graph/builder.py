"""Build the evidence graph from the Phase 2 causality model + the synthetic knowledge fixtures.

Connects: Cause -> Asset -> Signal -> UNS Path -> Manual -> Procedure -> Historical Event ->
Failure Mode -> Technician Action. Every node carries source + evidence_ref (no anonymous facts);
every edge is an evidence relationship. The explanation engine reads its receipts from this graph.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # evidence_graph/
_ROOT = _HERE.parent
_CAUS = _ROOT / "causality"
_FC = _ROOT / "factory_context"
_PARSER = _ROOT / "mira-plc-parser"
for _p in (str(_HERE), str(_CAUS), str(_FC), str(_PARSER)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import explain as cex  # noqa: E402  (causality.explain -> _resolve_role)
import failure_library as lib  # noqa: E402
import history as hist  # noqa: E402
import knowledge as know  # noqa: E402  (causality.knowledge)
import models as gm  # noqa: E402
import procedures as proc  # noqa: E402

K = gm.NodeKind
E = gm.EdgeKind


def build_evidence_graph(cmodel, knowledge: dict, history_data: dict, procedures_data: dict) -> gm.EvidenceGraph:
    g = gm.EvidenceGraph()

    # --- structural layer: assets, signals, UNS paths (observed, from Phase 1) ---
    for a in cmodel.assets():
        g.add_node(gm.EvidenceNode(id=a.uns_path, kind=K.ASSET, label=a.name,
                                   source="phase1_context_model", evidence_ref=a.uns_path,
                                   confidence=a.suggestion.confidence, approval_status=a.suggestion.status))
        g.add_node(gm.EvidenceNode(id="uns:" + a.uns_path, kind=K.UNS_PATH, label=a.uns_path,
                                   source="phase1_context_model", evidence_ref=a.uns_path,
                                   approval_status="observed"))
        g.add_edge(a.uns_path, "uns:" + a.uns_path, E.HAS_UNS)
        for s in cmodel.signals_under(a.uns_path):
            g.add_node(gm.EvidenceNode(id=s.uns_path, kind=K.SIGNAL, label=s.name,
                                       source="phase1_context_model", evidence_ref=s.uns_path,
                                       confidence=s.suggestion.confidence, approval_status=s.suggestion.status,
                                       attrs={"archetype": s.archetype, "name": s.name}))
            g.add_edge(a.uns_path, s.uns_path, E.CONTAINS)
            g.add_node(gm.EvidenceNode(id="uns:" + s.uns_path, kind=K.UNS_PATH, label=s.uns_path,
                                       source="phase1_context_model", evidence_ref=s.uns_path,
                                       approval_status="observed"))
            g.add_edge(s.uns_path, "uns:" + s.uns_path, E.HAS_UNS)

    for r in cmodel.context.relationships:
        if r.rel_type == "feeds" and r.source_path in g.nodes and r.target_path in g.nodes:
            g.add_edge(r.source_path, r.target_path, E.FEEDS, rationale=r.suggestion.statement)

    # --- causal layer: a per-asset Cause hypothesis for each bound failure mode ---
    for b in cmodel.bindings:
        km = lib.by_id(b.mode_id)
        fm_id = "fm:" + km.id
        g.add_node(gm.EvidenceNode(id=fm_id, kind=K.FAILURE_MODE, label=km.title,
                                   source="failure_mode_catalog", evidence_ref=km.id,
                                   attrs={"symptoms": list(km.symptoms)}))
        cause_id = b.asset_uns + "::" + km.id
        g.add_node(gm.EvidenceNode(
            id=cause_id, kind=K.CAUSE, label="%s on %s" % (km.title, b.asset_name),
            source="failure_mode_catalog", evidence_ref=km.id,
            confidence=km.base_confidence, approval_status="hypothesis",
            attrs={"mode_id": km.id, "asset_uns": b.asset_uns, "asset_name": b.asset_name,
                   "component_type": km.component_type, "symptoms": list(km.symptoms),
                   "chain": list(km.chain), "history_key": km.history_key},
        ))
        g.add_edge(cause_id, b.asset_uns, E.LOCATED_ON)
        g.add_edge(cause_id, fm_id, E.IS_A)

        sigs = cmodel.signals_under(b.asset_uns)
        for role in km.supporting_roles:
            for su in cex._resolve_role(role, sigs):
                g.add_edge(cause_id, su, E.SUPPORTED_BY, rationale="role:%s" % role)
        for role in km.contradicting_roles:
            for su in cex._resolve_role(role, sigs):
                g.add_edge(cause_id, su, E.CONTRADICTED_BY, rationale="role:%s" % role)

        for m in know.manual_refs(knowledge, km.id):
            mid = "manual:%s:%s" % (m.get("doc"), m.get("page"))
            g.add_node(gm.EvidenceNode(id=mid, kind=K.MANUAL, label="%s p.%s" % (m.get("doc"), m.get("page")),
                                       source="maintenance_knowledge", evidence_ref=mid, attrs=dict(m)))
            g.add_edge(cause_id, mid, E.CITES)

        for pid in km.procedures:
            p = proc.get(procedures_data, pid)
            nid = "proc:" + pid
            g.add_node(gm.EvidenceNode(id=nid, kind=K.PROCEDURE, label=p.get("title", pid),
                                       source="procedures", evidence_ref=pid, attrs=dict(p)))
            g.add_edge(cause_id, nid, E.FOLLOWS_PROCEDURE)

        for ev in hist.events(history_data, km.id):
            hid = "hist:" + str(ev.get("id"))
            g.add_node(gm.EvidenceNode(id=hid, kind=K.HISTORICAL_EVENT, label=str(ev.get("id")),
                                       source="maintenance_history", evidence_ref=str(ev.get("id")), attrs=dict(ev)))
            g.add_edge(cause_id, hid, E.PRECEDED_BY)
            caid = "ca:" + str(ev.get("id"))
            g.add_node(gm.EvidenceNode(id=caid, kind=K.CORRECTIVE_ACTION, label=str(ev.get("corrective_action")),
                                       source="maintenance_history", evidence_ref=str(ev.get("id"))))
            g.add_edge(hid, caid, E.REMEDIATED_BY)

        for i, chk in enumerate(know.checks(knowledge, km.id)):
            aid = "action:%s:%d" % (km.id, i)
            g.add_node(gm.EvidenceNode(id=aid, kind=K.TECHNICIAN_ACTION, label=chk,
                                       source="maintenance_knowledge", evidence_ref="%s#check%d" % (km.id, i)))
            g.add_edge(cause_id, aid, E.RECOMMENDS)

    return g
