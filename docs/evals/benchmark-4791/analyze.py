"""Recompute every number in REPORT.md from the raw files in this folder.

    uv run --no-project --python 3.12 --with matplotlib python analyze.py

Reads raw/<set>/*.jsonl (the #4589 harness rows) and raw/batch2/*.json (the staging-data harness), writes
results.json, matrix.csv and charts/*.png. Metrics, per answerable question, on the run-1 rows (runs 2-3 only
check determinism and pool latency):
  topN  - an accepted page is in ranked_pages[:N]          (Wilson 95% CI)
  MRR10 - 1/rank of the first accepted page within 10, else 0
  paired - b = pre-only hits, c = post-only hits, exact two-sided McNemar p
Latency: nearest-rank p50/p95 over all repeats. Nothing here grades answers: answer-stage fields stay null.
"""

from __future__ import annotations

import csv
import glob
import json
import math
import os
from math import comb

HERE = os.path.dirname(os.path.abspath(__file__))
PRE, POST = "b980d42db", "cc0d26c1d"


def wilson(k: int, n: int, z: float = 1.959963984540054) -> list[float]:
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [max(0.0, c - h), min(1.0, c + h)]


def mcnemar(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(comb(n, i) for i in range(0, min(b, c) + 1)) / 2**n
    return min(1.0, 2 * tail)


def nearest_rank(v: list[float], p: int) -> float:
    s = sorted(v)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def rank_of(pages: list, accepted: list) -> int | None:
    for i, p in enumerate(pages[:10]):
        if p in accepted:
            return i + 1
    return None


def harness_set(name: str, k: int) -> dict:
    rows = {}
    for rev in (PRE, POST):
        rows[rev] = {
            r["id"]: r
            for r in map(json.loads, open(f"{HERE}/raw/{name}/{name}-{rev}-k{k}-r1.jsonl"))
        }
        lat = [
            r["latency_ms"]
            for f in glob.glob(f"{HERE}/raw/{name}/{name}-{rev}-k{k}-r*.jsonl")
            for r in map(json.loads, open(f))
        ]
        rows[rev + "_lat"] = lat
        reps = [
            {r["id"]: r["ranked_pages"] for r in map(json.loads, open(f))}
            for f in sorted(glob.glob(f"{HERE}/raw/{name}/{name}-{rev}-k{k}-r*.jsonl"))
        ]
        rows[rev + "_det"] = all(rep == reps[0] for rep in reps)
    qs = {
        i: {
            "accepted": rows[PRE][i]["accepted"],
            "kind": rows[PRE][i]["kind"],
            PRE: rows[PRE][i]["ranked_pages"],
            POST: rows[POST][i]["ranked_pages"],
        }
        for i in rows[PRE]
    }
    return {
        "questions": qs,
        "lat": {PRE: rows[PRE + "_lat"], POST: rows[POST + "_lat"]},
        "deterministic": {PRE: rows[PRE + "_det"], POST: rows[POST + "_det"]},
    }


def batch2_set() -> dict:
    cases = {c["id"]: c for c in json.load(open(f"{HERE}/batch2-cases.json"))["cases"]}
    out: dict = {"questions": {}, "lat": {}, "deterministic": {}}
    for rev in (PRE, POST):
        runs = [
            {r["id"]: r for r in json.load(open(f))["results"]}
            for f in sorted(glob.glob(f"{HERE}/raw/batch2/batch2-{rev}-r*.json"))
        ]
        out["lat"][rev] = [r["ms"] for run in runs for r in run.values()]
        out["deterministic"][rev] = all(
            {i: r["pages"] for i, r in run.items()} == {i: r["pages"] for i, r in runs[0].items()}
            for run in runs
        )
        for i, r in runs[0].items():
            q = out["questions"].setdefault(
                i,
                {
                    "accepted": cases[i]["expectedPages"] or [],
                    "kind": "answerable" if cases[i]["expectedPages"] else "field_only",
                },
            )
            q[rev] = r["pages"]
    return out


def metrics(s: dict) -> dict:
    ans = {i: q for i, q in s["questions"].items() if q["kind"] == "answerable"}
    m: dict = {
        "n_answerable": len(ans),
        "n_total": len(s["questions"]),
        "deterministic": s["deterministic"],
    }
    for rev in (PRE, POST):
        r = {}
        for n in (1, 3, 5, 6):
            k = sum(1 for q in ans.values() if (rank_of(q[rev], q["accepted"]) or 99) <= n)
            r[f"top{n}"] = {"num": k, "den": len(ans), "ci95": wilson(k, len(ans))}
        r["mrr10"] = sum(
            1 / (rank_of(q[rev], q["accepted"]) or math.inf) for q in ans.values()
        ) / max(1, len(ans))
        r["nothing_retrieved"] = sum(1 for q in s["questions"].values() if not q[rev])
        r["latency_p50_ms"] = nearest_rank(s["lat"][rev], 50)
        r["latency_p95_ms"] = nearest_rank(s["lat"][rev], 95)
        r["latency_n"] = len(s["lat"][rev])
        m[rev] = r
    for n in (1, 5):
        hit = lambda q, rev: (rank_of(q[rev], q["accepted"]) or 99) <= n  # noqa: E731
        b = sum(1 for q in ans.values() if hit(q, PRE) and not hit(q, POST))
        c = sum(1 for q in ans.values() if hit(q, POST) and not hit(q, PRE))
        m[f"paired_top{n}"] = {
            "b_pre_only": b,
            "c_post_only": c,
            "delta_pp": 100 * (c - b) / max(1, len(ans)),
            "mcnemar_p": mcnemar(b, c),
        }
    return m


def main() -> None:
    sets = {
        "t4-77 (k10)": harness_set("t4-77", 10),
        "t4-77 (k6, production call)": harness_set("t4-77", 6),
        "batch2 (staging data, prod flags)": batch2_set(),
    }
    if glob.glob(f"{HERE}/raw/forum-new/forum-new-{PRE}-k6-r1.jsonl"):
        sets["forum-new (k6, production call)"] = harness_set("forum-new", 6)
        sets["forum-new (k10)"] = harness_set("forum-new", 10)
    results = {name: metrics(s) for name, s in sets.items()}
    json.dump(results, open(f"{HERE}/results.json", "w"), indent=1)
    with open(f"{HERE}/matrix.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "set",
                "id",
                "kind",
                "accepted",
                "pre_rank",
                "post_rank",
                "change",
                "pre_top6",
                "post_top6",
            ]
        )
        for name, s in sets.items():
            if "k10" in name:
                continue
            for i, q in s["questions"].items():
                a, b = rank_of(q[PRE], q["accepted"]), rank_of(q[POST], q["accepted"])
                if q["kind"] != "answerable":
                    change = "n/a (no frozen page)"
                elif (a or 99) == (b or 99):
                    change = "same"
                elif (b or 99) < (a or 99):
                    change = "improved"
                else:
                    change = "regressed"
                w.writerow(
                    [name, i, q["kind"], q["accepted"], a, b, change, q[PRE][:6], q[POST][:6]]
                )
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib missing: charts skipped")
        return
    os.makedirs(f"{HERE}/charts", exist_ok=True)
    for name, m in results.items():
        if "k10" in name:
            continue
        fig, ax = plt.subplots(figsize=(6.4, 3.6))
        labels = ["top1", "top3", "top5", "top6"]
        x = range(len(labels))
        for off, rev, col in ((-0.2, PRE, "#9aa4b1"), (0.2, POST, "#2f6fdf")):
            vals = [m[rev][lab]["num"] / max(1, m[rev][lab]["den"]) for lab in labels]
            err = [
                [v - m[rev][lab]["ci95"][0] for v, lab in zip(vals, labels)],
                [m[rev][lab]["ci95"][1] - v for v, lab in zip(vals, labels)],
            ]
            ax.bar(
                [i + off for i in x],
                vals,
                0.4,
                yerr=err,
                capsize=3,
                color=col,
                label=f"{'pre-fix' if rev == PRE else 'cc0d26c1d'} ({rev})",
            )
            for i, lab in zip(x, labels):
                ax.text(
                    i + off,
                    0.02,
                    f"{m[rev][lab]['num']}/{m[rev][lab]['den']}",
                    ha="center",
                    fontsize=7,
                    color="white",
                )
        ax.set_xticks(list(x), labels)
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("share of answerable questions")
        ax.set_title(f"Correct page retrieved — {name}", fontsize=9)
        ax.legend(fontsize=7, loc="upper left")
        fig.tight_layout()
        fig.savefig(f"{HERE}/charts/{name.split(' ')[0]}-topn.png", dpi=150)
        plt.close(fig)
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    names = [n for n in results if "k10" not in n]
    for off, rev, col in ((-0.2, PRE, "#9aa4b1"), (0.2, POST, "#2f6fdf")):
        ax.bar(
            [i + off for i in range(len(names))],
            [results[n][rev]["latency_p95_ms"] for n in names],
            0.4,
            color=col,
            label=f"p95 {'pre-fix' if rev == PRE else 'cc0d26c1d'}",
        )
        ax.scatter(
            [i + off for i in range(len(names))],
            [results[n][rev]["latency_p50_ms"] for n in names],
            color="black",
            s=12,
            zorder=3,
            label="p50" if rev == POST else None,
        )
    ax.set_xticks(range(len(names)), [n.split(" (")[0] for n in names], fontsize=8)
    ax.set_ylabel("retrieval latency (ms)")
    ax.set_title(
        "Retrieval latency, p95 bars, p50 dots (batch2 includes network to staging Neon)",
        fontsize=8,
    )
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(f"{HERE}/charts/latency.png", dpi=150)
    plt.close(fig)
    print("wrote results.json, matrix.csv, charts/")


if __name__ == "__main__":
    main()
