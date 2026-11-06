#!/usr/bin/env python3
"""Independent recompute of the #4589 dev receipts. Not the verdict engine (scorecard.py): a separate
minimal implementation, used to cross-check it. Needs scipy and tools/retrieval_eval/stats.py (#4578, on main).

    python3 tools/benchmark-acceptance/independent_recompute.py <receipts-dir>

<receipts-dir> = docs/evals/benchmark-acceptance/receipts-2026-10-21-dev on branch eval/bench-4589-dev-receipts.
"""

from __future__ import annotations

import glob
import json
import math
import sys
from pathlib import Path

from scipy.stats import binomtest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.retrieval_eval.stats import cluster_bootstrap_diff  # noqa: E402


def rows(path: str) -> dict:
    return {r["id"]: r for r in (json.loads(x) for x in open(path) if x.strip())}


def hit(r: dict, k: int) -> bool:
    return any(p in r["accepted"] for p in r["ranked_pages"][:k])


def nearest_rank(vals: list[float], q: float) -> float:
    s = sorted(vals)
    return s[max(0, math.ceil(q * len(s)) - 1)]


def main(d: str) -> None:
    qmap = {q["id"]: q for q in json.load(open(f"{d}/questions-mapping.json"))}
    for k in (10, 6):
        off, on = rows(f"{d}/dev-off-k{k}.jsonl"), rows(f"{d}/dev-on-k{k}.jsonl")
        assert set(off) == set(on) == set(qmap)
        assert all(
            sorted(off[i]["accepted"]) == sorted(qmap[i]["accepted"]) == sorted(on[i]["accepted"])
            for i in off
        )
        for name, kk in (("recall5", 5), ("hit1", 1), ("hit6", 6)):
            b = sum(hit(off[i], kk) and not hit(on[i], kk) for i in off)
            c = sum(hit(on[i], kk) and not hit(off[i], kk) for i in off)
            ci = cluster_bootstrap_diff(
                [(qmap[i]["manual"], int(hit(off[i], kk)), int(hit(on[i], kk))) for i in off]
            )
            print(
                f"k{k} {name}: off {sum(hit(off[i], kk) for i in off)} on {sum(hit(on[i], kk) for i in off)} "
                f"b={b} c={c} p={binomtest(min(b, c), b + c, 0.5).pvalue:.4f} "
                f"cluster95=({100 * ci[0]:.1f}, {100 * ci[1]:.1f}) pp"
            )
        short_off = [i for i in off if len(off[i]["ranked_pages"]) < k]
        short_on = [i for i in on if len(on[i]["ranked_pages"]) < k]
        filler = [i for i in short_off if not (hit(on[i], k) and not hit(off[i], k))]
        print(
            f"k{k} short result sets: off {len(short_off)} on {len(short_on)}; ON-filled without new hit {len(filler)}"
        )
    for f in sorted(glob.glob(f"{d}/latency-rep/rep*-k6.jsonl")):
        lat = [r["latency_ms"] for r in rows(f).values() if r.get("latency_ms") is not None]
        print(
            f"{Path(f).name}: p50 {nearest_rank(lat, 0.5):.0f} p95 {nearest_rank(lat, 0.95):.0f} ms"
        )


if __name__ == "__main__":
    main(sys.argv[1])
