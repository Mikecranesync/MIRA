"""Known-defect detection: does the pre-registered NO-GO rule (b - c >= 2 at top-5) fire on a broken candidate?

    python3 injected_defect_check.py

Three defects, each scored against the real candidate cc0d26c1d with analyze.py's paired():
1. REAL defect: the bug #4791 fixed. The pre-fix build b980d42db is presented as if it were a new candidate.
   Uses the existing raw runs, in the reverse direction.
2. PLANTED, doc-scoped path: `return [];` at the top of runExactLane inside retrieveNodeChunks (the exact-token
   / fault-code lane disabled). Raw: raw/injected/<set>-cc0d26c1d-noexactlane-k6-r1.jsonl.
3. PLANTED, a path the harness never calls: extractFaultCodes disabled. It changed 0 of 111 ranked lists. That
   function feeds only the vendor-library path, so "no change" is the correct answer. Recorded here, raw not
   kept.
Plants 2 and 3 were made in a scratch worktree of cc0d26c1d and reverted with `git checkout` (diff empty afterwards).
Exits 1 if the real defect (1) is NOT caught by at least one set.
"""

from __future__ import annotations

import json
import os

import analyze as A

HERE = os.path.dirname(os.path.abspath(__file__))


def score(label: str, good: dict, bad: dict, accepted: dict, kinds: dict) -> bool:
    s = {
        "questions": {
            i: {
                "accepted": accepted[i],
                "kind": kinds[i],
                "cluster": i,
                "arms": {"pre": good[i], "post": bad[i]},
            }
            for i in good
        }
    }
    p = A.paired(s, "pre", "post")
    t5 = p["top5"]
    fires = t5["b_lost"] - t5["c_gained"] >= 2
    lost = [
        i
        for i, q in s["questions"].items()
        if q["kind"] == "answerable" and A.hit(q, "pre", 5) and not A.hit(q, "post", 5)
    ]
    changed = sum(good[i] != bad[i] for i in good)
    print(
        f"{label:58s} lists changed {changed:3d}/{len(good):3d} | top5 lost {t5['b_lost']} gained {t5['c_gained']} | NO-GO {'FIRES' if fires else 'silent'} {lost}"
    )
    return fires


def harness(name: str, tag: str, sub: str | None = None) -> dict:
    path = f"{HERE}/raw/{sub or name}/{name}-{tag}-k6-r1.jsonl"
    return {r["id"]: r for r in map(json.loads, open(path))}


def main() -> None:
    caught_real = False
    for name in ("t4-77", "forum-new"):
        post, pre = harness(name, "cc0d26c1d"), harness(name, "b980d42db")
        acc = {i: r["accepted"] for i, r in post.items()}
        kinds = {i: r["kind"] for i, r in post.items()}
        caught_real |= score(
            f"1 real (#4791 bug) on {name}",
            {i: r["ranked_pages"] for i, r in post.items()},
            {i: r["ranked_pages"] for i, r in pre.items()},
            acc,
            kinds,
        )
    cases = {c["id"]: c for c in json.load(open(f"{HERE}/batch2-cases.json"))["cases"]}
    b2 = {
        rev: {
            r["id"]: r["pages"]
            for r in json.load(open(f"{HERE}/raw/batch2/batch2-{rev}-r1.json"))["results"]
        }
        for rev in (A.POST, A.PRE)
    }
    caught_real |= score(
        "1 real (#4791 bug) on batch2",
        b2[A.POST],
        b2[A.PRE],
        {i: cases[i]["expectedPages"] or [] for i in b2[A.POST]},
        {i: "answerable" if cases[i]["expectedPages"] else "field_only" for i in b2[A.POST]},
    )
    for name in ("t4-77", "forum-new"):
        post, bad = harness(name, "cc0d26c1d"), harness(name, "cc0d26c1d-noexactlane", "injected")
        score(
            f"2 planted exact-lane-off on {name}",
            {i: r["ranked_pages"] for i, r in post.items()},
            {i: r["ranked_pages"] for i, r in bad.items()},
            {i: r["accepted"] for i, r in post.items()},
            {i: r["kind"] for i, r in post.items()},
        )
    print(
        "3 planted extractFaultCodes-off: 0/111 lists changed (path not exercised by the doc-scoped harness)"
    )
    raise SystemExit(0 if caught_real else 1)


if __name__ == "__main__":
    main()
