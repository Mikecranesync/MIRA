"""IMIB v0.2 analysis: validation tests V1-V4 and the pre-registered verdicts, recomputed from raw/ only.

    uv run --no-project --python 3.12 python v02/analyze_v02.py        (writes v02/results-v02.json)

Reuses analyze.py's scorer and its raw-run validation (ids, frozen labels, kinds, harness errors). Arms:
pre/parent/post/noexactlane (k=6, 2 repeats), bm25 and random (k=10, cut to 6).
"""

from __future__ import annotations

import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
import analyze as A  # noqa: E402

SETS = ("oem-fault", "oem-index", "robust")
ARMS = {
    "pre": "b980d42db",
    "parent": "e28bb182d",
    "post": "cc0d26c1d",
    "noexactlane": "cc0d26c1d-noexactlane",
    "bm25": "bm25",
    "random": "random",
}


def load_set(name: str) -> dict:
    frozen_qs = json.load(open(os.path.join(BENCH, name, f"{name}-questions.json")))
    frozen = {q["id"]: q["accepted"] for q in frozen_qs}
    manual = {q["id"]: q["manual"] for q in frozen_qs}
    arms, det = {}, {}
    for arm, tag in ARMS.items():
        k = 10 if arm in ("bm25", "random") else 6
        files = sorted(glob.glob(os.path.join(BENCH, "raw", name, f"{name}-{tag}-k{k}-r*.jsonl")))
        if not files:
            continue
        reps = []
        for f in files:
            rows = A.load_jsonl(f)
            A.validate_rows(rows, frozen, os.path.relpath(f, BENCH), check_kind=True)
            reps.append({r["id"]: r["ranked_pages"][:6] for r in rows})
        arms[arm] = reps[0]
        det[arm] = all(r == reps[0] for r in reps)
    qs = {
        i: {
            "accepted": acc,
            "kind": "answerable" if acc else "unanswerable",
            "cluster": manual[i],
            "arms": {a: arms[a][i] for a in arms},
        }
        for i, acc in frozen.items()
    }
    return {"questions": qs, "deterministic": det, "arms": list(arms), "lat": {}}


def top(s: dict, arm: str, n: int = 5) -> dict:
    ans = [q for q in s["questions"].values() if q["kind"] == "answerable"]
    k = sum(A.hit(q, arm, n) for q in ans)
    return {"num": k, "den": len(ans), "rate": k / max(1, len(ans)), "ci95": A.wilson(k, len(ans))}


def judge(rs: dict, determinism: dict) -> tuple[dict, dict]:
    """The pre-registered validation tests V1-V4 and the #4791 verdict on the OEM sets, from per-set results."""
    validation: dict = {}
    if "oem-fault" in rs:
        rf = rs["oem-fault"]
        bm, rnd = rf["arms"]["bm25"]["top5"]["rate"], rf["arms"]["random"]["top5"]["rate"]
        pd = rf["paired_post_vs_noexactlane"]["top5"]
        kc = rf["paired_pre_vs_post"]["top5"]
        validation = {
            "V1_discrimination": {
                "pass": bm >= 0.50 and rnd <= 0.10,
                "bm25_top5": bm,
                "random_top5": rnd,
            },
            "V2_planted_defect": {
                "pass": pd["b_lost"] - pd["c_gained"] >= 2,
                "lost": pd["b_lost"],
                "gained": pd["c_gained"],
                "mcnemar_p": pd["mcnemar_p"],
            },
            "V3_known_change": {
                "moved": kc["b_lost"] + kc["c_gained"] > 0,
                "lost": kc["b_lost"],
                "gained": kc["c_gained"],
            },
            "V4_determinism": {"pass": all(all(v.values()) for v in determinism.values())},
        }
    pool_b = pool_c = 0
    nogo = []
    for name in ("oem-fault", "oem-index"):
        if name in rs:
            p = rs[name]["paired_pre_vs_post"]["top5"]
            pool_b, pool_c = pool_b + p["b_lost"], pool_c + p["c_gained"]
            if p["b_lost"] - p["c_gained"] >= 2:
                nogo.append(name)
    pooled_p = A.mcnemar(pool_b, pool_c)
    verdicts = {
        "pr4791_on_oem_sets": {
            "verdict": "NO-GO"
            if nogo
            else ("GO" if pool_c > pool_b and pooled_p < 0.05 else "INCONCLUSIVE"),
            "lost": pool_b,
            "gained": pool_c,
            "mcnemar_p": pooled_p,
            "nogo_sets": nogo,
        }
    }
    return validation, verdicts


def simlab_summary() -> dict | None:
    """Per scenario: passes over repeats; per checkpoint: pass rate over every scenario-run that has it."""
    runs = [
        json.load(open(f)) for f in sorted(glob.glob(os.path.join(HERE, "simlab", "run-r*.json")))
    ]
    if not runs:
        return None
    per, cps = {}, {}
    for run in runs:
        for r in run["results"]:
            if "skipped" in r:
                continue
            p = per.setdefault(r["id"], {"runs": 0, "passed": 0})
            p["runs"] += 1
            p["passed"] += bool(r["passed"])
            checks = [
                (n, v.get("passed")) for n, v in (r.get("standard_results") or {}).items()
            ] + [(b["name"], b["passed"]) for b in r.get("behavior_results", [])]
            for name, ok in checks:
                c = cps.setdefault(name, [0, 0])
                c[0] += bool(ok)
                c[1] += 1
    total = sum(p["runs"] for p in per.values())
    passed = sum(p["passed"] for p in per.values())
    spend = json.load(open(os.path.join(HERE, "simlab", "spend.json")))
    return {
        "repeats": len(runs),
        "scenario_runs": total,
        "passed": passed,
        "pass_ci95": A.wilson(passed, total),
        "per_scenario": per,
        "checkpoints": {k: {"passed": v[0], "of": v[1]} for k, v in sorted(cps.items())},
        "spend_usd": round(spend["usd"], 4),
        "calls": spend["calls"],
        "spend_note": spend.get("note"),
    }


def main() -> None:
    res: dict = {"sets": {}, "validation": {}, "verdicts": {}}
    sets = {
        name: load_set(name) for name in SETS if os.path.isdir(os.path.join(BENCH, "raw", name))
    }
    for name, s in sets.items():
        r = {"n": len(s["questions"]), "deterministic": s["deterministic"], "arms": {}}
        for arm in s["arms"]:
            ranks = [
                A.rank_of(q["arms"][arm], q["accepted"])
                for q in s["questions"].values()
                if q["kind"] == "answerable"
            ]
            r["arms"][arm] = {f"top{n}": top(s, arm, n) for n in (1, 3, 5)} | {
                "mrr10": sum(1 / x for x in ranks if x) / max(1, len(ranks))
            }
        for a, b in (("pre", "post"), ("post", "noexactlane"), ("post", "bm25")):
            if a in s["arms"] and b in s["arms"]:
                r[f"paired_{a}_vs_{b}"] = A.paired(s, a, b)
        res["sets"][name] = r
    res["validation"], res["verdicts"] = judge(
        res["sets"], {n: sets[n]["deterministic"] for n in sets}
    )
    if "robust" in sets:
        meta = {
            m["id"]: m
            for m in json.load(open(os.path.join(BENCH, "robust", "robust-provenance.json")))
        }
        base = {}
        for n2 in ("oem-fault",):
            base.update(sets[n2]["questions"])
        t4 = {
            r["id"]: r
            for r in map(
                json.loads, open(os.path.join(BENCH, "raw", "t4-77", "t4-77-cc0d26c1d-k6-r1.jsonl"))
            )
        }
        t4pre = {
            r["id"]: r
            for r in map(
                json.loads, open(os.path.join(BENCH, "raw", "t4-77", "t4-77-b980d42db-k6-r1.jsonl"))
            )
        }
        rob = sets["robust"]["questions"]
        out = {}
        for arm in ("pre", "post"):
            by_var: dict = {}
            for vid, q in rob.items():
                m = meta[vid]
                if m["base_id"] in base:
                    bq = base[m["base_id"]]
                    base_hit = A.hit(bq, arm, 5)
                else:
                    src = (t4 if arm == "post" else t4pre)[m["base_id"]]
                    base_hit = (A.rank_of(src["ranked_pages"][:6], src["accepted"]) or 99) <= 5
                v = by_var.setdefault(
                    m["variant"], {"base_hits": 0, "kept": 0, "variant_hits": 0, "n": 0}
                )
                v["n"] += 1
                vh = A.hit(q, arm, 5)
                v["variant_hits"] += vh
                if base_hit:
                    v["base_hits"] += 1
                    v["kept"] += vh
            for v in by_var.values():
                v["retention"] = v["kept"] / v["base_hits"] if v["base_hits"] else math.nan
                v["retention_ci95"] = A.wilson(v["kept"], v["base_hits"])
                v["flag_under_80pct"] = bool(v["base_hits"]) and v["retention"] < 0.80
            out[arm] = by_var
        res["robustness"] = out
    res["simlab"] = simlab_summary()
    cal = os.path.join(HERE, "labeler-calibration.json")
    res["labelers"] = json.load(open(cal)) if os.path.exists(cal) else None
    json.dump(
        res, open(os.path.join(HERE, "results-v02.json"), "w"), indent=1, default=lambda x: None
    )
    print(json.dumps({"validation": res["validation"], "verdicts": res["verdicts"]}, indent=1))


if __name__ == "__main__":
    try:
        main()
    except A.InvalidRun as e:
        print(f"INVALID RUN, nothing scored: {e}")
        raise SystemExit(2) from None
