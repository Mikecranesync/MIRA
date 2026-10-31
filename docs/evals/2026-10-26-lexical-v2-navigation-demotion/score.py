"""Score the pre-registered bar from the committed raw rows. Stdlib only, zero tokens.

    python3 score.py --questions <IMIB benchmark-4791 dir> [--raw raw] [--cand cand2]

--questions is docs/evals/benchmark-4791 on branch eval/imib-auto-truth (it holds the question sets).
--raw defaults to this directory's raw/ (gzipped <label>-<set>-<off|on>.jsonl rows).
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_rows(raw: str, label: str, s: str, arm: str) -> dict:
    p = os.path.join(raw, f"{label}-{s}-{arm}.jsonl")
    f = gzip.open(p + ".gz", "rt") if os.path.exists(p + ".gz") else open(p)
    with f:
        return {json.loads(line)["id"]: json.loads(line) for line in f if line.strip()}


def question_file(qdir: str, s: str) -> str:
    p = os.path.join(qdir, s, f"{s}-questions.json")
    return p if os.path.exists(p) else os.path.join(qdir, f"{s}-questions.json")


def mcnemar(w: int, lost: int) -> float:
    n, k = w + lost, min(w, lost)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2**n) if n else 1.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", required=True)
    ap.add_argument("--raw", default=os.path.join(HERE, "raw"))
    ap.add_argument("--cand", default="cand2")
    a = ap.parse_args()
    res = {}
    for s, n in (("t4-77", 6), ("oem-fault", 5), ("robust", 5), ("oem-index", 5)):
        qs = {q["id"]: q for q in json.load(open(question_file(a.questions, s)))}
        ids = [i for i in qs if qs[i]["accepted"]]
        if (
            s == "oem-index"
        ):  # footer-free subset: no leaked "Rockwell Automation Publication …" text
            ids = [i for i in ids if "Publication" not in qs[i]["question"]]
        r = {
            arm: {lab: load_rows(a.raw, lab, s, arm) for lab in ("main", a.cand)}
            for arm in ("off", "on")
        }
        f0 = all(
            r["off"]["main"][i]["ranked_pages"] == r["off"][a.cand][i]["ranked_pages"] for i in qs
        )

        def hit(rows: dict, i: str, k: int) -> bool:
            return any(p in qs[i]["accepted"] for p in rows[i]["ranked_pages"][:k])

        out: dict = {"F0_off_identical": f0, "n": len(ids)}
        for k in (1, n):
            m, c = r["on"]["main"], r["on"][a.cand]
            g = [i for i in ids if hit(c, i, k) and not hit(m, i, k)]
            lost = [i for i in ids if hit(m, i, k) and not hit(c, i, k)]
            out[f"top{k}"] = {
                "off": sum(hit(r["off"]["main"], i, k) for i in ids),
                "main_on": sum(hit(m, i, k) for i in ids),
                "cand_on": sum(hit(c, i, k) for i in ids),
                "gained": len(g),
                "lost": len(lost),
                "net": len(g) - len(lost),
                "p": round(mcnemar(len(g), len(lost)), 4),
                "lost_ids": lost[:20],
                "gained_ids": g[:20],
            }
        res[s] = out
    print(json.dumps(res, indent=1))
    t = res["t4-77"]
    v = {
        "F0": all(res[s]["F0_off_identical"] for s in res),
        "G1": t["top6"]["net"] >= 0 and t["top1"]["net"] >= 0,
        "G2": res["oem-fault"]["top5"]["net"] >= 0,
        "G3": res["robust"]["top5"]["net"] >= 0,
        "T1_index_top1": res["oem-index"]["top1"]["cand_on"],
    }
    print("VERDICT", v, "PASS" if all(v[x] for x in ("F0", "G1", "G2", "G3")) else "FAIL")


if __name__ == "__main__":
    main()
