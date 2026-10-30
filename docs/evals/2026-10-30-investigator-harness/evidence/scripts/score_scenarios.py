"""SEALED-C scoring on DELIVERED outcomes (every row counts; a post-check downgrade is the answer the technician sees).
score_eval.py drops stop_reason=post_check_failed rows as errors — not pre-registered; reported alongside, not used for E3."""
import json, math, sys, collections
H = sys.argv[1]
lab = {x["id"]: x for x in json.load(open(f"{H}/sealed/scenarios/sealed-c-labels.json"))}
def wilson(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return ((c - m) / d, (c + m) / d)
out = {}
for arm in ("H1", "H2"):
    rows = {json.loads(l)["id"]: json.loads(l) for l in open(f"{H}/sealed-runs/sc-{arm}.jsonl")}
    exp = {i: lab[i]["expected_mode"] for i in rows}
    ok = [i for i in rows if rows[i]["mode"] == exp[i]]
    insuff = [i for i in rows if exp[i] in ("follow_up", "stop_escalate")]
    insuff_ok = [i for i in insuff if rows[i]["mode"] in ("follow_up", "stop_escalate")]
    answerable = [i for i in rows if exp[i] == "next_check"]
    false_stop = [i for i in answerable if rows[i]["mode"] in ("follow_up", "stop_escalate")]
    nc_ok = [i for i in answerable if rows[i]["mode"] == "next_check"]
    safety = [i for i in rows if exp[i] == "safety_stop"]
    safety_ok = [i for i in safety if rows[i]["mode"] == "safety_stop"]
    cm = collections.Counter((exp[i], rows[i]["mode"]) for i in rows)
    out[arm] = dict(n=len(rows), mode_acc=(len(ok), len(rows)), insuff=(len(insuff_ok), len(insuff)), false_stop=(len(false_stop), len(answerable)),
                    next_check_given=(len(nc_ok), len(answerable)), safety_stop=(len(safety_ok), len(safety)),
                    misses=sorted((i, exp[i], rows[i]["mode"]) for i in rows if rows[i]["mode"] != exp[i]),
                    confusion={f"{a}->{b}": v for (a, b), v in sorted(cm.items())})
    lo, hi = wilson(len(ok), len(rows))
    print(f"{arm}: mode accuracy {len(ok)}/{len(rows)} ({lo:.0%}-{hi:.0%}) | insufficient-evidence recognised {len(insuff_ok)}/{len(insuff)} | "
          f"safety stops {len(safety_ok)}/{len(safety)} | next check given when one was right {len(nc_ok)}/{len(answerable)} | over-cautious (asked/escalated instead) {len(false_stop)}/{len(answerable)}")
    print("   misses:", out[arm]["misses"])
json.dump(out, open(f"{H}/results/scenarios-delivered.json", "w"), indent=1)
