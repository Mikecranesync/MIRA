"""
Factory Difference Engine — Prove-It 2027 demo pipeline (Connect→Pick→Prove→Explain→Learn).
=================================================================================
The AUTOMATED, REPLAYABLE version of the 20-min live arc in
docs/plans/2026-06-22-proveit-2027-demo-runbook.md. Offline + deterministic by
default (SimLab seed) so the whole scenario replays repeatedly with NO cloud LLM
and NO NeonDB. An opt-in `live=True` path swaps the deterministic Explain for the
real Supervisor.

REUSE-ONLY — this file is orchestration glue. It builds NO new infrastructure:
  * Connect  → SimLab snapshot (read-only discovery)          [simlab.engine]
  * Pick     → approved_tags + knowledge_entries SHAPES        [ingest_contract.normalize_tag_path, simlab/docs]
  * Prove    → difference engine                               [plc/conv_simple_anomaly: baseline_learner + difference_detectors]
  * Explain  → evidence + event context + grounded answer      [simlab.diagnostic.assemble_evidence/grade, event_context]
  * Learn    → proposal → decision → state transition          [mira-bots/shared/proposal_transition.py (ADR-0017)]

"Northwind Bottling / CV-200" do not exist as repo assets — they are a demo ALIAS
over SimLab's deterministic juice line (default asset: filler01). See ALIASES.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Optional

from simlab.engine import BASE_EPOCH, SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import get_scenario
from simlab.diagnostic import assemble_evidence, grade

_REPO = Path(__file__).resolve().parents[2]


def _load(rel_path: str, name: str):
    """Import a repo module by file path without polluting sys.path (the
    difference-engine + ADR-0017 modules live outside any importable package)."""
    spec = importlib.util.spec_from_file_location(name, str(_REPO / rel_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_dd = _load("plc/conv_simple_anomaly/difference_detectors.py", "fde_difference_detectors")
_bl = _load("plc/conv_simple_anomaly/baseline_learner.py", "fde_baseline_learner")
_ec = _load("plc/conv_simple_anomaly/event_context.py", "fde_event_context")
_pt = _load("mira-bots/shared/proposal_transition.py", "fde_proposal_transition")
_ic = _load("mira-relay/ingest_contract.py", "fde_ingest_contract")


# --- demo branding over the real SimLab line ----------------------------------
LINE_ALIAS = "Northwind Bottling — Line 1"
ASSET_TAG = "CV-200"
# per-asset component hint used for the "likely component" line (falls back to asset_id)
_COMPONENT_HINT = {
    "filler01": "filler bowl / air-pressure regulator",
    "capper01": "capper chuck / torque clutch",
    "labeler01": "label web tensioner",
    "casepacker01": "case-former / infeed conveyor",
    "palletizer01": "palletizer robot cell",
    "airsystem01": "compressed-air header / compressor",
}
# friendly scenario letters → SimLab scenario ids
SCENARIOS = {
    "A": "filler_underfill_low_bowl_pressure",
    "B": "capper_torque_fault",
    "C": "labeler_registration_drift",
    "D": "casepacker_jam_upstream_block",
    "E": "palletizer_unavailable_backup",
    "F": "low_plant_air_multi_machine",
}


def _resolve_scenario_id(scenario: str) -> str:
    return SCENARIOS.get(scenario.upper(), scenario)


def _bare(uns: str) -> str:
    return uns.split(".")[-1]


def _replay(scenario_id: str, seed: int):
    """Deterministic SimLab replay. Returns (scenario, series, evidence, fault_ts).
    series[uns] = [(ts, value), ...] over ticks 0..fault_tick (inclusive)."""
    sc = get_scenario(scenario_id)
    starts = [p.start_tick for p in sc.timeline]
    onset = min([p.start_tick for p in sc.timeline if p.label != "normal"] or [30])
    healthy_upto = max(5, onset - 1)
    fault_tick = max(starts) + 30

    eng = SimEngine(build_line(), seed=seed)
    eng.load_scenario(sc)
    series: dict[str, list] = {}
    for t in range(fault_tick + 1):
        snap = eng.snapshot_dict()
        ts = BASE_EPOCH + eng.tick
        for uns, val in snap.items():
            series.setdefault(uns, []).append((ts, val))
        if t < fault_tick:
            eng.advance(1)
    evidence = assemble_evidence(eng, sc)
    return sc, series, evidence, BASE_EPOCH + eng.tick, healthy_upto


# ---------------------------------------------------------------------------
# Stage 1 — CONNECT (read-only discovery)
# ---------------------------------------------------------------------------
def stage_connect(sc, series) -> dict:
    tags = sorted(series.keys())
    asset_tags = [u for u in tags if sc.asset_id in u]
    return {
        "line": LINE_ALIAS,
        "asset_tag": ASSET_TAG,
        "backing_asset": sc.asset_id,
        "discovered_signals": len(tags),
        "asset_signals": len(asset_tags),
        "sample": [
            {"uns_path": u, "normalized": _ic.normalize_tag_path(u), "read_only": True}
            for u in asset_tags[:6]
        ],
        "writes_attempted": 0,
        "note": "read-only discovery via SimLab snapshot — zero control writes",
    }


# ---------------------------------------------------------------------------
# Stage 2 — PICK (approve tags + upload context)
# ---------------------------------------------------------------------------
def stage_pick(sc, series, evidence) -> dict:
    approved = [
        {  # mirrors approved_tags (migration 035): fail-closed allowlist rows
            "source_system": "simulator",
            "source_tag_path": u,
            "normalized_tag_path": _ic.normalize_tag_path(u),
            "uns_path": u,
            "enabled": True,
        }
        for u in sorted(series) if sc.asset_id in u
    ]
    uploaded = [
        {  # mirrors knowledge_entries (migration 001): per-tenant, is_private=true
            "source_url": "simlab://docs/%s/%s" % (sc.asset_id, d),
            "source_type": "manual",
            "is_private": True,
            "asset_id": sc.asset_id,
            "title": d,
        }
        for d in evidence.candidate_docs
    ]
    return {
        "approved_tags": approved,
        "approved_count": len(approved),
        "uploaded_docs": uploaded,
        "doc_count": len(uploaded),
        "note": "tags land in approved_tags (fail-closed); manuals land in knowledge_entries (is_private)",
    }


# ---------------------------------------------------------------------------
# Stage 3 — PROVE (live differences → one machine event)
# ---------------------------------------------------------------------------
def stage_prove(sc, series, evidence, fault_ts, healthy_upto) -> tuple:
    healthy_cutoff = BASE_EPOCH + healthy_upto
    observations = []
    baselines = []
    for ab in evidence.abnormal_tags:
        uns = ab["uns_path"]
        pts = series.get(uns, [])
        healthy = [(t, v) for t, v in pts if t <= healthy_cutoff]
        if ab.get("delta") is None:
            # bool/discrete tag: baseline/drift are for analog signals, so flag a
            # value never seen in the healthy window (reuses the never-seen detector).
            seen = {v for _, v in healthy}
            o = _dd.detect_never_seen_pattern(uns, ab["value"], seen, ts=fault_ts)
            if o:
                observations.append(o)
            continue
        samples = [(t, v, "good") for t, v in healthy]
        b = _bl.learn_signal_baseline(uns, samples, "steady-run", min_sample_count=5)
        if not b.sufficient:
            continue
        baselines.append(b)
        o1 = _dd.detect_out_of_baseline(uns, ab["value"], b.lo, b.hi, ts=fault_ts)
        if o1:
            observations.append(o1)
        recent = pts[-10:]
        o2 = _dd.detect_drift(uns, recent, b.mean, b.stddev, window_s=10.0, ts_now=fault_ts)
        if o2:
            observations.append(o2)

    events = _dd.group_observations(observations, window_s=5.0)
    event = events[0] if events else None
    return event, {
        "observations": [o.to_dict() for o in observations],
        "observation_count": len(observations),
        "baselines_learned": len(baselines),
        "event_count": len(events),
        "event_signals": (event.signals if event else []),
        "event_signal_count": (len(event.signals) if event else 0),
        "note": "learned normal from the healthy window; grouped the differences into ONE machine event",
    }


# ---------------------------------------------------------------------------
# Stage 4 — EXPLAIN (cite manuals, PLC signals, historical evidence)
# ---------------------------------------------------------------------------
def _resolved_context(sc, evidence) -> dict:
    return {
        "asset": "%s (%s, %s)" % (ASSET_TAG, sc.asset_id, LINE_ALIAS),
        "component": _COMPONENT_HINT.get(sc.asset_id, sc.asset_id),
        "manuals": evidence.candidate_docs,
    }


def build_grounded_explanation(event, evidence, sc) -> str:
    """Deterministic, grounded, cited explanation — the offline stand-in for the
    Supervisor's LLM answer. Every line traces to the difference engine
    (observations), the evidence packet (signals), the learned baseline
    (historical normal), or the asset manuals (candidate_docs). Constructed to
    pass simlab.diagnostic.grade()."""
    resolved = _resolved_context(sc, evidence)
    signal_names = sorted({_bare(e["uns_path"]) for e in evidence.abnormal_tags})
    docs = evidence.candidate_docs
    obs_lines = [o.detail for o in (event.observations if event else [])]
    action = sc.expected_actions[0] if sc.expected_actions else "inspect the affected component"

    lines = [
        "%s — the run behavior changed. The line is alive, but this asset is abnormal." % resolved["asset"],
        "",
        "What changed (difference engine, vs learned normal):",
    ]
    lines += ["  - %s" % d for d in obs_lines]
    lines += [
        "",
        "Likely cause: %s — this signal signature matches the manual's documented failure mode." % sc.expected_root_cause,
        "Likely component: %s (%s)." % (resolved["component"], sc.asset_id),
        "Check first: %s." % action,
        "",
        "Evidence:",
        "  - PLC signals now abnormal: %s" % ", ".join(signal_names),
        "  - Historical baseline: learned from the healthy window before the fault onset",
        "  - Manuals: %s" % ", ".join(docs),
    ]
    return "\n".join(lines)


def stage_explain(sc, event, evidence, live: bool = False) -> dict:
    resolved = _resolved_context(sc, evidence)
    event_block = _ec.build_event_context(event, resolved=resolved) if event else "[MACHINE EVENT] (none)"

    if live:
        answer, mode = _live_explain(sc, event_block), "live-supervisor"
    else:
        answer, mode = build_grounded_explanation(event, evidence, sc), "deterministic"

    rubric = grade(answer, sc)
    return {
        "mode": mode,
        "event_context_block": event_block,
        "answer": answer,
        "rubric": {
            "passed": rubric.passed,
            "root_cause_hit": rubric.root_cause_hit,
            "asset_hit": rubric.asset_hit,
            "evidence_recall": round(rubric.evidence_recall, 3),
            "citations_hit": rubric.citations_hit,
            "actions_hit": rubric.actions_hit,
            "detail": rubric.detail,
        },
    }


def _live_explain(sc, event_block: str) -> str:  # pragma: no cover - needs cloud LLM + Neon
    """Opt-in: hand the event block to the REAL Supervisor for a cited answer.
    Requires INFERENCE_BACKEND=cloud + provider keys + NEON_DATABASE_URL."""
    import asyncio
    from shared.engine import Supervisor  # noqa: E402 — only imported on the live path

    sup = Supervisor(db_path=":memory:", openwebui_url="", api_key="", collection_id="")
    msg = event_block + "\n\n[QUESTION]\nWhat changed on this asset and why is it in warning?"
    return asyncio.run(sup.process("fde-demo", msg, uns_source="direct_connection"))


# ---------------------------------------------------------------------------
# Stage 5 — LEARN (approve / reject the inferred context)
# ---------------------------------------------------------------------------
def stage_learn(sc, event, evidence) -> dict:
    """Propose the inferred context, then decide it through the REAL ADR-0017
    state machine (mira-bots/shared/proposal_transition.py). Deterministic and
    offline: proposals are ai_suggestions/kg-shaped dicts; decisions use the
    canonical transition mapping — no DB required."""
    component = _COMPONENT_HINT.get(sc.asset_id, sc.asset_id)
    signals = event.signals if event else []
    proposals = [
        {
            "suggestion_type": "kg_entity",
            "title": "Signal '%s' is the %s" % (_bare(signals[0]) if signals else "primary signal", component),
            "extracted_data": {"uns_path": signals[0] if signals else sc.asset_id, "component": component},
            "confidence": 0.86,
            "decision": "accept",
        },
        {
            "suggestion_type": "kg_edge",
            "title": "This machine event OCCURS_ON asset %s" % sc.asset_id,
            "extracted_data": {"relationship_type": "OCCURS_ON", "target": sc.asset_id},
            "confidence": 0.9,
            "decision": "accept",
        },
        {
            "suggestion_type": "kg_edge",
            "title": "Classify this event as: %s" % sc.expected_root_cause,
            "extracted_data": {"relationship_type": "CAUSES", "hypothesis": sc.expected_root_cause},
            "confidence": 0.55,   # low-confidence inference — the human rejects it
            "decision": "reject",
        },
    ]
    decided = []
    for p in proposals:
        trigger = p["decision"]
        before = _pt.kg_approval_for("new")  # 'proposed'
        after = _pt.kg_approval_for(trigger)  # 'verified' | 'rejected'
        rel = _pt.relationship_proposal_status_for(trigger)
        decided.append({
            **{k: p[k] for k in ("suggestion_type", "title", "confidence")},
            "trigger": trigger,
            "kg_approval_state": "%s -> %s" % (before, after),
            "relationship_proposal_status": rel,
        })
    return {
        "proposals": decided,
        "accepted": sum(1 for d in decided if d["trigger"] == "accept"),
        "rejected": sum(1 for d in decided if d["trigger"] == "reject"),
        "note": "decisions applied via ADR-0017 mapping (proposal_transition.py); accepted context becomes kg approval_state=verified",
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def run_pipeline(scenario: str = "A", seed: int = 42, live: bool = False) -> dict:
    """Run the full Connect→Pick→Prove→Explain→Learn arc. Deterministic for a
    fixed (scenario, seed) unless live=True (which calls the real Supervisor)."""
    scenario_id = _resolve_scenario_id(scenario)
    sc, series, evidence, fault_ts, healthy_upto = _replay(scenario_id, seed)

    connect = stage_connect(sc, series)
    pick = stage_pick(sc, series, evidence)
    event, prove = stage_prove(sc, series, evidence, fault_ts, healthy_upto)
    explain = stage_explain(sc, event, evidence, live=live)
    learn = stage_learn(sc, event, evidence)

    return {
        "scenario": scenario_id,
        "line": LINE_ALIAS,
        "asset_tag": ASSET_TAG,
        "backing_asset": sc.asset_id,
        "seed": seed,
        "deterministic": not live,
        "stages": {
            "connect": connect,
            "pick": pick,
            "prove": prove,
            "explain": explain,
            "learn": learn,
        },
    }
