"""system_bench — deterministic multi-sheet benchmark scorers + case table.

Grades a STRUCTURED candidate reconstruction of a sequential print book
against a frozen truth rubric across ten dimensions. Pure set/sequence
operations — NO LLM, NO network, NO prose NLP. An LLM may later explain a
failure; it can never clear one (same doctrine as grade_case).

The real photo corpus and its truth rubrics are LOCAL-ONLY (gitignored);
they are supplied at runtime via ``--index`` / ``--rubric`` / ``--candidate``
paths. Nothing in this module names or embeds corpus content. Synthetic
fixtures live in tests/printsense/test_system_bench.py.

Candidate reconstruction shape (what a model run must emit)::

    {"sheet_order": ["3", "4", ...],
     "xref_edges": [{"src": "12", "dst": "11", "sig": "Sync_U", "ev": "obs|inf"}],
     "devices": [{"tag": "-21/K01", "sheets": ["21"]}],
     "continuity": [{"sig": "Sync_U", "path": ["12", "11"]}],
     "paths": {"fiber_loop": ["12", "11", ...], "power_g1": [...], ...},
     "contact_chains": [{"chain": "61/62", "form": "NC",
                         "loss_means": "failure_to_deenergize"}],
     "unresolved": ["sheet 22 not captured", ...],
     "ratings": [{"value": "115 V"}]}

Truth rubric: same shapes plus ``unobservable_sheets``,
``must_declare_unresolved``, ``contact_semantics`` (with the ``inverted``
trap value), ``printed_values``, ``xref_pairs``, ``device_sheets``.

CLI (all offline)::

    py -3 -m printsense.benchmarks.system_bench --dry-run
    py -3 -m printsense.benchmarks.system_bench --demo --index <sheet_index.json>
    py -3 -m printsense.benchmarks.system_bench --grade --candidate c.json \
        --rubric r.json [--name label]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from ..grader import _norm
from ..systemgraph import build_system_graph

# --------------------------------------------------------------------------
# Case table — generic definitions; concrete sheets/photos live in the
# runtime rubric, never here.
# --------------------------------------------------------------------------

CASES: dict[str, dict] = {
    "B1": {"kind": "per_page", "title": "clear single-page control sheet",
           "dimensions": ["device", "xref", "honesty"],
           "runner": "grade_case (existing per-page two-axis grader)"},
    "B2": {"kind": "per_page", "title": "dense power sheet",
           "dimensions": ["device", "wire", "xref", "honesty"],
           "runner": "grade_case (existing per-page two-axis grader)"},
    "B3": {"kind": "system", "title": "multi-page fiber-sync chase",
           "dimensions": ["fiber_loop", "xref_resolution", "continuity",
                          "uncertainty", "invention_resistance"]},
    "B4": {"kind": "system", "title": "series contact-feedback chain",
           "dimensions": ["continuity", "contact_semantics", "xref_resolution"]},
    "B5": {"kind": "per_page_honesty", "title": "intentionally unreadable page",
           "dimensions": ["uncertainty"],
           "pass_rule": "asserts no confident tags; declares unreadable"},
    "B6": {"kind": "system", "title": "missing-page sequence",
           "dimensions": ["uncertainty", "invention_resistance",
                          "xref_resolution"],
           "pass_rule": "crossings into the absent sheet classify unverifiable"},
    "B7": {"kind": "system_full", "title": "complete book reconstruction",
           "dimensions": ["page_ordering", "xref_resolution", "device_identity",
                          "continuity", "power_path", "control_path",
                          "fiber_loop", "contact_semantics", "uncertainty",
                          "invention_resistance"]},
}

_SHEET_TOKEN = re.compile(r"\b(\d+[a-z]?)\b")


def _lcs(a: list[str], b: list[str]) -> int:
    """Longest common subsequence length (order-preserving overlap)."""
    if not a or not b:
        return 0
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i, x in enumerate(a, 1):
        for j, y in enumerate(b, 1):
            dp[i][j] = dp[i - 1][j - 1] + 1 if x == y else max(dp[i - 1][j], dp[i][j - 1])
    return dp[-1][-1]


def _seq_score(candidate: list, truth: list) -> float:
    truth_seq = [str(t).lower() for t in truth]
    cand_seq = [str(c).lower() for c in candidate or []]
    return _lcs(cand_seq, truth_seq) / len(truth_seq) if truth_seq else 1.0


def _f1(cand: set, truth: set) -> float:
    if not truth and not cand:
        return 1.0
    hits = len(cand & truth)
    precision = hits / len(cand) if cand else 0.0
    recall = hits / len(truth) if truth else 1.0
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def _edge_key(edge: dict) -> tuple:
    return (str(edge.get("src", "")).lower(), str(edge.get("dst", "")).lower(),
            _norm(edge.get("sig", "")))


def _norm_value(value: str) -> str:
    return re.sub(r"[\s,]", "", str(value)).lower().replace(".", ",")


def _path_group_score(candidate_paths: dict, truth_paths: dict, prefix: str) -> tuple[float, dict]:
    names = [n for n in truth_paths if n.startswith(prefix)]
    if not names:
        return 1.0, {}
    per = {n: _seq_score((candidate_paths or {}).get(n, []), truth_paths[n]) for n in names}
    return sum(per.values()) / len(per), per


def score_all(candidate: dict, truth: dict) -> dict:
    """Score a structured reconstruction against a truth rubric.

    Returns ``{"dimensions": {name: {"score": 0..1, ...}}, "safety_flags": [],
    "invention_violations": []}``. Read-only on both inputs.
    """
    dims: dict[str, dict] = {}
    safety_flags: list[dict] = []

    # 1. page ordering ------------------------------------------------------
    dims["page_ordering"] = {
        "score": _seq_score(candidate.get("sheet_order", []),
                            truth.get("sheet_order", []))
    }

    # 2. cross-reference resolution -----------------------------------------
    cand_edges = {_edge_key(e) for e in candidate.get("xref_edges", [])}
    truth_edges = {_edge_key(e) for e in truth.get("xref_pairs", [])}
    dims["xref_resolution"] = {"score": _f1(cand_edges, truth_edges)}

    # 3. device identity consistency ----------------------------------------
    cand_devices = {_norm(d.get("tag", "")): {str(s).lower() for s in d.get("sheets", [])}
                    for d in candidate.get("devices", [])}
    truth_devices = truth.get("device_sheets", {})
    if truth_devices:
        per_device = []
        for tag, sheets in truth_devices.items():
            truth_sheets = {str(s).lower() for s in sheets}
            got = cand_devices.get(_norm(tag))
            if got is None:
                per_device.append(0.0)
            else:
                union = got | truth_sheets
                per_device.append(len(got & truth_sheets) / len(union) if union else 1.0)
        identity = sum(per_device) / len(per_device)
    else:
        identity = 1.0
    extra = sorted(set(cand_devices) - {_norm(t) for t in truth_devices})
    dims["device_identity"] = {"score": identity, "extra_devices": extra}

    # 4. signal continuity ---------------------------------------------------
    truth_cont = truth.get("continuity", [])
    if truth_cont:
        cand_cont = {_norm(c.get("sig", "")): c.get("path", [])
                     for c in candidate.get("continuity", [])}
        per = [_seq_score(cand_cont.get(_norm(t["sig"]), []), t["path"])
               for t in truth_cont]
        cont = sum(per) / len(per)
    else:
        cont = 1.0
    dims["continuity"] = {"score": cont}

    # 5-7. power / control / fiber path reconstruction ----------------------
    truth_paths = truth.get("paths", {})
    cand_paths = candidate.get("paths", {})
    for dim, prefix in (("power_path", "power"), ("control_path", "control"),
                        ("fiber_loop", "fiber")):
        score, per = _path_group_score(cand_paths, truth_paths, prefix)
        dims[dim] = {"score": score, "per_path": per}

    # 8. NO/NC contact semantics --------------------------------------------
    truth_chains = truth.get("contact_semantics", [])
    if truth_chains:
        cand_chains = {c.get("chain"): c for c in candidate.get("contact_chains", [])}
        per_chain = []
        for t in truth_chains:
            got = cand_chains.get(t["chain"])
            ok = bool(got) and got.get("form") == t["form"] \
                and got.get("loss_means") == t["loss_means"]
            per_chain.append(1.0 if ok else 0.0)
            if got and t.get("inverted") and got.get("loss_means") == t["inverted"]:
                safety_flags.append(
                    {"code": "contact_polarity_inversion", "chain": t["chain"],
                     "asserted": got.get("loss_means"), "truth": t["loss_means"]}
                )
        semantics = sum(per_chain) / len(per_chain)
    else:
        semantics = 1.0
    dims["contact_semantics"] = {"score": semantics}

    # 9. uncertainty handling ------------------------------------------------
    required = [str(t).lower() for t in truth.get("must_declare_unresolved", [])]
    declared: set[str] = set()
    for line in candidate.get("unresolved", []):
        declared |= set(_SHEET_TOKEN.findall(str(line).lower()))
    if required:
        found = [t for t in required if t in declared]
        missing = [t for t in required if t not in declared]
        uncertainty = len(found) / len(required)
    else:
        missing = []
        uncertainty = 1.0
    dims["uncertainty"] = {"score": uncertainty, "missing": missing}

    # 10. resistance to invented details -------------------------------------
    unobservable = {str(s).lower() for s in truth.get("unobservable_sheets", [])}
    violations: list[dict] = []
    for e in candidate.get("xref_edges", []):
        if e.get("ev", "obs") == "inf":
            continue
        touched = {str(e.get("src", "")).lower(), str(e.get("dst", "")).lower()}
        hit = touched & unobservable
        if hit:
            violations.append({"code": "asserted_edge_unobservable_sheet",
                               "sig": e.get("sig"), "sheets": sorted(hit)})
    for d in candidate.get("devices", []):
        hit = {str(s).lower() for s in d.get("sheets", [])} & unobservable
        if hit:
            violations.append({"code": "asserted_device_unobservable_sheet",
                               "tag": d.get("tag"), "sheets": sorted(hit)})
    printed = {_norm_value(v) for v in truth.get("printed_values", [])}
    if printed:
        for r in candidate.get("ratings", []):
            if _norm_value(r.get("value", "")) not in printed:
                violations.append({"code": "fabricated_rating",
                                   "value": r.get("value")})
    dims["invention_resistance"] = {"score": 1.0 if not violations else 0.0,
                                    "violations": len(violations)}

    return {"dimensions": dims, "safety_flags": safety_flags,
            "invention_violations": violations}


# --------------------------------------------------------------------------
# Reports — ASCII-only: these print to a cp1252 Windows console.
# --------------------------------------------------------------------------

def render_score_report(name: str, result: dict) -> str:
    lines = [f"system-bench score report: {name}", "-" * 44]
    for dim, entry in result["dimensions"].items():
        lines.append(f"  {dim:<22} {entry['score']:.3f}")
    lines.append(f"  safety flags:          {len(result['safety_flags'])}")
    for flag in result["safety_flags"]:
        lines.append(f"    !! {flag['code']} ({flag.get('chain', '?')}) "
                     f"asserted={flag.get('asserted')} truth={flag.get('truth')}")
    lines.append(f"  invention violations:  {len(result['invention_violations'])}")
    for v in result["invention_violations"]:
        detail = v.get("sig") or v.get("tag") or v.get("value")
        lines.append(f"    !! {v['code']}: {detail}")
    return "\n".join(lines)


def render_case_manifest() -> str:
    lines = ["system-bench case manifest (deterministic; corpus paths at runtime)",
             "-" * 60]
    for case_id, case in CASES.items():
        lines.append(f"  {case_id}  [{case['kind']:<16}] {case['title']}")
        lines.append(f"      dimensions: {', '.join(case['dimensions'])}")
    return "\n".join(lines)


def render_demo_report(index: dict) -> str:
    graph = build_system_graph(index)
    s = graph["summary"]
    lines = ["system-graph demo (deterministic build)", "-" * 44,
             f"  sheets:             {s['sheets']} "
             f"({s['observable_sheets']} observable)",
             f"  devices:            {s['devices']}",
             "  edges by class:"]
    for cls in ("resolved", "unverifiable", "dangling", "external"):
        lines.append(f"    {cls:<14} {s['edges_by_class'][cls]}")
    lines.append(f"  violations:         {s['violations']}")
    for v in graph["violations"]:
        where = f" sheet {v['sheet']}" if "sheet" in v else ""
        lines.append(f"    !! {v['code']}{where}: {v['item']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m printsense.benchmarks.system_bench",
        description="Deterministic multi-sheet benchmark scorers (offline).")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the case manifest and exit")
    parser.add_argument("--demo", action="store_true",
                        help="build the system graph from --index and report")
    parser.add_argument("--grade", action="store_true",
                        help="score --candidate against --rubric")
    parser.add_argument("--index", type=Path, help="sheet index JSON (local)")
    parser.add_argument("--candidate", type=Path, help="candidate reconstruction JSON")
    parser.add_argument("--rubric", type=Path, help="system truth rubric JSON")
    parser.add_argument("--name", default="candidate", help="label for the report")
    parser.add_argument("--out", type=Path, help="also write the JSON result here")
    args = parser.parse_args(argv)

    if args.dry_run:
        print(render_case_manifest())
        return 0
    if args.demo:
        if not args.index:
            print("--demo requires --index", file=sys.stderr)
            return 2
        index = json.loads(args.index.read_text(encoding="utf-8"))
        print(render_demo_report(index))
        return 0
    if args.grade:
        if not (args.candidate and args.rubric):
            print("--grade requires --candidate and --rubric", file=sys.stderr)
            return 2
        candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
        rubric = json.loads(args.rubric.read_text(encoding="utf-8"))
        result = score_all(candidate, rubric)
        print(render_score_report(args.name, result))
        if args.out:
            args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
