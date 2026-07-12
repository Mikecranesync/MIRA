"""
fault_bundle.py — Fault → Difference Bundle join (Fault Intelligence, Phase 2b).
=================================================================================
Given a fault code + a run_pipeline() result, produce a Fault Intelligence Bundle:
the fault's dictionary entry joined to the live difference bundle by the fault's
`referenced_tags`, so a cryptic code is CORROBORATED (or not) by what actually
changed — with baseline-vs-current, the cited manual, suggested checks, and an
honest `missing_evidence` list.

This is the join brick only. It builds no report, Hub UI, DB, adapter, or learning
loop (those are later). Pure/deterministic/offline/read-only — no DB/network/cloud/
LLM/clock. Reuses fault_dictionary.lookup_fault + the existing run_pipeline() JSON.
See docs/discovery/fault_intelligence_from_flight_recorder_plan.md.
"""
from __future__ import annotations

from typing import Any, Optional

from .fault_dictionary import lookup_fault


def _bare(uns: str) -> str:
    return str(uns).split(".")[-1]


def _baseline_vs_current(obs_list: list) -> Optional[dict]:
    """From a tag's observations, summarise normal range vs current if an
    OUT_OF_BASELINE observation is present."""
    oob = next((o for o in obs_list if o.get("kind") == "OUT_OF_BASELINE"), None)
    if not oob:
        return None
    exp = oob.get("expected")
    if not (isinstance(exp, (list, tuple)) and len(exp) == 2):
        return None
    lo, hi, cur = exp[0], exp[1], oob.get("value")
    try:
        status = "below" if cur < lo else ("above" if cur > hi else "in_range")
    except TypeError:
        status = "unknown"
    return {"normal_lo": lo, "normal_hi": hi, "current": cur, "status": status}


def build_fault_bundle(fault_code: str, pipeline_result: dict, docs_dir: str = "simlab/docs") -> dict:
    """Join a fault code to a run_pipeline() result.

    Returns a Fault Intelligence Bundle dict. Fails safe: an unknown code yields
    `fault.found = False` and `corroboration = "fault_not_found"` (never raises).
    """
    asset = pipeline_result.get("backing_asset", "")
    stages = pipeline_result.get("stages", {})
    prove = stages.get("prove", {})
    pick = stages.get("pick", {})
    explain = stages.get("explain", {})

    fault = lookup_fault(fault_code, asset=asset, docs_dir=docs_dir)  # {} if not found
    found = bool(fault)

    # abnormal signals in the bundle, keyed by bare tag name
    obs = prove.get("observations", [])
    abnormal: dict[str, list] = {}
    for o in obs:
        abnormal.setdefault(_bare(o.get("signal", "")), []).append(o)

    # the full approved signal set for this asset (from the Pick stage) — lets us
    # distinguish "present but normal" from "not a signal on this asset".
    approved = {_bare(t["uns_path"]): t["uns_path"] for t in pick.get("approved_tags", [])}

    referenced = fault.get("referenced_tags", []) if found else []
    corroborating, present_normal, absent = [], [], []
    matched = []
    for t in referenced:
        if t in abnormal:
            corroborating.append(t)
            matched.append({
                "tag": t,
                "uns_path": approved.get(t, ""),
                "abnormal": True,
                "baseline_vs_current": _baseline_vs_current(abnormal[t]),
                "observations": [
                    {k: o.get(k) for k in ("kind", "detail", "value", "expected", "magnitude")}
                    for o in abnormal[t]
                ],
            })
        elif t in approved:
            present_normal.append(t)
        else:
            absent.append(t)

    if not found:
        corroboration = "fault_not_found"
    elif corroborating:
        corroboration = "corroborated"          # >=1 referenced tag is abnormal in the event
    elif referenced:
        corroboration = "uncorroborated"        # named, but the live data does not back it
    else:
        corroboration = "no_referenced_tags"

    # event window from the observations' timestamps (deterministic)
    ts = [o["ts"] for o in obs if o.get("ts") is not None]
    event_window = {"start_ts": min(ts) if ts else None, "end_ts": max(ts) if ts else None,
                    "event_signals": prove.get("event_signals", [])}

    cited = list(explain.get("rubric", {}).get("citations_hit", [])) or \
        [d.get("title", "") for d in pick.get("uploaded_docs", [])]
    cited_sources = sorted(set(([fault["source_path"]] if found else []) + cited))

    fault_out: dict[str, Any] = {"code": fault_code, "found": found}
    if found:
        fault_out.update({
            "label": fault["label"], "severity": fault["severity"],
            "meaning": fault["description"], "likely_cause": fault["likely_cause"],
            "recommended_action": fault["recommended_action"],
            "source_doc": fault["source_doc"], "source_path": fault["source_path"],
            "confidence": fault["confidence"],
        })

    return {
        "fault": fault_out,
        "asset": {
            "asset_tag": pipeline_result.get("asset_tag"),
            "backing_asset": asset,
            "line": pipeline_result.get("line"),
        },
        "scenario": pipeline_result.get("scenario"),
        "corroboration": corroboration,
        "corroborating_tags": corroborating,
        "matched_tags": matched,
        "referenced_present_but_normal": present_normal,
        "referenced_absent_from_asset": absent,
        "event_window": event_window,
        "suggested_checks": fault.get("recommended_action", "") if found else "",
        "cited_sources": cited_sources,
        "missing_evidence": fault.get("missing_evidence", []) if found else [],
        "review_state": "pending",   # accept / reject / escalate happens in the Learn stage (ADR-0017)
    }


def build_fault_bundle_for_scenario(fault_code: str, scenario: str = "A", seed: int = 42) -> dict:
    """Convenience: run the deterministic pipeline for `scenario`, then join `fault_code`."""
    from .pipeline import run_pipeline
    return build_fault_bundle(fault_code, run_pipeline(scenario, seed=seed))


def _main(argv=None) -> int:
    import argparse
    import json
    ap = argparse.ArgumentParser(description="Fault -> Difference Bundle join (deterministic, offline)")
    ap.add_argument("--code", default="F007")
    ap.add_argument("--scenario", default="A")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args(argv)
    print(json.dumps(build_fault_bundle_for_scenario(args.code, args.scenario, args.seed), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
