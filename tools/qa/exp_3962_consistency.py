#!/usr/bin/env python3
"""#3962 — measure answer-vs-evidence consistency detectors against ground truth.

Two detectors judge the same live turns:

  DETERMINISTIC  `assessEvidenceFollowed` (shipped in #3964) — subject identifiers
                 plus disjoint equipment-class sets, no model call.
  JEV            TypeSafe System One, asked "does the ANSWER address the
                 equipment in the OBSERVATION?".

Ground truth is assigned by a rule stated up front, not by whichever detector
agrees: an answer FOLLOWS the evidence if it discusses the photographed item
(a bearing) and does NOT if its subject is different equipment (a drive, a
motor, a contactor). Every pair is printed so the labelling can be checked.

Both detectors are scored for accuracy, false positives and false negatives —
because a detector that never fires has no false positives and is useless.

Staging only. Never claims a verdict from one sample; every case is repeated.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request

UA = {"Content-Type": "application/json"}

# --- ground-truth lexicons, fixed before any measurement ---------------------
BEARING = r"\b(bearing|preload|spall|brinell|race(?:way)?s?|lubricat|grease|housing fit)\b"
OTHER_EQUIP = r"\b(vfd|variable[- ]frequency|inverter|dc bus|encoder|contactor|coupling|motor|stator|belt|power/ground|supply terminal)\b"


LEAD_CHARS = 220


def label(answer: str) -> str:
    """Ground truth from the answer's LEAD, not from token counts anywhere in it.

    The first rule counted terms across the whole answer and returned AMBIGUOUS
    for 4 of 5 obviously-diverging cases, because every one of them mentioned
    "bearing" once in a list far below a lead that said "a loose or worn drive
    coupling". #3962 is about what the answer is ABOUT — its subject and first
    recommendation — so the label reads the lead.

    Changed deliberately and recorded here rather than silently: a labelling rule
    that cannot separate the cases it was written for is not neutral, it is
    broken, and leaving it would have scored both detectors against noise.
    """
    lead = answer[:LEAD_CHARS]
    b = re.search(BEARING, lead, re.I)
    o = re.search(OTHER_EQUIP, lead, re.I)
    if b and not o:
        return "FOLLOWS"
    if o and not b:
        return "DIVERGES"
    if b and o:
        return "FOLLOWS" if b.start() < o.start() else "DIVERGES"
    return "AMBIGUOUS"


def jev(obs: str, ans: str, key: str) -> tuple[float | None, int]:
    body = {
        "model": "jev-1.13.0",
        "state": f"OBSERVATION (what the technician photographed):\n{obs}\n\nANSWER MIRA gave:\n{ans}",
        "questions": {
            "follows": {
                "type": "noul",
                "instructions": (
                    "Does the ANSWER address the specific equipment described in the OBSERVATION? "
                    "Answer no if the answer is about a different kind of equipment, or ignores the observed item entirely."
                ),
            }
        },
    }
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=json.dumps(body).encode(),
        headers={**UA, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        j = json.loads(r.read())
    return j.get("answers", {}).get("follows", {}).get("noul"), j.get("usage", {}).get("input_tokens", 0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True, help="JSON file: [{observation, answer, trace}]")
    ap.add_argument("--threshold", type=float, default=0.30, help="jev noul below this = DIVERGES")
    ap.add_argument("--out", default="/tmp/exp-3962.json")
    a = ap.parse_args()

    key = os.environ.get("JEV_API_KEY")
    if not key:
        print("JEV_API_KEY required", file=sys.stderr)
        return 2

    pairs = json.load(open(a.pairs))
    rows, tok = [], 0
    for p in pairs:
        truth = label(p["answer"])
        noul, t = jev(p["observation"], p["answer"], key)
        tok += t
        jev_verdict = "AMBIGUOUS" if noul is None else ("DIVERGES" if noul < a.threshold else "FOLLOWS")
        rows.append({
            "trace": p.get("trace"), "truth": truth, "jev_noul": noul,
            "jev_verdict": jev_verdict, "det_verdict": p.get("det_verdict"),
            "answer_head": p["answer"][:90],
        })
        print(f"  truth={truth:10} jev={str(noul):6}->{jev_verdict:10} det={str(p.get('det_verdict')):20} {p['answer'][:60]!r}")

    def score(field: str) -> dict:
        tp = sum(1 for r in rows if r["truth"] == "DIVERGES" and r[field] in ("DIVERGES", "unverified_mismatch"))
        fn = sum(1 for r in rows if r["truth"] == "DIVERGES" and r[field] not in ("DIVERGES", "unverified_mismatch"))
        fp = sum(1 for r in rows if r["truth"] == "FOLLOWS" and r[field] in ("DIVERGES", "unverified_mismatch"))
        tn = sum(1 for r in rows if r["truth"] == "FOLLOWS" and r[field] not in ("DIVERGES", "unverified_mismatch"))
        n = tp + fn + fp + tn
        return {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
                "recall_on_divergence": round(tp / (tp + fn), 3) if tp + fn else None,
                "false_positive_rate": round(fp / (fp + tn), 3) if fp + tn else None,
                "scored_pairs": n}

    result = {"threshold": a.threshold, "pairs": len(rows),
              "jev": score("jev_verdict"), "deterministic": score("det_verdict"),
              "jev_input_tokens": tok, "jev_cost_usd": round(tok / 1e6 * 0.042, 6), "rows": rows}
    json.dump(result, open(a.out, "w"), indent=2)
    print(f"\n  JEV           {json.dumps(result['jev'])}")
    print(f"  DETERMINISTIC {json.dumps(result['deterministic'])}")
    print(f"  cost: {tok} input tokens = ${result['jev_cost_usd']}   artifact: {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
