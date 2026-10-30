"""Seal SEALED-C: admit a case when author (labels-X) and blind reviewer (review-X / agreement-X) agree on mode.
Pre-registered rule (PREREGISTRATION.md §4, TASK brief): disagreements are dropped, never relabelled. Prints counts only."""
import json, hashlib, collections, datetime, os
D = os.path.dirname(os.path.abspath(__file__))
cases, labels, dropped = [], [], []
for h in ("A", "B"):
    c = {x["id"]: x for x in json.load(open(f"{D}/cases-{h}.json"))}
    l = {x["id"]: x for x in json.load(open(f"{D}/labels-{h}.json"))}
    a = {x["id"]: x for x in json.load(open(f"{D}/agreement-{h}.json"))}
    assert set(c) == set(l) == set(a), f"id mismatch in half {h}"
    for i in sorted(c):
        if a[i]["agree_mode"]:
            cases.append(c[i]); labels.append(l[i])
        else:
            dropped.append({"id": i, "reason": "author/reviewer mode disagreement", "note": a[i].get("note", "")})
open(f"{D}/sealed-c-cases.json", "w").write(json.dumps(cases, indent=1))
open(f"{D}/sealed-c-labels.json", "w").write(json.dumps(labels, indent=1))
open(f"{D}/dropped.json", "w").write(json.dumps(dropped, indent=1))
h = lambda p: hashlib.sha256(open(f"{D}/{p}", "rb").read()).hexdigest()
line = (f"{datetime.datetime.utcnow().isoformat(timespec='seconds')}Z sealed-c admitted={len(cases)} dropped={len(dropped)} "
        f"sha256(cases)={h('sealed-c-cases.json')} sha256(labels)={h('sealed-c-labels.json')}  (seal_c.py; agreement rule)\n")
open(f"{D}/../SEALED.md", "a").write(line)
print(line.strip())
print("admitted by expected_mode:", dict(collections.Counter(x["expected_mode"] for x in labels)))
