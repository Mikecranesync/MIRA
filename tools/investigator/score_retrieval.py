#!/usr/bin/env python3
"""
tools/investigator/score_retrieval.py — LANE BENCH-B. Scores retrieval-arm
JSONL rows (B0/B0p/B1.../B4, same shape as baseline/*.jsonl and
tools/investigator/bench/retrieval_dev.ts's / fusion_arms.ts's output: id,
dataset, arm, kind, accepted, regression_case, top_k, ranked_pages,
vector_lane, latency_ms, error) against the pre-registration's retrieval
metric (PREREGISTRATION.md §2: "score = accepted page in first 5 chunks at
k=10; also top-1, top-10").

Stdlib only, $0, no network. Python 3.9 (no `X | None`).

One input FILE = one arm (same convention as the existing
docs/evals/*/score.py scripts this reuses `wilson`/`mcnemar` from — mixing
rows from two arms into one file would triple-count, since this script never
re-groups by the row's own "arm" field, only by which file it came from).

    python3 score_retrieval.py <arm.jsonl> [<arm.jsonl> ...] \\
        [--baseline <baseline.jsonl>] [--questions <dir-of-*-questions.json>] \\
        [--json]

--baseline: another arm's jsonl (same ids) to compute gained/lost ids + a
    McNemar p-value per (dataset, k) — "did this arm hit a page the baseline
    missed, and vice versa."
--questions: a directory holding "<dataset>-questions.json" files (the same
    shape baseline/*-questions.json use: id, set, manual, pdf, question,
    accepted). Only consulted for the dataset literally named "oem-index", to
    drop the "Publication" rows and report its own "oem-index-clean" bucket
    alongside the full one — mirrors the t4-77 et al. score.py scripts' own
    "footer-free subset" handling (docs/evals/2026-10-26-lexical-v2-navigation-demotion/score.py).

Category grouping (`category_of`): PREREGISTRATION §5 scores E1-E7 "per
category: forum / fault / parameter / procedure / scenario-type" but — unlike
the SEALED-C scenario labels E3/E4 use — never gives an explicit per-BENCH-SET
category table for Workstream B. The mapping below is this script's own
documented assumption (forum-fresh*/forum-new -> forum, oem-fault -> fault,
oem-index -> parameter, t4-77/public-50 -> procedure, robust -> robust,
anything else -> other), stated here so a reader can see exactly where it is
guessing rather than reporting the pre-registration's own words.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

Row = Dict[str, Any]

# --- category mapping (this script's own assumption — see module docstring) ---
_CATEGORY_BY_DATASET = {
    "forum-fresh": "forum",
    "forum-fresh2": "forum",
    "forum-fresh3": "forum",
    "forum-new": "forum",
    "sealed-forum": "forum",
    "oem-fault": "fault",
    "oem-index": "parameter",
    "oem-index-clean": "parameter",
    "t4-77": "procedure",
    "public-50": "procedure",
    "robust": "robust",
}


def category_of(dataset: str) -> str:
    return _CATEGORY_BY_DATASET.get(dataset, "other")


# --- stats (wilson/mcnemar reused verbatim from this repo's own
#     docs/evals/2026-10-26-lexical-v2-navigation-demotion/score.py and
#     docs/evals/2026-10-29-t1-forum-ranking/score.py — not reimplemented) ---


def wilson(k: int, n: int, z: float = 1.96) -> Tuple[float, float]:
    """Wilson 95% CI lower/upper bound for k successes out of n."""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def mcnemar(gained: int, lost: int) -> float:
    """Exact two-sided McNemar p-value for a paired gained/lost count."""
    n, k = gained + lost, min(gained, lost)
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2**n)


def percentile(values: Sequence[float], p: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = p / 100 * (len(s) - 1)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return s[lo]
    frac = idx - lo
    return s[lo] + (s[hi] - s[lo]) * frac


# --- IO ---


def load_rows(path: str) -> Dict[str, Row]:
    rows: Dict[str, Row] = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            rows[r["id"]] = r
    return rows


def load_oem_index_publication_ids(questions_dir: str) -> set:
    """Question ids for dataset "oem-index" whose question text contains
    "Publication" (the leaked-footer rows the "clean" subset drops — same
    rule docs/evals/2026-10-26.../score.py applies: `"Publication" not in
    qs[i]["question"]`)."""
    for name in ("oem-index-questions.json", os.path.join("oem-index", "oem-index-questions.json")):
        p = os.path.join(questions_dir, name)
        if os.path.exists(p):
            qs = json.load(open(p))
            return {q["id"] for q in qs if "Publication" in q.get("question", "")}
    return set()


# --- scoring ---


def hit_rank(ranked_pages: Sequence[Any], accepted: Sequence[Any]) -> Optional[int]:
    """1-based rank of the first page in `ranked_pages` that is in `accepted`,
    or None if no accepted page appears anywhere in the list. Duplicates in
    `ranked_pages` (a raw per-chunk B0 list repeats a page once per chunk) are
    NOT collapsed — this mirrors every existing score.py in this repo, which
    scores the list exactly as given, so a page-level (deduped) arm and a
    chunk-level (raw) arm are scored by the identical rule and stay directly
    comparable."""
    acc = set(accepted)
    for i, p in enumerate(ranked_pages):
        if p in acc:
            return i + 1
    return None


def hit_at_k(rank: Optional[int], k: int) -> bool:
    return rank is not None and rank <= k


KS = (1, 5, 10)


def score_rows(
    rows: Dict[str, Row],
    ids: Sequence[str],
    baseline: Optional[Dict[str, Row]] = None,
) -> Dict[str, Any]:
    """Score one arm's rows, restricted to `ids` (answerable rows only — a
    row with no accepted page can't be hit or missed, so it's excluded before
    this function is ever called, same as every existing score.py)."""
    ranks = {}
    errors = []
    latencies = []
    for i in ids:
        r = rows.get(i)
        if r is None:
            errors.append(i)
            continue
        if r.get("error"):
            errors.append(i)
            ranks[i] = None
            continue
        ranks[i] = hit_rank(r.get("ranked_pages") or [], r.get("accepted") or [])
        if isinstance(r.get("latency_ms"), (int, float)):
            latencies.append(r["latency_ms"])

    n = len(ids)
    out: Dict[str, Any] = {
        "n": n,
        "errors": len(errors),
        "error_ids": errors[:20],
        "latency_ms_p50": percentile(latencies, 50),
        "latency_ms_p95": percentile(latencies, 95),
        "top_k": {},
    }
    for k in KS:
        hits = [i for i in ids if hit_at_k(ranks.get(i), k)]
        lo, hi = wilson(len(hits), n)
        entry: Dict[str, Any] = {
            "hits": len(hits),
            "n": n,
            "pct": len(hits) / n if n else 0.0,
            "wilson_lb": lo,
            "wilson_ub": hi,
        }
        if baseline is not None:
            base_ranks = {
                i: hit_rank(
                    (baseline.get(i) or {}).get("ranked_pages") or [],
                    (baseline.get(i) or {}).get("accepted") or [],
                )
                for i in ids
            }
            gained = [
                i for i in ids if hit_at_k(ranks.get(i), k) and not hit_at_k(base_ranks.get(i), k)
            ]
            lost = [
                i for i in ids if not hit_at_k(ranks.get(i), k) and hit_at_k(base_ranks.get(i), k)
            ]
            entry["baseline_hits"] = sum(1 for i in ids if hit_at_k(base_ranks.get(i), k))
            entry["gained"] = len(gained)
            entry["lost"] = len(lost)
            entry["net"] = len(gained) - len(lost)
            entry["mcnemar_p"] = mcnemar(len(gained), len(lost))
            entry["gained_ids"] = gained[:20]
            entry["lost_ids"] = lost[:20]
        out["top_k"][k] = entry
    return out


def score_file(
    path: str, baseline_path: Optional[str], questions_dir: Optional[str]
) -> Dict[str, Any]:
    rows = load_rows(path)
    baseline = load_rows(baseline_path) if baseline_path else None
    publication_ids = load_oem_index_publication_ids(questions_dir) if questions_dir else set()

    # group answerable ids by (dataset, category); build an extra
    # "oem-index-clean" bucket alongside the plain "oem-index" one.
    buckets: Dict[str, List[str]] = {}
    for rid, r in rows.items():
        if r.get("kind") != "answerable" or not r.get("accepted"):
            continue
        dataset = r.get("dataset", "unknown")
        buckets.setdefault(dataset, []).append(rid)
        if dataset == "oem-index" and rid not in publication_ids:
            buckets.setdefault("oem-index-clean", []).append(rid)

    by_set = {ds: score_rows(rows, ids, baseline) for ds, ids in buckets.items()}

    by_category: Dict[str, List[str]] = {}
    for ds, ids in buckets.items():
        if ds == "oem-index-clean":
            continue  # a view on oem-index, not a second dataset — don't double-count in the category roll-up
        by_category.setdefault(category_of(ds), []).extend(ids)
    by_cat_scored = {cat: score_rows(rows, ids, baseline) for cat, ids in by_category.items()}

    return {"file": path, "by_set": by_set, "by_category": by_cat_scored}


def render_text(result: Dict[str, Any]) -> str:
    lines = [f"== {os.path.basename(result['file'])} =="]
    for scope_name, scope in (("by_set", result["by_set"]), ("by_category", result["by_category"])):
        lines.append(f"-- {scope_name} --")
        for name, s in scope.items():
            t5 = s["top_k"][5]
            net = f" net={t5['net']:+d} (p={t5['mcnemar_p']:.3f})" if "net" in t5 else ""
            lines.append(
                f"  {name:20s} n={s['n']:4d}  top1={s['top_k'][1]['hits']:4d}/{s['n']:<4d}  "
                f"top5={t5['hits']:4d}/{s['n']:<4d} ({t5['pct']:.1%}, wilson {t5['wilson_lb']:.1%}-{t5['wilson_ub']:.1%}){net}  "
                f"top10={s['top_k'][10]['hits']:4d}/{s['n']:<4d}  "
                f"lat_p50={s['latency_ms_p50']}  lat_p95={s['latency_ms_p95']}  errors={s['errors']}"
            )
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("files", nargs="+", help="one or more arm .jsonl files (one arm per file)")
    ap.add_argument("--baseline", default=None, help="baseline arm .jsonl for gained/lost/net")
    ap.add_argument(
        "--questions",
        default=None,
        help="dir holding <dataset>-questions.json (for the oem-index clean subset)",
    )
    ap.add_argument(
        "--json", action="store_true", help="print machine-readable JSON instead of the text table"
    )
    args = ap.parse_args()

    results = [score_file(f, args.baseline, args.questions) for f in args.files]
    if args.json:
        print(json.dumps(results, indent=1))
    else:
        for r in results:
            print(render_text(r))
            print()


if __name__ == "__main__":
    main()
