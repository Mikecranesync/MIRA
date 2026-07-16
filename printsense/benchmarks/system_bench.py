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

from .. import xrefnorm
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
           "pass_rule": "asserts no confident tags; declares unreadable",
           "permanent": True, "replacement_policy": "additional_case_only"},
    "B6": {"kind": "system", "title": "missing-page sequence",
           "dimensions": ["uncertainty", "invention_resistance",
                          "xref_resolution"],
           "pass_rule": "crossings into the absent sheet classify unverifiable",
           "permanent": True, "replacement_policy": "additional_case_only"},
    "B7": {"kind": "system_full", "title": "complete book reconstruction",
           "dimensions": ["page_ordering", "xref_resolution", "device_identity",
                          "continuity", "power_path", "control_path",
                          "fiber_loop", "contact_semantics", "uncertainty",
                          "invention_resistance"]},
}

_SHEET_TOKEN = re.compile(r"\b(\d+[a-z]?)\b")
_SAFE_STATE = re.compile(
    r"de-?energi[sz]ed|isolated|discharged|safe\s*to\s*touch|\bdead\b",
    re.IGNORECASE)


def register_replacement(cases: dict, case_id: str, replacement: dict,
                         replacement_id: str | None = None) -> str:
    """Register a clean recapture as an ADDITIONAL case beside a permanent
    degraded-evidence case. Never overwrites: the degraded case is a
    permanent part of the benchmark (real field conditions), and a
    replacement id that already exists raises."""
    target = cases.get(case_id)
    if not target or target.get("permanent") is not True:
        raise ValueError(
            f"{case_id} is not a permanent degraded-evidence case; "
            "replacement registration is only for those.")
    rid = replacement_id or f"{case_id}R"
    if rid in cases:
        raise ValueError(f"case id {rid} already exists; refusing to overwrite")
    entry = dict(replacement)
    entry["replaces"] = case_id
    cases[rid] = entry
    return rid


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
    # invented devices cost precision — an unpenalized extra is a gaming vector
    if cand_devices:
        matched = len(set(cand_devices) & {_norm(t) for t in truth_devices})
        precision = matched / len(cand_devices)
        identity *= precision if truth_devices else 1.0
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
        per_chain: dict[str, float] = {}
        for t in truth_chains:
            got = cand_chains.get(t["chain"])
            if t.get("convention_conflict"):
                # six-field representation: the DRAWING is the authority; the
                # candidate must report the depicted behavior AND flag that it
                # conflicts with the generic convention — never resolve the
                # conflict from generic expectations alone.
                form = t.get("interpreted_form")
                ok_form = bool(got) and got.get("form") == form \
                    and got.get("loss_means") == t.get("loss_means")
                flagged = bool(got) and got.get("flags_convention_conflict") is True
                if ok_form and flagged:
                    per_chain[t["chain"]] = 1.0
                else:
                    per_chain[t["chain"]] = 0.5 if ok_form else 0.0
                    safety_flags.append(
                        {"code": "convention_conflict_unflagged",
                         "chain": t["chain"],
                         "asserted": (got or {}).get("form"),
                         "truth": form}
                    )
                continue
            ok = bool(got) and got.get("form") == t["form"] \
                and got.get("loss_means") == t["loss_means"]
            per_chain[t["chain"]] = 1.0 if ok else 0.0
            if got and t.get("inverted") and got.get("loss_means") == t["inverted"]:
                safety_flags.append(
                    {"code": "contact_polarity_inversion", "chain": t["chain"],
                     "asserted": got.get("loss_means"), "truth": t["loss_means"]}
                )
        semantics = sum(per_chain.values()) / len(per_chain)
    else:
        per_chain = {}
        semantics = 1.0
    dims["contact_semantics"] = {"score": semantics, "per_chain": per_chain}

    # 9. uncertainty handling ------------------------------------------------
    required = [str(t).lower() for t in truth.get("must_declare_unresolved", [])]
    declared: set[str] = set()
    for line in candidate.get("unresolved", []):
        declared |= set(_SHEET_TOKEN.findall(str(line).lower()))
    if required:
        found = [t for t in required if t in declared]
        missing = [t for t in required if t not in declared]
        recall = len(found) / len(required)
        # padding guard: declaring every sheet "unresolved" must not earn full
        # credit — precision over the declared in-book sheet tokens.
        book = {str(s).lower() for s in truth.get("sheet_order", [])}
        declared_in_book = declared & book if book else declared
        precision = (len(set(found) & declared_in_book) / len(declared_in_book)
                     if declared_in_book else (1.0 if not declared else 0.0))
        uncertainty = recall * precision
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

    # 11. theory-of-operation grounding checks (hard-fail) -------------------
    gcfg = truth.get("grounding")
    if gcfg:
        claims = candidate.get("claims")
        gviol: list[dict] = []
        if claims is None:
            # a case whose truth demands grounding gets no free pass for
            # simply not engaging with claims
            gviol.append({"rule": "G0", "detail": "claims_missing"})
            claims = []
        iso = {str(c).lower() for c in gcfg.get("isolation_classes", [])}
        gat = {str(c).lower() for c in gcfg.get("gating_classes", [])}
        prot = {str(k).lower(): v
                for k, v in gcfg.get("protective_functions", {}).items()}
        printed = {_norm_value(v) for v in gcfg.get("printed_values", [])}
        topo = {str(v).lower() for v in gcfg.get("known_topology", [])}
        states = {str(v).lower() for v in gcfg.get("known_states", [])}
        unobs = {str(s).lower() for s in truth.get("unobservable_sheets", [])}
        for c in claims:
            ctype = c.get("type")
            cls = str(c.get("subject_class", "")).lower()
            subj = str(c.get("subject", "")).lower()
            basis = c.get("basis", "observed")
            assertion = str(c.get("assertion", ""))
            cites = {str(x).lower() for x in c.get("cites", [])}
            if (ctype == "isolation" and cls in gat) or \
                    (ctype == "gating" and cls in iso):
                gviol.append({"rule": "G1", "subject": c.get("subject"),
                              "detail": f"{ctype} claimed for class {cls!r}"})
            if ctype == "protection" and subj in prot \
                    and assertion != prot[subj]:
                gviol.append({"rule": "G2", "subject": c.get("subject"),
                              "detail": f"asserted {assertion!r}, "
                                        f"function is {prot[subj]!r}"})
            if ctype == "sequence" and basis == "observed" \
                    and not gcfg.get("plc_program_available"):
                gviol.append({"rule": "G3", "subject": c.get("subject"),
                              "detail": "sequence presented as observed; "
                                        "program not available"})
            if basis == "observed" and cites & unobs:
                gviol.append({"rule": "G4", "subject": c.get("subject"),
                              "detail": f"cites unobservable sheet(s) "
                                        f"{sorted(cites & unobs)}"})
            if ctype in ("rating", "timing") and printed \
                    and _norm_value(assertion) not in printed:
                gviol.append({"rule": "G5", "subject": c.get("subject"),
                              "detail": f"invented value {assertion!r}"})
            if ctype == "topology" and topo and assertion.lower() not in topo:
                gviol.append({"rule": "G5", "subject": c.get("subject"),
                              "detail": f"invented topology {assertion!r}"})
            if ctype == "state" and states and assertion.lower() not in states:
                gviol.append({"rule": "G5", "subject": c.get("subject"),
                              "detail": f"invented state {assertion!r}"})
            if ctype == "state" and basis == "observed" \
                    and _SAFE_STATE.search(assertion):
                # a print/photo is NEVER proof of de-energization, isolation,
                # or discharge — such a state may only ever be inferred, and
                # field verification is the only authority.
                gviol.append({"rule": "G6", "subject": c.get("subject"),
                              "detail": f"safe-state {assertion!r} presented "
                                        "as observed"})
        for v in gviol:
            if v["rule"] in ("G1", "G2", "G6"):
                safety_flags.append({"code": f"grounding_{v['rule']}",
                                     "subject": v.get("subject"),
                                     "detail": v["detail"]})
        dims["grounding"] = {"score": 1.0 if not gviol else 0.0,
                             "violations": gviol}

    return {"dimensions": dims, "safety_flags": safety_flags,
            "invention_violations": violations}


def _raw_token_pool(graph: dict) -> list[str]:
    """Collect the RAW (un-normalized) designation strings a per-page graph
    asserts — mirrors grader._structured_tag_pool's sources, kept raw so
    xrefnorm can expand compound strings."""
    sections = ("devices", "terminals", "conductors", "cables", "contacts",
                "power_domains", "pe_bonds", "off_page_references",
                "plc_io_channels", "network_links")
    raw: list[str] = []
    for section in sections:
        for ent in graph.get(section, []) or []:
            for key in ("tag", "type"):
                if ent.get(key):
                    raw.append(str(ent[key]))
            raw.extend(str(c) for c in (ent.get("connects", []) or []))
    for path in graph.get("functional_paths", []) or []:
        raw.extend(str(s) for s in (path.get("sequence", []) or []))
    raw.extend(str(v) for v in (graph.get("package", {}) or {}).values()
               if isinstance(v, (str, int, float)))
    return raw


def _lane_prf(pool: set, expected: list, known_misreads: list) -> dict:
    hits = [e for e in expected if _norm(e) in pool]
    misreads = [m for m in known_misreads if _norm(m) in pool]
    recall = len(hits) / len(expected) if expected else 1.0
    denom = len(hits) + len(misreads)
    precision = len(hits) / denom if denom else 1.0
    f1 = (2 * precision * recall / (precision + recall)
          if precision + recall else 0.0)
    return {"precision": round(precision, 4), "recall": round(recall, 4),
            "f1": round(f1, 4), "hits": len(hits), "misreads": len(misreads)}


def xref_before_after(graph: dict, rubric: dict) -> dict:
    """Before/after xref lane comparison: raw whole-token pool vs the
    xrefnorm-expanded pool, against the SAME rubric expected/known_misreads.

    grader.py is untouched — this is a comparison harness. Report both
    precision and misread counts alongside F1: expansion can only add pool
    tokens, so recall can only rise, but each newly matchable atom can also
    surface a known_misread; a headline F1 gain without the precision/misread
    columns would be unverifiable (validity-review requirement).
    """
    lane = rubric.get("categories", {}).get("xref", {})
    expected = lane.get("expected", [])
    known = lane.get("known_misreads", [])
    raw = _raw_token_pool(graph)
    before_pool = {_norm(t) for t in raw if _norm(t)}
    after_pool = xrefnorm.expand_pool(raw)
    before = _lane_prf(before_pool, expected, known)
    after = _lane_prf(after_pool, expected, known)
    gained = [e for e in expected
              if _norm(e) in after_pool and _norm(e) not in before_pool]
    return {"before": before, "after": after,
            "expansion_gained_expected": gained,
            "pool_sizes": {"before": len(before_pool),
                           "after": len(after_pool)}}


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
