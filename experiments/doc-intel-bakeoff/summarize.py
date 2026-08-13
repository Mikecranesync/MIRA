"""Summarize bake-off results.jsonl into per-adapter and per-class tables.

Usage: py summarize.py out/results.jsonl [--md]
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def main() -> None:
    path = Path(sys.argv[1])
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    md = "--md" in sys.argv

    # Keep only the latest row per (adapter, question, rep) — reruns append.
    latest: dict[tuple, dict] = {}
    for r in rows:
        key = (r["adapter"], r["question_id"], r.get("versions", {}).get("rep", 1))
        latest[key] = r
    rows = list(latest.values())

    adapters = sorted({r["adapter"] for r in rows})
    classes = sorted({r["question_class"] for r in rows})

    def agg(sel) -> dict:
        out: dict = defaultdict(lambda: {"c": 0, "n": 0, "cc": 0, "cn": 0, "err": 0,
                                         "lat": 0.0, "cost": 0.0})
        for r in rows:
            k = sel(r)
            a = out[k]
            a["n"] += 1
            a["c"] += 1 if r.get("correct") else 0
            if r.get("citation_correct") is not None:
                a["cn"] += 1
                a["cc"] += 1 if r["citation_correct"] else 0
            a["err"] += 1 if r.get("error") else 0
            a["lat"] += r.get("latency_s") or 0
            a["cost"] += r.get("cost_usd") or 0
        return out

    by_adapter = agg(lambda r: r["adapter"])
    sep = "|" if md else "  "
    print(f"\n== By adapter ==")
    hdr = ["adapter", "correct", "citation", "errors", "avg_lat_s", "cost_usd"]
    if md:
        print("| " + " | ".join(hdr) + " |")
        print("|" + "---|" * len(hdr))
    for a in adapters:
        v = by_adapter[a]
        line = [a, f"{v['c']}/{v['n']}", f"{v['cc']}/{v['cn']}", str(v["err"]),
                f"{v['lat']/max(v['n'],1):.2f}", f"{v['cost']:.4f}"]
        print(("| " + " | ".join(line) + " |") if md else "  ".join(x.ljust(22) for x in line))

    print(f"\n== By class x adapter (correct/total) ==")
    grid: dict = defaultdict(dict)
    for r in rows:
        cell = grid[r["question_class"]].setdefault(r["adapter"], [0, 0])
        cell[1] += 1
        cell[0] += 1 if r.get("correct") else 0
    short = {a: a[:14] for a in adapters}
    if md:
        print("| class | " + " | ".join(short[a] for a in adapters) + " |")
        print("|" + "---|" * (len(adapters) + 1))
    else:
        print("class".ljust(24) + "".join(short[a].ljust(16) for a in adapters))
    for cls in classes:
        cells = []
        for a in adapters:
            c = grid[cls].get(a)
            cells.append(f"{c[0]}/{c[1]}" if c else "-")
        if md:
            print(f"| {cls} | " + " | ".join(cells) + " |")
        else:
            print(cls.ljust(24) + "".join(x.ljust(16) for x in cells))

    # Repeatability: rows with rep 1 vs 2
    reps = defaultdict(dict)
    for r in rows:
        rep = r.get("versions", {}).get("rep", 1)
        if rep in (1, 2):
            reps[(r["adapter"], r["question_id"])][rep] = r.get("answer_text", "")
    pairs = [(k, v) for k, v in reps.items() if len(v) == 2]
    if pairs:
        print("\n== Repeatability (rep1 == rep2) ==")
        for (adapter, qid), v in pairs:
            print(f"  {adapter} {qid}: identical={v[1] == v[2]}")


if __name__ == "__main__":
    main()
