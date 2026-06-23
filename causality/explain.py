"""The two directions of the causality engine.

  inject(cmodel, mode, asset)  -> Scenario   : a machine that creates realistic symptoms (forward).
  explain(cmodel, symptom)     -> Explanation : MIRA's reasoning -- ranked likely causes (reverse).

`explain` is the PRODUCT. Given a symptom (e.g. "why is this line blocked?"), it returns ranked
candidate hidden causes, each with the causal chain, the supporting tags that corroborate it, the
related manual pages, and the technician checks -- always as ranked hypotheses ("most likely cause"),
never asserted as fact. Deterministic.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import failure_modes as fm  # noqa: E402
import knowledge as know  # noqa: E402

# role token -> predicate(signal) over a Phase-1 signal node (archetype + name).
_CONF_RANK = {"high": 3, "medium": 2, "low": 1}


def _name(sig) -> str:
    return (sig.name or "").lower()


def _resolve_role(role: str, asset_signals: list) -> list[str]:
    """Return the UNS paths of the asset's signals that fill a supporting-tag role."""
    out = []
    for s in asset_signals:
        a = s.archetype
        n = _name(s)
        hit = False
        if role == "photoeye":
            hit = a == "live_bool" and "photoeye" in n
        elif role == "blocked":
            hit = a == "live_bool" and "blocked" in n and "photoeye" not in n
        elif role == "starved":
            hit = a == "live_bool" and "starved" in n
        elif role in ("not_running", "stale"):
            hit = a == "live_bool" and "running" in n
        elif role == "counts":
            hit = a == "live_counter" and "counts" in n and "defect" not in n
        elif role == "reject":
            hit = a == "live_counter" and ("defect" in n or "reject" in n)
        elif role == "state_down":
            hit = a == "live_state"
        elif role == "motor_current":
            hit = a == "live_analog" and "current" in n
        elif role == "air":
            hit = a == "live_analog" and ("air" in n or "pressure" in n)
        elif role == "analog_drift":
            hit = a == "live_analog" and not any(k in n for k in ("current", "air", "pressure"))
        elif role == "fault":
            hit = "fault" in n
        if hit and s.uns_path:
            out.append(s.uns_path)
    return out


@dataclass(frozen=True)
class Scenario:
    """The forward direction: a hidden cause injected on an asset, with the symptoms it produces."""
    mode_id: str
    asset_uns: str
    component_type: str
    symptom: str
    line_uns: str
    abnormal_signals: frozenset


@dataclass
class CausePayload:
    rank: int
    failure_mode_id: str
    title: str
    component_type: str
    asset_uns: str
    asset_name: str
    confidence: str
    score: int
    causal_chain: list[str]
    supporting_tags: list[str]
    manual_citations: list[dict]
    technician_checks: list[str]


@dataclass
class Explanation:
    symptom: str
    line_uns: str
    headline: str
    ranked_causes: list[CausePayload] = field(default_factory=list)

    def to_dict(self) -> dict:
        from dataclasses import asdict
        return {"symptom": self.symptom, "line_uns": self.line_uns, "headline": self.headline,
                "ranked_causes": [asdict(c) for c in self.ranked_causes]}


def inject(cmodel, mode_id: str, asset_uns: str) -> Scenario:
    """Create the realistic symptom set for a hidden cause on an asset (deterministic, ground truth)."""
    mode = fm.BY_ID[mode_id]
    sigs = cmodel.signals_under(asset_uns)
    abnormal: set[str] = set()
    for role in mode.supporting_tag_roles:
        abnormal.update(_resolve_role(role, sigs))
    return Scenario(
        mode_id=mode_id, asset_uns=asset_uns, component_type=mode.component_type,
        symptom=mode.symptoms[0], line_uns=cmodel.line_of(asset_uns),
        abnormal_signals=frozenset(abnormal),
    )


def explain(cmodel, knowledge: dict, symptom: str, line_uns: str, abnormal_signals=()) -> Explanation:
    """Reverse direction: rank the likely hidden causes for an observed symptom on a line."""
    abn = set(abnormal_signals)
    assets = [a for a in cmodel.assets() if cmodel.line_of(a.uns_path) == line_uns]
    cands = []
    for a in assets:
        sigs = cmodel.signals_under(a.uns_path)
        for b in cmodel.bindings_for_asset(a.uns_path):
            mode = fm.BY_ID[b.mode_id]
            if symptom not in mode.symptoms:
                continue
            matched: set[str] = set()
            present: set[str] = set()
            for role in mode.supporting_tag_roles:
                r = _resolve_role(role, sigs)
                present.update(r)
                matched.update(u for u in r if u in abn)
            cands.append((len(matched), mode, a, sorted(matched), sorted(present)))

    cands.sort(key=lambda c: (-c[0], -_CONF_RANK[c[1].base_confidence], c[1].id, c[2].uns_path))
    ranked = [c for c in cands if c[0] >= 1] or cands

    payloads = []
    for i, (score, mode, a, matched, present) in enumerate(ranked):
        conf = "high" if score >= 4 else "medium" if score >= 2 else "low"
        payloads.append(CausePayload(
            rank=i + 1, failure_mode_id=mode.id, title=mode.title, component_type=mode.component_type,
            asset_uns=a.uns_path, asset_name=a.name, confidence=conf, score=score,
            causal_chain=list(mode.chain), supporting_tags=matched or present,
            manual_citations=know.manual_refs(knowledge, mode.id),
            technician_checks=know.checks(knowledge, mode.id),
        ))

    if payloads:
        top = payloads[0]
        headline = ("Line is %s. Most likely cause: %s on %s (%s confidence, ranked hypothesis)."
                    % (symptom.replace("_", " "), top.title, top.asset_name, top.confidence))
    else:
        headline = "Line is %s. No candidate cause could be ranked." % symptom.replace("_", " ")
    return Explanation(symptom=symptom, line_uns=line_uns, headline=headline, ranked_causes=payloads)


def score(explanation: Explanation, scenario: Scenario) -> bool:
    """True iff MIRA's top-ranked cause matches the injected ground-truth cause + asset."""
    if not explanation.ranked_causes:
        return False
    top = explanation.ranked_causes[0]
    return top.failure_mode_id == scenario.mode_id and top.asset_uns == scenario.asset_uns
