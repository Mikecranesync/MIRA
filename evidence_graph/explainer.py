"""The explanation engine — `explain_cause()`.

Reads its receipts from the evidence graph: for an observed symptom it ranks candidate hidden causes
and, for each, exposes WHY it believes it — supporting evidence (tags/asset/manual/history) AND
contradicting evidence — with citations and recommended actions. Contradicting evidence lowers
confidence. Output is ranked hypotheses, never an asserted fact. Deterministic.

Named `explainer` (not `explain`) to avoid a module collision with `causality/explain.py` on the
shared path. The public function is `explain_cause`, as specified.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
_CAUS = _ROOT / "causality"
for _p in (str(_HERE), str(_CAUS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import citations as cit  # noqa: E402
import explain as cex  # noqa: E402  (causality.explain -> _resolve_role)
import failure_library as lib  # noqa: E402
import history as hist  # noqa: E402
import models as gm  # noqa: E402

K = gm.NodeKind
E = gm.EdgeKind
_CR = {"high": 3, "medium": 2, "low": 1, "review": 0}


@dataclass(frozen=True)
class Observation:
    abnormal: frozenset      # signal uns paths in an abnormal/symptom state
    healthy: frozenset       # signal uns paths confirmed in a normal/healthy state
    symptom: str
    line_uns: str
    asset_uns: str           # ground-truth asset (for scoring)
    mode_id: str             # ground-truth cause (for scoring)


@dataclass
class Hypothesis:
    rank: int
    mode_id: str
    title: str
    asset_uns: str
    asset_name: str
    component_type: str
    confidence: str
    score: int
    contradicted: bool
    causal_chain: list
    tag_evidence: list = field(default_factory=list)
    asset_evidence: list = field(default_factory=list)
    manual_evidence: list = field(default_factory=list)
    historical_evidence: object = None
    contradicting_evidence: list = field(default_factory=list)
    recommended_checks: list = field(default_factory=list)
    procedures: list = field(default_factory=list)
    history_summary: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "rank": self.rank, "mode_id": self.mode_id, "title": self.title,
            "asset_uns": self.asset_uns, "asset_name": self.asset_name,
            "component_type": self.component_type, "confidence": self.confidence,
            "score": self.score, "contradicted": self.contradicted, "causal_chain": self.causal_chain,
            "tag_evidence": [c.to_dict() for c in self.tag_evidence],
            "asset_evidence": [c.to_dict() for c in self.asset_evidence],
            "manual_evidence": [c.to_dict() for c in self.manual_evidence],
            "historical_evidence": self.historical_evidence.to_dict() if self.historical_evidence else None,
            "contradicting_evidence": [c.to_dict() for c in self.contradicting_evidence],
            "recommended_checks": self.recommended_checks, "procedures": self.procedures,
            "history_summary": self.history_summary,
        }


@dataclass
class Explanation:
    symptom: str
    line_uns: str
    headline: str
    hypotheses: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"symptom": self.symptom, "line_uns": self.line_uns, "headline": self.headline,
                "hypotheses": [h.to_dict() for h in self.hypotheses]}


def observe(cmodel, mode_id: str, asset_uns: str, conflicting: bool = False) -> Observation:
    """Forward direction: the symptoms a hidden cause produces (and, optionally, a conflicting signal)."""
    km = lib.by_id(mode_id)
    sigs = cmodel.signals_under(asset_uns)
    abnormal = set()
    for role in km.supporting_roles:
        abnormal.update(cex._resolve_role(role, sigs))
    healthy = set()
    if conflicting:
        for role in km.contradicting_roles:
            healthy.update(cex._resolve_role(role, sigs))
        abnormal -= healthy  # a healthy signal can't also be abnormal
    return Observation(frozenset(abnormal), frozenset(healthy), km.symptoms[0],
                       asset_uns.rsplit(".", 1)[0], asset_uns, mode_id)


def _state_label(node, abnormal: bool) -> str:
    arch = (node.attrs or {}).get("archetype", "")
    name = ((node.attrs or {}).get("name", "") or node.label).lower()
    if arch == "live_bool":
        if "running" in name:
            return "FALSE (stopped)" if abnormal else "TRUE (running)"
        return "TRUE" if abnormal else "FALSE"
    if arch == "live_counter":
        if "defect" in name or "reject" in name:
            return "rising" if abnormal else "normal"
        return "rate dropped to 0/min" if abnormal else "still increasing (~120/min)"
    if arch == "live_state":
        return "Down / Fault" if abnormal else "Running"
    if arch == "live_analog":
        if "current" in name:
            return "high / over limit" if abnormal else "normal"
        if "air" in name or "pressure" in name:
            return "below spec" if abnormal else "normal"
        return "out of calibration band" if abnormal else "in band"
    return "abnormal" if abnormal else "normal"


def explain_cause(graph, symptom: str, line_uns: str, observation: Observation, history_data: dict) -> Explanation:
    abn = set(observation.abnormal)
    healthy = set(observation.healthy)

    cands = []
    for c in graph.by_kind(K.CAUSE):
        asset_uns = c.attrs.get("asset_uns", "")
        if asset_uns.rsplit(".", 1)[0] != line_uns:
            continue
        if symptom not in c.attrs.get("symptoms", []):
            continue
        support = [e.dst for e in graph.out_edges(c.id, E.SUPPORTED_BY)]
        contra = [e.dst for e in graph.out_edges(c.id, E.CONTRADICTED_BY)]
        ms = sorted({s for s in support if s in abn})
        mc = sorted({s for s in contra if s in healthy})
        # Contradiction lowers the score (penalty 1), but must not bury a cause whose unique signature
        # tag is still active beneath a weaker-evidence cause: a 1-point penalty + the confidence
        # tiebreak keeps the signature cause on top while dropping its band (High -> Medium).
        cands.append((len(ms) - len(mc), ms, mc, c))

    cands.sort(key=lambda x: (-x[0], -_CR.get(x[3].confidence, 0), x[3].id))
    ranked = [x for x in cands if len(x[1]) >= 1] or cands

    hyps = []
    for i, (score, ms, mc, c) in enumerate(ranked):
        mode_id = c.attrs["mode_id"]
        km = lib.by_id(mode_id)
        contradicted = len(mc) > 0
        conf = "high" if score >= 4 else "medium" if score >= 2 else "low"
        if contradicted and conf == "high":
            conf = "medium"   # contradicting evidence lowers confidence

        asset_uns = c.attrs["asset_uns"]
        asset_name = c.attrs["asset_name"]
        comp = c.attrs["component_type"]

        tag_ev = [cit.tag(s, _state_label(graph.nodes[s], True)) for s in ms]
        asset_ev = [cit.asset("%s hosts the %s (inferred component)" % (asset_name, comp), asset_uns)]
        for e in graph.out_edges(asset_uns, E.FEEDS):
            tgt = graph.nodes.get(e.dst)
            asset_ev.append(cit.asset("%s feeds %s" % (asset_name, tgt.label if tgt else e.dst),
                                      "%s->%s" % (asset_uns, e.dst)))
        man_ev = []
        for e in graph.out_edges(c.id, E.CITES):
            m = graph.nodes[e.dst].attrs
            man_ev.append(cit.manual(m.get("doc", "?"), m.get("page", "?"), m.get("section", ""), m.get("snippet", "")))
        hsum = hist.summary(history_data, c.attrs["history_key"])
        hist_ev = cit.historical(c.attrs["history_key"], hsum)
        contra_ev = [cit.tag(s, _state_label(graph.nodes[s], False)) for s in mc]
        checks = [graph.nodes[e.dst].label for e in graph.out_edges(c.id, E.RECOMMENDS)]
        procs = [{"id": graph.nodes[e.dst].evidence_ref, "title": graph.nodes[e.dst].label,
                  "steps": graph.nodes[e.dst].attrs.get("steps", [])}
                 for e in graph.out_edges(c.id, E.FOLLOWS_PROCEDURE)]

        hyps.append(Hypothesis(
            rank=i + 1, mode_id=mode_id, title=km.title, asset_uns=asset_uns, asset_name=asset_name,
            component_type=comp, confidence=conf, score=score, contradicted=contradicted,
            causal_chain=list(km.chain), tag_evidence=tag_ev, asset_evidence=asset_ev,
            manual_evidence=man_ev, historical_evidence=hist_ev, contradicting_evidence=contra_ev,
            recommended_checks=checks, procedures=procs, history_summary=hsum,
        ))

    if hyps:
        top = hyps[0]
        extra = " (confidence reduced by contradicting evidence)" if top.contradicted else ""
        headline = ("Line is %s. Most likely cause: %s on %s — %s confidence%s (ranked hypothesis)."
                    % (symptom.replace("_", " "), top.title, top.asset_name, top.confidence, extra))
    else:
        headline = "Line is %s. No candidate cause could be ranked." % symptom.replace("_", " ")
    return Explanation(symptom=symptom, line_uns=line_uns, headline=headline, hypotheses=hyps)


def score(explanation: Explanation, observation: Observation) -> bool:
    if not explanation.hypotheses:
        return False
    top = explanation.hypotheses[0]
    return top.mode_id == observation.mode_id and top.asset_uns == observation.asset_uns
