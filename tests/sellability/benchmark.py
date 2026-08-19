"""Sellability benchmark — can ONE supported machine carry a paid pilot?

The question this answers is narrow on purpose: not "is the platform done", but
**is a single supported asset good enough to put in front of a design partner.**

## Why this is deterministic and not a chat benchmark

The retrieval fix in this branch is **not deployed** to the staging bot, so
re-running the 100-question Telegram probe would measure main, not the fix, and
prove nothing about it. Deploy is also explicitly out of scope.

So this measures the layer that actually decides whether a grounded answer is
possible: does the authoritative evidence reach the technician's prompt at all?
That is `recall_knowledge` — the same production function the bot calls — and it
is deterministic given a fixed corpus. No LLM, no judge, no answer-text scoring.

A chat benchmark on top of this is the right NEXT step once the fix ships; it
would measure wording, and wording is not what is broken.

## What PASS means per family

  fault      the structured `fault_codes` row for that code reaches the results
             (`retrieval_streams == ['structured_fault']`). This is the only
             authoritative, citable fault answer MIRA has.
  evidence   at least one chunk from the RIGHT vendor/model reaches the top-k.
  refuse     the query SHOULD find nothing — a fabricated code or foreign vendor.
             PASS means empty or no false authority. Refusing correctly is a
             product feature, so it is scored as a pass, never as a miss.

Run:
    doppler run -p factorylm -c stg -- python -m tests.sellability.benchmark
    doppler run -p factorylm -c stg -- python -m tests.sellability.benchmark --repeats 3
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mira-bots"))

# Expected equipment identity for every case. Kept out of the case tuples so the
# scorer compares against a declared value rather than a hard-coded "525" — the
# substring form passed an F004 row from the WRONG MANUFACTURER (Codex #3337
# round 2 F2).
EXPECT_MODEL = "PowerFlex 525"
EXPECT_MANUFACTURER = "Allen-Bradley"

# (id, family, question, expect) — expect is a fault code, a model string, or None
CASES: list[tuple[str, str, str, str | None]] = [
    # ---- fault lookup: the core promise, in real phrasing --------------------
    ("f-01", "fault", "PowerFlex 525 showing F004. What does that fault mean?", "F004"),
    ("f-02", "fault", "Got an F013 on a PowerFlex 525. What causes it?", "F013"),
    (
        "f-03",
        "fault",
        "PowerFlex 525 throwing F004 after the conveyor jammed yesterday — what should I check?",
        "F004",
    ),
    ("f-04", "fault", "What is F007 on a PowerFlex 525?", "F007"),
    ("f-05", "fault", "PowerFlex 525 F005 — what is it?", "F005"),
    (
        "f-06",
        "fault",
        "On a PowerFlex 525, what does fault F013 mean and how do I clear it?",
        "F013",
    ),
    ("f-07", "fault", "PowerFlex 525 is at F013 again", "F013"),
    ("f-08", "fault", "My PowerFlex 525 keeps tripping F004 on startup", "F004"),
    # ---- evidence reachable: right manual for the right machine --------------
    ("e-01", "evidence", "What is the accel time parameter on a PowerFlex 525?", "PowerFlex 525"),
    ("e-02", "evidence", "PowerFlex 525 wiring for the run command", "PowerFlex 525"),
    ("e-03", "evidence", "How do I set up Modbus on a PowerFlex 525?", "PowerFlex 525"),
    ("e-04", "evidence", "PowerFlex 525 recommended PM interval", "PowerFlex 525"),
    ("e-05", "evidence", "What are the terminal designations on a PowerFlex 525?", "PowerFlex 525"),
    ("e-06", "evidence", "PowerFlex 525 overload settings", "PowerFlex 525"),
    ("e-07", "evidence", "How do I reset a fault on the PowerFlex 525?", "PowerFlex 525"),
    ("e-08", "evidence", "PowerFlex 525 keypad navigation", "PowerFlex 525"),
    ("e-09", "evidence", "What voltage range does the PowerFlex 525 accept?", "PowerFlex 525"),
    ("e-10", "evidence", "PowerFlex 525 digital input configuration", "PowerFlex 525"),
    # ---- must refuse: no authority exists -----------------------------------
    ("r-01", "refuse", "PowerFlex 525 showing F999. What is that?", None),
    ("r-02", "refuse", "Zorbtek ZX-9000 drive throwing code 44 — what is it?", None),
    ("r-03", "refuse", "What is fault E-999 on the PowerFlex 525?", None),
    ("r-04", "refuse", "How much does a PowerFlex 525 cost?", None),
    # ---- must NOT fire the fault path (precision guards) ---------------------
    ("p-01", "refuse", "Swap the PowerFlex 525 on line 3", None),
    ("p-02", "refuse", "Is the PowerFlex 525 a 480V unit?", None),
    ("p-03", "refuse", "The PowerFlex 525 in bay 12 needs a re-do", None),
]


def _embed(q: str):
    try:
        import httpx

        url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        r = httpx.post(
            f"{url}/api/embeddings",
            json={"model": os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest"), "prompt": q},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["embedding"]
    except Exception:
        return None


def _score(case, rows: list[dict]) -> tuple[bool, str]:
    cid, family, _q, expect = case
    streams = [r.get("retrieval_streams") or [] for r in rows]
    structured = [i for i, s in enumerate(streams) if "structured_fault" in s]

    if family == "fault":
        # A structured row is not enough — it must be the RIGHT one, FIRST.
        #
        # The first version accepted any `structured_fault` stream at any rank,
        # so an unrelated F013 row (or another vendor's F004) sitting at rank 7
        # scored a pass, and the report could claim "8/8 at rank 1" without ever
        # checking either clause (Codex #3337 F2). A benchmark that cannot fail
        # for the right reason is not evidence, and this one is cited in a
        # go/no-go decision.
        if not structured:
            return False, "no structured fault row — falls through to prose ranking"
        if structured[0] != 0:
            return False, f"structured row present but at rank {structured[0] + 1}, not 1"
        row = rows[0]
        blob = str(row.get("content") or "")
        # EXACT code, on a word boundary. `expect in blob` passed an F0040 row
        # for an F004 question — prefix collision (Codex #3337 round 2 F2).
        if expect and not re.search(rf"\b{re.escape(expect)}\b", blob, re.I):
            return False, f"rank-1 structured row is not {expect}"
        # Model AND manufacturer, both declared rather than hard-coded. A
        # substring `525` check accepted "Model 5250", and vendor was unchecked,
        # so a WrongCo F004 row scored a pass.
        ident = f"{row.get('model_number') or ''} {row.get('manufacturer') or ''} {blob}"
        if not re.search(rf"\b{re.escape(EXPECT_MODEL)}\b", ident, re.I):
            return False, f"rank-1 row is not {EXPECT_MODEL} (got {row.get('model_number')!r})"
        if not re.search(re.escape(EXPECT_MANUFACTURER), ident, re.I):
            return (
                False,
                f"rank-1 row vendor is {row.get('manufacturer')!r}, not {EXPECT_MANUFACTURER}",
            )
        return True, f"{expect} structured_fault at rank 1"

    if family == "evidence":
        want = (expect or "").lower().replace(" ", "")
        hit = [
            i
            for i, r in enumerate(rows[:5])
            if want
            in (str(r.get("model_number") or "") + str(r.get("manufacturer") or ""))
            .lower()
            .replace(" ", "")
        ]
        if not hit:
            return False, "no right-model chunk in top-5"
        return True, f"right-model chunk at rank {hit[0] + 1}"

    # refuse: a structured row here would be a fabricated authority
    if structured:
        return False, "asserted a structured fault row for a code that should not resolve"
    return True, "no false authority"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--out", default="docs/testing/sellability/results.json")
    args = ap.parse_args()

    from shared.neon_recall import recall_knowledge  # noqa: PLC0415

    tenant = os.getenv("QUICKSTART_TENANT_ID") or os.getenv("MIRA_TENANT_ID")
    if not tenant:
        print("FATAL: no tenant (QUICKSTART_TENANT_ID / MIRA_TENANT_ID)")
        return 2

    records, lat = [], []
    print(f"{len(CASES)} cases x {args.repeats} run(s), tenant={tenant[:8]}…\n")
    for cid, family, q, expect in CASES:
        outcomes, notes = [], []
        for _ in range(args.repeats):
            t0 = time.time()
            rows = recall_knowledge(_embed(q), tenant, limit=args.limit, query_text=q) or []
            lat.append(time.time() - t0)
            ok, why = _score((cid, family, q, expect), rows)
            outcomes.append(ok)
            notes.append(why)
        stable = len(set(outcomes)) == 1
        passed = all(outcomes)
        records.append(
            {
                "id": cid,
                "family": family,
                "question": q,
                "passed": passed,
                "stable": stable,
                "outcomes": outcomes,
                "note": notes[-1],
            }
        )
        flag = "ok  " if passed else "FAIL"
        print(f"{flag} [{family:8}] {cid}  {notes[-1]:52} {'' if stable else '<UNSTABLE>'}")

    n = len(records)
    npass = sum(r["passed"] for r in records)
    nstable = sum(r["stable"] for r in records)
    by = {}
    for r in records:
        d = by.setdefault(r["family"], [0, 0])
        d[0] += 1
        d[1] += r["passed"]

    print(f"\n{'family':10} {'n':>3} {'pass':>5}  rate")
    for f, (t, p) in sorted(by.items()):
        print(f"{f:10} {t:3} {p:5}  {100 * p / t:.0f}%")
    print(f"\nOVERALL  {npass}/{n} ({100 * npass / n:.0f}%)   repeatable {nstable}/{n}")
    if lat:
        print(f"retrieval latency p50 {statistics.median(lat):.2f}s  max {max(lat):.2f}s")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"pass": npass, "total": n, "stable": nstable, "by_family": by, "cases": records},
            indent=2,
        )
    )
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
