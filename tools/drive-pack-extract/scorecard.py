#!/usr/bin/env python3
"""Drive Commander pack reliability scorecard (deterministic).

Scores every LIVE drive pack on coverage, citation integrity, internal-link
consistency, and trust level. It AGGREGATES the per-pack grader outputs
(grading_report.json — cite-integrity, gold recall/precision, residuals) and
ADDS cross-pack deterministic checks the per-pack grader does not do
(citation coverage %, normalized fault<->param link consistency, bench-data
detection, the production-trust ladder). Emits benchmark_report.{json,md}.

No LLM judgment: every metric is a reproducible computation over
pack.json / grading_report.json / gold/<id>/gold.json. Weak scores are shown,
never hidden. beta/manual-cited is kept distinct from bench-proven/production.

Production-reliability ladder (worst -> best):
  candidate            not live, or a hard gate fails
  beta (manual-cited)  graded beta; citations from manuals; NO bench data
  bench-proven         populated live_decode (status_bits+cmd_word+registers)
  production           bench-proven + recorded human approval + all gates pass

Usage:  python tools/drive-pack-extract/scorecard.py [--json-only]
"""
from __future__ import annotations

import glob
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # tools/drive-pack-extract -> repo root
PACKS_DIR = os.path.join(REPO, "mira-bots", "shared", "drive_packs", "packs")
GOLD_DIR = os.path.join(HERE, "gold")
REGISTRY = os.path.join(HERE, "registry", "sources.json")


def _load(path):
    return json.load(io.open(path, encoding="utf-8"))


def fault_num(s: str) -> str:
    """Normalise any fault ref to a bare number ('F007'/'F7'/'7' -> '7')."""
    s = str(s)
    if s and s[0] in "Ff":
        s = s[1:]
    return s.lstrip("0") or ("0" if s == "0" else s)


def schema_ok(pack_id: str) -> tuple[bool, str]:
    try:
        sys.path.insert(0, os.path.join(REPO, "mira-bots", "shared"))
        from drive_packs.loader import load_pack  # type: ignore

        load_pack(pack_id)
        return True, "loads via drive_packs.loader"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {str(e)[:80]}"


def approvals() -> dict:
    try:
        d = _load(REGISTRY)
        return {m.get("pack_id"): m.get("approval") or {} for m in d.get("manuals", [])}
    except Exception:  # noqa: BLE001
        return {}


def score_pack(pack_dir: str, approval: dict) -> dict:
    pack_id = os.path.basename(pack_dir)
    pack = _load(os.path.join(pack_dir, "pack.json"))
    grep_path = os.path.join(pack_dir, "grading_report.json")
    grep = _load(grep_path) if os.path.exists(grep_path) else {}
    gold_path = os.path.join(GOLD_DIR, pack_id, "gold.json")
    gold = _load(gold_path) if os.path.exists(gold_path) else {}

    ld = pack.get("live_decode", {}) or {}
    faults = ld.get("fault_codes", {}) or {}
    params = pack.get("parameters", []) or []
    keypad = pack.get("keypad_navigation", []) or []
    fault_keys = set(faults.keys())

    # ---- deterministic coverage / integrity metrics -------------------------
    cited = [p for p in params if p.get("source_citation")]
    broken = [
        p["parameter_id"]
        for p in cited
        if not p["source_citation"].get("doc") or not str(p["source_citation"].get("page", "")).strip()
    ]
    uncited = [p["parameter_id"] for p in params if not p.get("source_citation")]

    # A related_fault resolves if it matches a fault by NUMBER (pf-style "F007"/"F7"/"7")
    # OR by KEYPAD CODE (gs10-style "CE10"/"GFF"/"oL" — stored as the leading token of the
    # fault name, e.g. fault "58" = "CE10 modbus timeout"). Both are deterministic.
    num_keys = {fault_num(k) for k in fault_keys}
    keypad_codes = {v.split(" ", 1)[0] for v in faults.values() if v.split()}
    rf_total = rf_resolved = 0
    rf_unresolved = []
    for p in params:
        for rf in p.get("related_faults", []) or []:
            rf_total += 1
            if fault_num(rf) in num_keys or rf in keypad_codes:
                rf_resolved += 1
            else:
                rf_unresolved.append(f"{p['parameter_id']}->{rf}")
    rp_total = rp_resolved = 0
    pids = {p["parameter_id"] for p in params}
    for p in params:
        for rp in p.get("related_parameters", []) or []:
            rp_total += 1
            if rp in pids:
                rp_resolved += 1

    status_bits = ld.get("status_bits", {}) or {}
    cmd_word = ld.get("cmd_word", {}) or {}
    registers = ld.get("registers", {}) or {}
    env = pack.get("envelope", {}) or {}
    has_bench = bool(status_bits) and bool(cmd_word) and bool(registers)

    prov_items = (pack.get("provenance", {}) or {}).get("items", {}) or {}
    all_manual_cited = bool(prov_items) and all(v == "manual_cited" for v in prov_items.values())

    # from the grader (if present)
    cite_integrity = grep.get("layers", {}).get("citation") if isinstance(grep.get("layers"), dict) else None
    residuals = grep.get("residuals") or (pack.get("provenance", {}) or {}).get("known_residuals") or []
    grader_trust = grep.get("trust_status")
    fabrication = grep.get("gold_score", {}).get("fabrication_detected") if isinstance(grep.get("gold_score"), dict) else grep.get("fabrication_detected")

    # gold coverage — gold "faults" is a LIST of {code, fault_id, ...} objects
    # (see gold/<id>/gold.json). Deterministic recall of gold fault codes present
    # in the pack's decode table.
    gold_faults_raw = gold.get("faults") or gold.get("fault_codes") or []
    if isinstance(gold_faults_raw, dict):
        gold_fault_ids = {fault_num(k) for k in gold_faults_raw}
    else:
        gold_fault_ids = {
            fault_num(str(f.get("code", f.get("fault_id", ""))))
            for f in gold_faults_raw
            if f.get("code", f.get("fault_id"))
        }
    present_faults = {fault_num(k) for k in fault_keys}
    gold_fault_recall = (
        round(len(gold_fault_ids & present_faults) / len(gold_fault_ids), 3) if gold_fault_ids else None
    )

    param_cite_cov = round(len(cited) / max(1, len(params)), 3)
    link_consistency = round(rf_resolved / rf_total, 3) if rf_total else 1.0

    schema_valid, schema_note = schema_ok(pack_id)

    # ---- gates (deterministic pass/fail) ------------------------------------
    gates = {
        "schema_valid": schema_valid,
        "param_citation_coverage>=0.9": param_cite_cov >= 0.9,
        "no_broken_citations": len(broken) == 0,
        "fault_links_all_resolve": len(rf_unresolved) == 0,
        "no_fabrication": fabrication is not True,
        "graded_at_least_beta": grader_trust in ("beta", "trusted") or has_bench,
    }
    promotable = all(gates.values())

    # ---- trust ladder -------------------------------------------------------
    appr_by = (approval or {}).get("approved_by")
    if not schema_valid:
        trust = "candidate (schema fail)"
    elif has_bench and promotable and appr_by:
        trust = "production"
    elif has_bench:
        trust = "bench-proven"
    elif all_manual_cited and grader_trust == "beta":
        trust = "beta (manual-cited)"
    else:
        trust = "candidate"

    # ---- composite score (transparent, 0-100) -------------------------------
    score = 0.0
    score += 25 * param_cite_cov                          # citation coverage
    score += 15 * (1.0 if len(broken) == 0 else 0.0)      # no broken citations
    score += 15 * link_consistency                        # link consistency
    score += 15 * (gold_fault_recall if gold_fault_recall is not None else 0.6)  # fault coverage vs gold
    score += 10 * min(1.0, len(params) / 20.0)            # parameter depth
    score += 5 * (1.0 if keypad else 0.0)                 # wiring/keypad presence
    score += 15 * (1.0 if has_bench else 0.0)             # bench data bonus
    score -= 2 * len(residuals)                           # residual penalty
    score = max(0.0, min(100.0, round(score, 1)))

    strengths, weaknesses, blockers = [], [], []
    (strengths if param_cite_cov >= 0.99 else weaknesses).append(f"param citation coverage {int(param_cite_cov*100)}%")
    (strengths if len(broken) == 0 else weaknesses).append(f"broken citations: {len(broken)}")
    (strengths if link_consistency >= 0.999 else weaknesses).append(f"fault->param link resolve {int(link_consistency*100)}%")
    if gold_fault_recall is not None:
        (strengths if gold_fault_recall >= 0.9 else weaknesses).append(f"gold fault recall {int(gold_fault_recall*100)}%")
    if has_bench:
        strengths.append("bench live_decode present (status/cmd/registers)")
    else:
        weaknesses.append("no bench live_decode (manual-cited only)")
        blockers.append("no bench/live evidence -> ceiling is beta; cannot reach production")
    if residuals:
        weaknesses.append(f"{len(residuals)} declared residual(s)")
    if not appr_by and has_bench:
        blockers.append("no recorded human approval in registry")
    if trust.startswith("beta"):
        blockers.append("bench proof required to exceed beta (populate live_decode + envelope from hardware)")

    return {
        "pack_id": pack_id,
        "trust_level": trust,
        "score": score,
        "promotable_gates_pass": promotable,
        "metrics": {
            "fault_count": len(faults),
            "param_count": len(params),
            "keypad_nav_count": len(keypad),
            "param_citation_coverage": param_cite_cov,
            "broken_citations": broken,
            "uncited_params": uncited,
            "fault_link_total": rf_total,
            "fault_link_resolved": rf_resolved,
            "fault_link_unresolved": rf_unresolved,
            "param_link_resolved": f"{rp_resolved}/{rp_total}",
            "has_bench_live_decode": has_bench,
            "status_bits": len(status_bits),
            "cmd_word": len(cmd_word),
            "registers": len(registers),
            "envelope_populated": bool(env and any(env.values())),
            "all_manual_cited": all_manual_cited,
            "grader_trust_status": grader_trust,
            "grader_cite_integrity": cite_integrity,
            "fabrication_detected": fabrication,
            "gold_fault_recall": gold_fault_recall,
            "residual_count": len(residuals),
        },
        "gates": gates,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "production_blockers": blockers,
        "schema_note": schema_note,
    }


def build() -> dict:
    appr = approvals()
    packs = sorted(glob.glob(os.path.join(PACKS_DIR, "*")))
    results = [score_pack(p, appr.get(os.path.basename(p), {})) for p in packs if os.path.isfile(os.path.join(p, "pack.json"))]
    return {
        "generated_by": "tools/drive-pack-extract/scorecard.py (deterministic)",
        "pack_count": len(results),
        "trust_ladder": ["candidate", "beta (manual-cited)", "bench-proven", "production"],
        "packs": results,
    }


def to_md(report: dict) -> str:
    lines = [
        "# Drive Commander — Pack Reliability Benchmark",
        "",
        "> Deterministic scorecard (`tools/drive-pack-extract/scorecard.py`). No LLM judgment — every",
        "> number is a reproducible computation over `pack.json` / `grading_report.json` / `gold/`.",
        "> Weak scores are shown, not hidden. **beta/manual-cited is NOT bench-proven.**",
        "",
        "**Trust ladder:** candidate → beta (manual-cited) → bench-proven → production",
        "",
        "| pack | trust | score | faults | params | cite cov | links | bench | gates |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for p in report["packs"]:
        m = p["metrics"]
        gates = f"{sum(p['gates'].values())}/{len(p['gates'])}"
        lines.append(
            f"| `{p['pack_id']}` | {p['trust_level']} | {p['score']} | {m['fault_count']} | "
            f"{m['param_count']} | {int(m['param_citation_coverage']*100)}% | "
            f"{m['fault_link_resolved']}/{m['fault_link_total']} | {'yes' if m['has_bench_live_decode'] else 'no'} | {gates} |"
        )
    lines.append("")
    for p in report["packs"]:
        lines += [
            f"## `{p['pack_id']}` — {p['trust_level']} (score {p['score']})",
            "",
            "**Gates:** " + ", ".join(f"{k} {'✅' if v else '❌'}" for k, v in p["gates"].items()),
            "",
            "**Strengths:** " + ("; ".join(p["strengths"]) or "—"),
            "",
            "**Weaknesses:** " + ("; ".join(p["weaknesses"]) or "—"),
            "",
            "**Blocks production:** " + ("; ".join(p["production_blockers"]) or "nothing — promotable"),
            "",
        ]
    return "\n".join(lines)


if __name__ == "__main__":
    report = build()
    out_json = os.path.join(HERE, "benchmark_report.json")
    io.open(out_json, "w", encoding="utf-8", newline="\n").write(json.dumps(report, indent=2, ensure_ascii=True))
    if "--json-only" not in sys.argv:
        out_md = os.path.join(REPO, "docs", "drive-commander", "pack-reliability-benchmark.md")
        os.makedirs(os.path.dirname(out_md), exist_ok=True)
        io.open(out_md, "w", encoding="utf-8", newline="\n").write(to_md(report))
        print(f"wrote {out_json}")
        print(f"wrote {out_md}")
    for p in report["packs"]:
        print(f"  {p['pack_id']:<16} {p['trust_level']:<22} score={p['score']:<6} gates={sum(p['gates'].values())}/{len(p['gates'])}")

    # CI gate: every LIVE (promoted) pack must pass all reliability gates.
    if "--ci" in sys.argv:
        failed = [
            (p["pack_id"], [k for k, v in p["gates"].items() if not v])
            for p in report["packs"]
            if not p["promotable_gates_pass"]
        ]
        if failed:
            print("\nGATE FAIL -- a live pack regressed:")
            for pid, gates in failed:
                print(f"   {pid}: {', '.join(gates)}")
            sys.exit(1)
        print("\nOK -- all live packs pass reliability gates")
        sys.exit(0)
