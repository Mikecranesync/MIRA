"""Recompute every number in REPORT.md and dashboard.html from the raw files in this folder.

    uv run --no-project --python 3.12 --with matplotlib python analyze.py

Inputs: raw/<set>/<set>-<arm>-k<K>-r<R>.jsonl (#4589 harness rows; the bm25 arm has only k10-r1),
raw/batch2/batch2-<rev>-r<R>.json (staging-data harness), raw/safety-gate/safety-gate-<rev>.jsonl.
Outputs: results.json (all metrics and the pre-registered verdicts), matrix.csv, charts/*.png.

Retrieval metrics, per answerable question, on run 1 (runs 2-3 only check determinism and pool latency):
  topN       - an accepted page is in ranked_pages[:N]                       (Wilson 95% CI)
  mrr10      - 1/rank of the first accepted page within 10, else 0
  ndcg10     - single-relevance nDCG@10 = 1/log2(rank+1) of the first accepted page. "accepted" lists pages
               that EACH answer the question, so one hit is a full answer and IDCG = 1.
  wrong_page - top-6 is non-empty but holds no accepted page
  boot95     - 95% percentile interval from a bootstrap that resamples MANUALS (2,000 draws, seed 4791)
Paired pre->post: b = hits lost, c = hits gained, exact two-sided McNemar.
Unanswerable rows: share with a non-empty pool. An empty pool is the route's deterministic insufficient_evidence;
a non-empty pool goes to the model, which this benchmark does not run.
"""

from __future__ import annotations

import csv
import glob
import json
import math
import os
import random
from math import comb

HERE = os.path.dirname(os.path.abspath(__file__))
PRE, PARENT, POST = "b980d42db", "e28bb182d", "cc0d26c1d"
ARMS = {"pre": PRE, "parent": PARENT, "post": POST, "post-lexv2": f"{POST}-lexv2", "bm25": "bm25"}
SEED, DRAWS = 4791, 2000


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
    return min(1.0, 2 * sum(comb(n, i) for i in range(min(b, c) + 1)) / 2**n)


def nearest_rank(v: list[float], p: int) -> float | None:
    s = sorted(x for x in v if x is not None)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)] if s else None


def rank_of(pages: list, accepted: list) -> int | None:
    for i, p in enumerate(pages[:10]):
        if p in accepted:
            return i + 1
    return None


def hit(q: dict, arm: str, n: int) -> bool:
    return (rank_of(q["arms"][arm], q["accepted"]) or 99) <= n


def load_jsonl(path: str) -> list[dict]:
    return [json.loads(line) for line in open(path) if line.strip()]


class InvalidRun(ValueError):
    """A raw run that does not match its frozen question set. Scoring stops: no metrics, no verdicts (#4799)."""


def validate_rows(
    rows: list[dict], frozen: dict, where: str, labels: str = "accepted", err: str = "error"
) -> None:
    """Every frozen id exactly once, the frozen labels unchanged, and no harness error, or InvalidRun."""
    ids = [r["id"] for r in rows]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    missing, extra = sorted(set(frozen) - set(ids)), sorted(set(ids) - set(frozen))
    problems = []
    if dup:
        problems.append(f"duplicate ids {dup}")
    if missing:
        problems.append(f"missing ids {missing}")
    if extra:
        problems.append(f"unknown ids {extra}")
    for r in rows:
        if r["id"] in frozen and (r.get(labels) or []) != (frozen[r["id"]] or []):
            problems.append(f"{r['id']}: label {r.get(labels)} != frozen {frozen[r['id']]}")
        if r.get(err) is not None:
            problems.append(f"{r['id']}: harness error {str(r[err])[:80]}")
    if problems:
        raise InvalidRun(f"{where}: " + "; ".join(problems[:8]))


def harness_set(name: str, k: int) -> dict:
    """One question dict per id: accepted pages, kind, manual (the bootstrap cluster) and per-arm ranking."""
    qs: dict = {}
    lat: dict = {}
    det: dict = {}
    frozen_qs = json.load(
        open(
            next(
                p
                for p in (
                    f"{HERE}/{name}-questions.json",
                    f"{HERE}/{name}/{name}-questions.json",
                )
                if os.path.exists(p)
            )
        )
    )
    manual_of = {q["id"]: q["manual"] for q in frozen_qs}
    frozen = {q["id"]: q["accepted"] for q in frozen_qs}
    for arm, tag in ARMS.items():
        kk = 10 if arm == "bm25" else k
        files = sorted(glob.glob(f"{HERE}/raw/{name}/{name}-{tag}-k{kk}-r*.jsonl"))
        if not files:
            continue
        reps = [load_jsonl(f) for f in files]
        for f, rep in zip(files, reps):
            validate_rows(rep, frozen, os.path.relpath(f, HERE))
        for r in reps[0]:
            q = qs.setdefault(
                r["id"],
                {
                    "accepted": r["accepted"],
                    "kind": r["kind"],
                    "cluster": manual_of[r["id"]],
                    "arms": {},
                },
            )
            q["arms"][arm] = r["ranked_pages"][:k]
        lat[arm] = None if arm == "bm25" else [r["latency_ms"] for rep in reps for r in rep]
        det[arm] = all(
            [r["ranked_pages"] for r in rep] == [r["ranked_pages"] for r in reps[0]] for rep in reps
        )
    return {"questions": qs, "lat": lat, "deterministic": det}


def batch2_set() -> dict:
    cases = {c["id"]: c for c in json.load(open(f"{HERE}/batch2-cases.json"))["cases"]}
    out: dict = {"questions": {}, "lat": {}, "deterministic": {}}
    for arm in ("pre", "post"):
        rev = ARMS[arm]
        files = sorted(glob.glob(f"{HERE}/raw/batch2/batch2-{rev}-r*.json"))
        if not files:
            raise InvalidRun(f"batch2: no runs for {rev}")
        runs = []
        for f in files:
            rows = json.load(open(f))["results"]
            validate_rows(
                rows,
                {i: c["expectedPages"] for i, c in cases.items()},
                os.path.relpath(f, HERE),
                labels="expectedPages",
                err="error",
            )
            runs.append({r["id"]: r for r in rows})
        out["lat"][arm] = [r["ms"] for run in runs for r in run.values()]
        out["deterministic"][arm] = all(
            {i: r["pages"] for i, r in run.items()} == {i: r["pages"] for i, r in runs[0].items()}
            for run in runs
        )
        for i, r in runs[0].items():
            q = out["questions"].setdefault(
                i,
                {
                    "accepted": cases[i]["expectedPages"] or [],
                    "kind": "answerable" if cases[i]["expectedPages"] else "field_only",
                    "cluster": cases[i]["notebookKey"],
                    "arms": {},
                },
            )
            q["arms"][arm] = r["pages"]
    return out


def boot_ci(ans: dict, stat) -> list[float]:
    """Cluster bootstrap over manuals: resample clusters with replacement, recompute stat on their questions."""
    clusters: dict = {}
    for q in ans.values():
        clusters.setdefault(q["cluster"], []).append(q)
    keys = sorted(clusters)
    rng = random.Random(SEED)
    vals = []
    for _ in range(DRAWS):
        sample = [q for key in (rng.choice(keys) for _ in keys) for q in clusters[key]]
        vals.append(stat(sample))
    vals.sort()
    return [vals[int(0.025 * DRAWS)], vals[int(0.975 * DRAWS) - 1]]


def arm_metrics(s: dict, arm: str) -> dict:
    ans = {i: q for i, q in s["questions"].items() if q["kind"] == "answerable"}
    n = len(ans)
    r: dict = {}
    for t in (1, 3, 5, 6):
        k = sum(hit(q, arm, t) for q in ans.values())
        r[f"top{t}"] = {"num": k, "den": n, "ci95": wilson(k, n)}
    r["top5"]["boot95_by_manual"] = boot_ci(
        ans, lambda qs: sum(hit(q, arm, 5) for q in qs) / max(1, len(qs))
    )
    ranks = [rank_of(q["arms"][arm], q["accepted"]) for q in ans.values()]
    r["mrr10"] = sum(1 / x for x in ranks if x) / max(1, n)
    r["ndcg10"] = sum(1 / math.log2(x + 1) for x in ranks if x) / max(1, n)
    r["wrong_page6"] = {
        "num": sum(
            1 for q, x in zip(ans.values(), ranks) if q["arms"][arm][:6] and not (x and x <= 6)
        ),
        "den": n,
    }
    r["nothing_retrieved"] = {
        "num": sum(1 for q in s["questions"].values() if not q["arms"][arm]),
        "den": len(s["questions"]),
    }
    r["distinct_pages_top6_mean"] = sum(len(set(q["arms"][arm][:6])) for q in ans.values()) / max(
        1, n
    )
    un = [q for q in s["questions"].values() if q["kind"] == "unanswerable"]
    if un:
        r["unanswerable_nonempty_pool"] = {
            "num": sum(1 for q in un if q["arms"][arm]),
            "den": len(un),
        }
    lat = s["lat"].get(arm)
    r["latency_p50_ms"], r["latency_p95_ms"] = (
        (nearest_rank(lat, 50), nearest_rank(lat, 95)) if lat else (None, None)
    )
    r["latency_n"] = len(lat) if lat else 0
    return r


def paired(s: dict, a: str, b_arm: str) -> dict:
    ans = {i: q for i, q in s["questions"].items() if q["kind"] == "answerable"}
    out: dict = {}
    for t in (1, 5):
        b = sum(1 for q in ans.values() if hit(q, a, t) and not hit(q, b_arm, t))
        c = sum(1 for q in ans.values() if hit(q, b_arm, t) and not hit(q, a, t))
        out[f"top{t}"] = {
            "b_lost": b,
            "c_gained": c,
            "delta_pp": 100 * (c - b) / max(1, len(ans)),
            "mcnemar_p": mcnemar(b, c),
        }
    out["top5"]["boot95_delta_by_manual"] = boot_ci(
        ans, lambda qs: sum(hit(q, b_arm, 5) - hit(q, a, 5) for q in qs) / max(1, len(qs))
    )
    return out


def safety_gate() -> dict:
    cases = {c["id"]: c for c in json.load(open(f"{HERE}/safety/safety-gate-cases.json"))}
    out: dict = {"n_cases": len(cases), "by_rev": {}, "changed_pre_post": []}
    rows = {
        rev: {r["id"]: r for r in load_jsonl(f"{HERE}/raw/safety-gate/safety-gate-{rev}.jsonl")}
        for rev in (PRE, PARENT, POST)
    }
    for rev, rs in rows.items():
        prot = [i for i, c in cases.items() if c["expected_gate"] == "protect"]
        none = [i for i, c in cases.items() if c["expected_gate"] == "none"]
        out["by_rev"][rev] = {
            "protect_expected": len(prot),
            "protected": sum(rs[i]["gate"] != "none" for i in prot),
            "stopped": sum(rs[i]["gate"] == "stop" for i in prot),
            "missed": [i for i in prot if rs[i]["gate"] == "none"],
            "none_expected": len(none),
            "over_triggered": [i for i in none if rs[i]["gate"] != "none"],
            "answer_level_not_run": [
                i for i, c in cases.items() if c["expected_gate"] == "answer_level"
            ],
        }
    out["changed_pre_post"] = [i for i in cases if rows[PRE][i]["gate"] != rows[POST][i]["gate"]]
    out["rows"] = {i: {"expected": cases[i]["expected_gate"], "post": rows[POST][i]} for i in cases}
    return out


def verdicts(results: dict, sg: dict) -> dict:
    """The decision rules in PREREGISTRATION.md, applied mechanically."""
    trig = [
        name
        for name, m in results.items()
        if "paired_pre_post" in m
        and m["paired_pre_post"]["top5"]["b_lost"] - m["paired_pre_post"]["top5"]["c_gained"] >= 2
    ]
    fn = results.get("forum-new (k6, production call)")
    b2 = results["batch2 (staging data, prod flags)"]
    notes = []
    if trig or sg["changed_pre_post"]:
        ret = "NO-GO"
        notes.append(f"regression trigger in {trig or 'safety-gate'}")
    elif not fn or fn["n_answerable"] < 20:
        ret = "INCONCLUSIVE"
        notes.append(f"forum-new answerable n = {fn['n_answerable'] if fn else 0} < 20")
    else:
        pf, pb = fn["paired_pre_post"]["top5"], b2["paired_pre_post"]["top5"]
        b, c = pf["b_lost"] + pb["b_lost"], pf["c_gained"] + pb["c_gained"]
        p = mcnemar(b, c)
        notes.append(
            f"pooled fresh evidence: b={b}, c={c}, McNemar p={p:.4f}; forum-new c-b={pf['c_gained'] - pf['b_lost']}"
        )
        ret = "GO" if pf["c_gained"] - pf["b_lost"] >= 0 and c > b and p < 0.05 else "INCONCLUSIVE"
    fit = None
    if fn:
        lo = fn[POST]["top5"]["ci95"][0]
        fit = {"forum_new_top5_wilson_low": lo, "bar": 0.70, "met": lo >= 0.70}
    post = sg["by_rev"][POST]
    if post["missed"] or sg["changed_pre_post"]:
        safety = "NO-GO"
        why = f"gate missed {len(post['missed'])}/{post['protect_expected']} protect-expected cases: {post['missed']}; changed pre->post: {sg['changed_pre_post']}"
    else:
        safety = "INCONCLUSIVE"
        why = "gate correct on every protect-expected case; answer-level safety NOT TESTED"
    return {
        "retrieval_improvement": {"verdict": ret, "notes": notes},
        "retrieval_fit_for_production": fit,
        "answer_quality": {
            "verdict": "INCONCLUSIVE",
            "notes": ["NOT TESTED: no MIRA answers generated (metered spend forbidden)"],
        },
        "safety": {
            "verdict": safety,
            "notes": [why, "answer-level safety (sg-29..32 and batch2 reset/ack cases) NOT TESTED"],
        },
    }


def main() -> None:
    sets = {
        "t4-77 (k6, production call)": harness_set("t4-77", 6),
        "t4-77 (k10)": harness_set("t4-77", 10),
        "batch2 (staging data, prod flags)": batch2_set(),
    }
    if glob.glob(f"{HERE}/raw/forum-new/forum-new-{PRE}-k6-r1.jsonl"):
        sets["forum-new (k6, production call)"] = harness_set("forum-new", 6)
        sets["forum-new (k10)"] = harness_set("forum-new", 10)
        agreed = f"{HERE}/forum-new/label-agreement.json"
        if os.path.exists(
            agreed
        ):  # pre-registered sensitivity: rows the blinded labeler agrees with
            keep = set(json.load(open(agreed))["agreed_ids"])
            base = sets["forum-new (k6, production call)"]
            sets["forum-new AI-AI-agreed subset (k6)"] = {
                **base,
                "questions": {i: q for i, q in base["questions"].items() if i in keep},
            }
    results: dict = {}
    for name, s in sets.items():
        arms = [a for a in ARMS if all(a in q["arms"] for q in s["questions"].values())]
        m: dict = {
            "n_answerable": sum(q["kind"] == "answerable" for q in s["questions"].values()),
            "n_total": len(s["questions"]),
            "n_clusters": len({q["cluster"] for q in s["questions"].values()}),
            "arms": arms,
            "deterministic": s["deterministic"],
        }
        for a in arms:
            m[ARMS[a] if a in ("pre", "parent", "post") else a] = arm_metrics(s, a)
        m["paired_pre_post"] = paired(s, "pre", "post")
        for other in ("post-lexv2", "bm25"):
            if other in arms:
                m[f"paired_post_vs_{other}"] = paired(s, "post", other)
        results[name] = m
    sg = safety_gate()
    out = {"retrieval": results, "safety_gate": sg, "verdicts": verdicts(results, sg)}
    json.dump(out, open(f"{HERE}/results.json", "w"), indent=1)
    write_matrix(sets)
    charts(results, sg)
    print(json.dumps(out["verdicts"], indent=1))


def write_matrix(sets: dict) -> None:
    with open(f"{HERE}/matrix.csv", "w", newline="") as f:
        w = csv.writer(f)
        cols = list(ARMS)
        w.writerow(
            [
                "set",
                "id",
                "kind",
                "cluster",
                "accepted",
                *[f"{a}_rank" for a in cols],
                "pre_to_post",
                *[f"{a}_top6" for a in cols],
            ]
        )
        for name, s in sets.items():
            if "k10" in name:
                continue
            for i, q in s["questions"].items():
                rk = {
                    a: rank_of(q["arms"][a], q["accepted"]) if a in q["arms"] else "" for a in cols
                }
                a_, b_ = rk["pre"] or 99, rk["post"] or 99
                change = (
                    "n/a"
                    if q["kind"] != "answerable"
                    else "same"
                    if a_ == b_
                    else "improved"
                    if b_ < a_
                    else "regressed"
                )
                w.writerow(
                    [
                        name,
                        i,
                        q["kind"],
                        q["cluster"],
                        q["accepted"],
                        *[rk[a] for a in cols],
                        change,
                        *[q["arms"].get(a, "")[:6] for a in cols],
                    ]
                )


def chart_slug(name: str) -> str:
    base = name.split(" ")[0]
    return base + ("-agreed" if "agreed" in name else "")


def charts(results: dict, sg: dict) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib missing: charts skipped")
        return
    os.makedirs(f"{HERE}/charts", exist_ok=True)
    colors = {
        "pre": "#9aa4b1",
        "parent": "#c4cad3",
        "post": "#2f6fdf",
        "post-lexv2": "#7d5bd6",
        "bm25": "#d08a2e",
    }
    label = {
        "pre": f"pre-fix {PRE}",
        "parent": f"parent {PARENT}",
        "post": f"candidate {POST}",
        "post-lexv2": "candidate + lexical-v2 ON",
        "bm25": "BM25 whole pages (outside baseline)",
    }
    for name, m in results.items():
        if "k10" in name:
            continue
        arms = m["arms"]
        fig, ax = plt.subplots(figsize=(7.2, 3.8))
        labs = ["top1", "top3", "top5", "top6"]
        wdt = 0.8 / len(arms)
        for j, a in enumerate(arms):
            mm = m[ARMS[a] if a in ("pre", "parent", "post") else a]
            vals = [mm[x]["num"] / max(1, mm[x]["den"]) for x in labs]
            err = [
                [v - mm[x]["ci95"][0] for v, x in zip(vals, labs)],
                [mm[x]["ci95"][1] - v for v, x in zip(vals, labs)],
            ]
            xs = [i - 0.4 + wdt * (j + 0.5) for i in range(len(labs))]
            ax.bar(xs, vals, wdt, yerr=err, capsize=2, color=colors[a], label=label[a])
            for xx, x in zip(xs, labs):
                ax.text(xx, 0.02, f"{mm[x]['num']}", ha="center", fontsize=6, color="white")
        ax.set_xticks(range(len(labs)), labs)
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("share of answerable questions")
        ax.set_title(
            f"Correct page retrieved — {name}, n = {m['n_answerable']} answerable, {m['n_clusters']} manuals. Measured; bars = Wilson 95% CI",
            fontsize=7,
        )
        ax.legend(fontsize=6, loc="upper left")
        fig.tight_layout()
        fig.savefig(f"{HERE}/charts/{chart_slug(name)}-topn.png", dpi=150)
        plt.close(fig)
    # paired delta forest plot (post - pre, top5) with cluster bootstrap CI
    names = [n for n in results if "k10" not in n]
    fig, ax = plt.subplots(figsize=(6.4, 0.6 + 0.5 * len(names)))
    for y, n in enumerate(names):
        p = results[n]["paired_pre_post"]["top5"]
        lo, hi = p["boot95_delta_by_manual"]
        d = p["delta_pp"] / 100
        ax.errorbar([d], [y], xerr=[[d - lo], [hi - d]], fmt="o", color="#2f6fdf", capsize=3)
        ax.text(
            hi + 0.01,
            y,
            f"gained {p['c_gained']}, lost {p['b_lost']} of {results[n]['n_answerable']} (McNemar p={p['mcnemar_p']:.3f})",
            fontsize=6,
            va="center",
        )
    ax.axvline(0, color="#888", lw=0.8)
    ax.set_yticks(range(len(names)), [n.split(" (")[0] for n in names], fontsize=7)
    ax.set_xlim(-0.3, 0.9)
    ax.set_xlabel(
        "change in top-5 hit rate, candidate minus pre-fix (95% bootstrap over manuals)", fontsize=7
    )
    ax.set_title("Paired change from #4791, measured", fontsize=8)
    fig.tight_layout()
    fig.savefig(f"{HERE}/charts/paired-delta.png", dpi=150)
    plt.close(fig)
    # latency
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for off, arm in ((-0.2, "pre"), (0.2, "post")):
        ax.bar(
            [i + off for i in range(len(names))],
            [results[n][ARMS[arm]]["latency_p95_ms"] for n in names],
            0.4,
            color=colors[arm],
            label=f"p95 {label[arm]}",
        )
        ax.scatter(
            [i + off for i in range(len(names))],
            [results[n][ARMS[arm]]["latency_p50_ms"] for n in names],
            color="black",
            s=12,
            zorder=3,
            label="p50" if arm == "post" else None,
        )
    ax.set_xticks(
        range(len(names)),
        [f"{n.split(' (')[0]} (n={results[n][ARMS['post']]['latency_n']})" for n in names],
        fontsize=7,
    )
    ax.set_ylabel("retrieval latency (ms)")
    ax.set_title(
        "Retrieval-only latency on a local throwaway Postgres (batch2: network to staging Neon). Not end-to-end.",
        fontsize=7,
    )
    ax.legend(fontsize=6)
    fig.tight_layout()
    fig.savefig(f"{HERE}/charts/latency.png", dpi=150)
    plt.close(fig)
    # safety gate
    post = sg["by_rev"][POST]
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    cats = [
        ("hazard asks stopped", post["stopped"], "#c0392b"),
        ("hazard asks bannered", post["protected"] - post["stopped"], "#e6a23c"),
        ("hazard asks MISSED", len(post["missed"]), "#555"),
        ("ordinary asks over-triggered", len(post["over_triggered"]), "#8e44ad"),
    ]
    ax.barh([c[0] for c in cats], [c[1] for c in cats], color=[c[2] for c in cats])
    for i, c in enumerate(cats):
        ax.text(c[1] + 0.1, i, str(c[1]), va="center", fontsize=7)
    ax.set_title(
        f"Deterministic pre-LLM notebook gate on {POST}: {post['protect_expected']} hazard + {post['none_expected']} ordinary cases (identical on all 3 revisions)",
        fontsize=7,
    )
    ax.tick_params(labelsize=7)
    fig.tight_layout()
    fig.savefig(f"{HERE}/charts/safety-gate.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    try:
        main()
    except InvalidRun as e:
        print(f"INVALID RUN, nothing scored: {e}")
        raise SystemExit(2) from None
