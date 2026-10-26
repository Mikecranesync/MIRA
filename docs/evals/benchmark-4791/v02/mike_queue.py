"""Which questions still need Mike, under the pre-registered rule. No model calls: reads the cached labels only.

    python3 v02/mike_queue.py        (writes v02/labeler-calibration.json and v02/mike-queue.json)

1. Qualify each AI labeler on oem-fault, where the manufacturer's table says which page answers. Hit = the labeler
   picked at least one manufacturer page. Qualified when hit rate >= 0.90 (PREREGISTRATION-v0.2.md).
2. On forum-new, the qualified labelers AGREE on a case when every one of them says "answerable" and they share at
   least one page, or every one of them says "not answerable".
3. Mike's queue = every case they do not agree on + ALL 32 safety calls + a seeded random audit of 10 agreed cases
   (all of them if fewer than 10). The audit is what measures how often the automation is wrong.
"""

from __future__ import annotations

import glob
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
import analyze as A  # noqa: E402

QUALIFY, AUDIT_N, SEED = 0.90, 10, 4791


def labels(model_dir: str, task: str) -> dict[str, dict]:
    return {
        os.path.basename(f)[:-5]: json.load(open(f))
        for f in glob.glob(os.path.join(model_dir, task, "*.json"))
    }


def calibrate() -> dict:
    truth = {
        q["id"]: q["accepted"]
        for q in json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-questions.json")))
    }
    out = {}
    for d in sorted(glob.glob(os.path.join(HERE, "labels", "*/"))):
        lab = labels(d, "calibration")
        if not lab:
            continue
        model = os.path.basename(d.rstrip("/"))
        hits = sum(1 for i, t in truth.items() if i in lab and set(lab[i]["answer_pages"]) & set(t))
        exact = sum(
            1 for i, t in truth.items() if i in lab and set(lab[i]["answer_pages"]) == set(t)
        )
        unparsed = sum(1 for v in lab.values() if not v.get("parsed"))
        n = sum(1 for i in truth if i in lab)
        out[model] = {
            "n": n,
            "complete": n == len(truth),
            "hit": hits,
            "hit_rate": hits / max(1, n),
            "hit_ci95": A.wilson(hits, n),
            "exact": exact,
            "unparsed": unparsed,
            "cost_usd": round(sum(v.get("cost_usd", 0) for v in lab.values()), 4),
            "qualified": n == len(truth) and hits / max(1, n) >= QUALIFY,
        }
    return out


def agree(per_model: list[dict]) -> bool:
    calls = [bool(lbl["answer_pages"]) for lbl in per_model]
    if not any(calls):
        return True
    if not all(calls):
        return False
    shared = set(per_model[0]["answer_pages"])
    for lbl in per_model[1:]:
        shared &= set(lbl["answer_pages"])
    return bool(shared)


def build_queue(cal: dict) -> dict:
    review = json.load(open(os.path.join(BENCH, "human-key", "review-data.json")))
    qualified = [m for m, c in cal.items() if c["qualified"]]
    forum = review["forum"]
    lab = {m: labels(os.path.join(HERE, "labels", m), "forum-new") for m in qualified}
    agreed, disputed, consensus = [], [], {}
    for idx, f in enumerate(forum, 1):
        per = [lab[m][f["id"]] for m in qualified if f["id"] in lab[m]]
        if len(qualified) < 2 or len(per) < len(qualified):
            disputed.append((idx, f["id"], "fewer than two qualified labels"))
        elif agree(per):
            agreed.append((idx, f["id"]))
            pages = set(per[0]["answer_pages"])
            for lbl in per[1:]:
                pages &= set(lbl["answer_pages"])
            consensus[f["id"]] = sorted(pages)
        else:
            disputed.append((idx, f["id"], "labelers disagree"))
    audit = sorted(random.Random(SEED).sample(agreed, min(AUDIT_N, len(agreed))))
    return {
        "rule": "PREREGISTRATION-v0.2.md: disagreements + all safety + seeded audit of 10 agreed",
        "qualified_labelers": qualified,
        "forum_total": len(forum),
        "forum_for_mike": sorted(
            [{"case_number": i, "id": fid, "why": why} for i, fid, why in disputed]
            + [
                {
                    "case_number": i,
                    "id": fid,
                    "why": "audit sample of an agreed case",
                    "consensus_pages": consensus[fid],
                }
                for i, fid in audit
            ],
            key=lambda x: x["case_number"],
        ),
        "forum_agreed_not_audited": [
            {"case_number": i, "id": fid, "consensus_pages": consensus[fid]}
            for i, fid in agreed
            if (i, fid) not in audit
        ],
        "safety_for_mike": [
            {"call_number": i, "id": s["id"]} for i, s in enumerate(review["safety"], 1)
        ],
        "hazard_hunter": "unchanged: 10-20 in Mike's own words",
    }


def main() -> None:
    cal = calibrate()
    json.dump(cal, open(os.path.join(HERE, "labeler-calibration.json"), "w"), indent=1)
    for m, c in cal.items():
        print(
            f"{m}: {c['hit']}/{c['n']} = {c['hit_rate']:.0%} hit (CI {c['hit_ci95'][0]:.0%}-{c['hit_ci95'][1]:.0%}), exact {c['exact']}, unparsed {c['unparsed']}, ${c['cost_usd']} -> {'QUALIFIED' if c['qualified'] else 'not qualified'}"
        )
    q = build_queue(cal)
    json.dump(q, open(os.path.join(HERE, "mike-queue.json"), "w"), indent=1)
    print(
        f"Mike: {len(q['forum_for_mike'])}/{q['forum_total']} forum cases + {len(q['safety_for_mike'])} safety calls + Hazard Hunter"
    )


if __name__ == "__main__":
    main()
