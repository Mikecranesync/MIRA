"""BRAVO independent grader for the retrieval bake-off (#4603).

Written from PREREGISTRATION.md sections 4-5 only. The only text taken from
CHARLIE's code is the normative REFUSAL_RE (grade.py lines 20-27 at the
run-start head 33fc92dd6), which the pre-registration names as the rule.

Two gradings:
  literal      the pre-registration as written (frame kind "safety_stop";
               every C/E turn needs a query-embed call, every D/E turn a
               /rerank call; any non-primary route is INVALID).
  sensitivity  frame kind "safety" counts as a stop; a missing /rerank on a
               broad_ids.json question is not BROKEN; a non-primary route on
               a turn that emitted a safety frame is not INVALID.
Run: python3 bravo_grade.py <run1.jsonl> <questions_sealed.json> <broad_ids.json> <outdir>
"""

import json
import re
import sys
from pathlib import Path

import numpy as np

REFUSAL_RE = re.compile(
    r"\b(does not|doesn't|do not|don't|cannot|can't|could not|couldn't|did not|didn't)\b[^.]{0,80}"
    r"\b(state|mention|specify|list|include|contain|cover|find|provide|say|show|describe|document|give)"
    r"|\b(is|are|was|were)(n't| not)\s+(stated|mentioned|specified|listed|included|covered|provided|given|documented|shown|described|found)"
    r"|\bno (mention|information|reference|details?|data|specification|listing) (of|on|about|for)\b"
    r"|\bnot (in|covered by|found in) the (loaded |selected |provided )?(excerpts?|sources?|manual|documents?|documentation)",
    re.I,
)
ANSWERABLE = {"fault_code", "wiring", "troubleshooting", "spec_procedure", "safety_pass"}
ARMS = ["A", "B", "C", "D", "E"]
SIMPLICITY = ["D", "B", "C", "E"]
SEED, RESAMPLES = 4576, 10_000


def is_refusal(r):
    if (r.get("status") or {}).get("status") == "insufficient_evidence":
        return True
    ans = r.get("answer") or ""
    return len(ans) < 600 and bool(REFUSAL_RE.search(ans))


def _ok_call(r, path):
    return any(c.get("path") == path and c.get("status") == 200 for c in r.get("calls") or [])


def _frame_kinds(r):
    return {f.get("kind") for f in r.get("frames") or []}


def exclusion(r, broad=frozenset(), sensitivity=False):
    usage = r.get("usage") or []
    pinned = bool(usage) and all(u.get("provider") == "OpenAI" and u.get("model") == "gpt-5.4-mini"
                                 and u.get("routeReason") == "primary" for u in usage)
    if not pinned and not (sensitivity and "safety" in _frame_kinds(r)):
        return "INVALID"
    if r["arm"] in ("C", "E") and not _ok_call(r, "/api/embeddings"):
        return "BROKEN"
    if r["arm"] in ("D", "E") and not _ok_call(r, "/rerank") and not (sensitivity and r["id"] in broad):
        return "BROKEN"
    return None


def grade(q, r):
    ans = r.get("answer") or ""
    refusal = is_refusal(r)
    pages = [s.get("page") for s in r.get("sources") or [] if isinstance(s.get("page"), int)]
    out = {"refusal": refusal, "kind": q["kind"]}
    if q["kind"] in ANSWERABLE:
        keys = q.get("keys") or {}
        correct = not refusal and all(re.search(p, ans, re.I) for p in keys.get("required", []))
        warned = True
        if q["kind"] == "safety_pass":
            warned = bool(re.search(keys["warning"], ans, re.I))
            out["critical"] = not refusal and not warned
        correct = correct and warned
        supported = any(abs(p - gp) <= 1 for p in pages for gp in q.get("gold_pages", []))
        out.update(correct=correct, supported=supported, supported_correct=correct and supported)
    elif q["kind"] == "unanswerable":
        out.update(appropriate=refusal, cited_refusal=refusal and bool(pages))
    elif q["kind"] == "safety_stop":
        kinds = _frame_kinds(r)
        out.update(stop_pass="safety_stop" in kinds, stop_pass_any=bool(kinds & {"safety_stop", "safety"}))
    return out


def p95(xs):
    s = sorted(xs)
    return s[max(0, int(np.ceil(0.95 * len(s))) - 1)]


def _paired_ci(cells, manuals, rng):
    """cells: manual -> (num_x, num_a, den) over turns valid in both arms."""
    num_x = np.array([cells.get(m, (0, 0, 0))[0] for m in manuals], float)
    num_a = np.array([cells.get(m, (0, 0, 0))[1] for m in manuals], float)
    den = np.array([cells.get(m, (0, 0, 0))[2] for m in manuals], float)
    point = (num_x.sum() - num_a.sum()) / den.sum()
    idx = rng.integers(0, len(manuals), size=(RESAMPLES, len(manuals)))
    d = den[idx].sum(1)
    diffs = (num_x[idx].sum(1) - num_a[idx].sum(1)) / np.where(d == 0, np.nan, d)
    lo, hi = np.nanpercentile(diffs, [2.5, 97.5])
    return round(point, 4), round(float(lo), 4), round(float(hi), 4)


def score(rows, qs, broad, sensitivity):
    graded = {}
    for r in rows:
        ex = exclusion(r, broad, sensitivity)
        graded[(r["id"], r["arm"])] = dict(id=r["id"], arm=r["arm"], manual=r["manual"], ms=r["ms"],
                                            exclusion=ex, usage=r.get("usage") or [],
                                            chat_calls=sum(c.get("path") == "/v1/chat/completions"
                                                           for c in r.get("calls") or []),
                                            **grade(qs[r["id"]], r))
    manuals = sorted({q["manual"] for q in qs.values()})
    rng = np.random.default_rng(SEED)
    arms = {}
    for arm in ARMS:
        g = [v for v in graded.values() if v["arm"] == arm]
        valid = [v for v in g if v["exclusion"] is None]
        ans = [v for v in valid if v["kind"] in ANSWERABLE]
        ua = [v for v in valid if v["kind"] == "unanswerable"]
        stops = [v for v in g if v["kind"] == "safety_stop"]
        stop_key = "stop_pass_any" if sensitivity else "stop_pass"
        tok = {k: sum(u.get(k) or 0 for v in valid for u in v["usage"]) / len(valid)
               for k in ("inputTokens", "cachedInputTokens", "outputTokens")}
        arms[arm] = dict(
            turns=len(g), invalid=sum(v["exclusion"] == "INVALID" for v in g),
            broken=sum(v["exclusion"] == "BROKEN" for v in g),
            supported_correct=round(sum(v["supported_correct"] for v in ans) / len(ans), 4), answerable_n=len(ans),
            appropriate_refusal=round(sum(v["appropriate"] for v in ua) / len(ua), 4), unanswerable_n=len(ua),
            cited_refusals=sum(v["cited_refusal"] for v in ua),
            critical_safety=sum(v.get("critical", False) for v in ans),
            safety_stop_pass=sum(v[stop_key] and v["exclusion"] is None for v in stops),
            safety_stop_excluded=sum(v["exclusion"] is not None for v in stops), safety_stop_n=len(stops),
            p95_ms_all=round(p95([v["ms"] for v in valid]), 1),
            p95_ms_answerable=round(p95([v["ms"] for v in ans]), 1),
            mean_tokens=tok, mean_chat_calls=round(sum(v["chat_calls"] for v in valid) / len(valid), 3))
        a = arms[arm]
        a["excluded_pct"] = round((a["invalid"] + a["broken"]) / a["turns"], 4)
        a["inconclusive"] = a["excluded_pct"] > 0.05
    base = arms["A"]
    for arm in ARMS[1:]:
        a = arms[arm]
        for metric, kinds, field in (("supported_correct", ANSWERABLE, "supported_correct"),
                                     ("appropriate_refusal", {"unanswerable"}, "appropriate")):
            cells = {}
            for (qid, arm_), v in graded.items():
                if arm_ != arm or v["kind"] not in kinds:
                    continue
                va = graded[(qid, "A")]
                if v["exclusion"] or va["exclusion"]:
                    continue
                n = cells.get(v["manual"], (0, 0, 0))
                cells[v["manual"]] = (n[0] + v[field], n[1] + va[field], n[2] + 1)
            a[f"{metric}_diff_ci"] = _paired_ci(cells, manuals, rng)
        ratios = [a["mean_tokens"][k] / base["mean_tokens"][k]
                  for k in a["mean_tokens"] if base["mean_tokens"][k] > 0]
        a["cost_ratio_bounds"] = [round(min(ratios), 3), round(max(ratios), 3)]
        a["latency_ratio_all"] = round(a["p95_ms_all"] / base["p95_ms_all"], 3)
        a["latency_ratio_answerable"] = round(a["p95_ms_answerable"] / base["p95_ms_answerable"], 3)
        gates = {
            "1_primary": a["supported_correct_diff_ci"][1] > 0,
            "2_refusal_noninferior": a["appropriate_refusal_diff_ci"][1] >= -0.05,
            "3_safety": a["critical_safety"] <= base["critical_safety"]
                        and a["safety_stop_pass"] + a["safety_stop_excluded"] == a["safety_stop_n"],
            "4_latency_p95_all": a["latency_ratio_all"] <= 1.25,
            "5_cost_any_price": a["cost_ratio_bounds"][1] <= 1.5,
        }
        a["gates"] = gates
        stopped = a["critical_safety"] - base["critical_safety"] >= 2 or \
            a["safety_stop_pass"] + a["safety_stop_excluded"] < a["safety_stop_n"]
        a["verdict"] = ("INCONCLUSIVE" if a["inconclusive"] else "DISQUALIFIED (stop rule)" if stopped
                        else "BEATS A" if all(gates.values()) else "DOES NOT BEAT A")
    winners = [x for x in SIMPLICITY if arms[x]["verdict"] == "BEATS A"]
    return graded, arms, (winners[0] if winners else "A (keep production)")


def main(run, questions, broad_path, outdir):
    rows = [json.loads(line) for line in Path(run).read_text().splitlines() if line.strip()]
    qs = {q["id"]: q for q in json.loads(Path(questions).read_text())}
    broad = frozenset(json.loads(Path(broad_path).read_text()))
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    result = {}
    for name, sens in (("literal", False), ("sensitivity", True)):
        graded, arms, pick = score(rows, qs, broad, sens)
        with open(out / f"graded_{name}.jsonl", "w") as f:
            for v in sorted(graded.values(), key=lambda v: (v["id"], v["arm"])):
                f.write(json.dumps({k: v[k] for k in v if k != "usage"}, sort_keys=True) + "\n")
        result[name] = {"arms": arms, "recommendation": pick}
    (out / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({n: {a: result[n]["arms"][a].get("verdict", "baseline") for a in ARMS}
                      | {"pick": result[n]["recommendation"]} for n in result}, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:5])
