#!/usr/bin/env python3
"""Run the 10 golden-question benchmark against staging mira-pipeline via Tailscale.

Avoids the SSH+docker-exec path the bash version uses. Hits
http://100.68.120.99:4099/v1/chat/completions directly over Tailscale —
factorylm-prod's Tailnet IP is reachable from this Windows host without
SSH or firewall hops.

Output mirrors tools/bench-staging-pipeline.sh format. Writes raw JSON
to /tmp/bench-staging-<date>/ and a CSV at
tests/golden_staging_benchmark_<date>.csv.

A `quality_score` heuristic (0-5) is computed from groundedness signals
so we can compare against the 2026-05-20 baseline (3.64/5):
  +1 for any source-citation marker ([n], "source:", "p.N", "page N")
  +1 if response length > 200 chars
  +1 if response references a known equipment family (PowerFlex, GS10/11,
       Micro820, Marathon, Modbus, VFD)
  +1 if response avoids hedging-only ("I don't have information")
  +1 if response contains action-oriented steps (steps, check, verify,
       set, configure)
Capped at 5.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

URL = "http://100.68.120.99:4099/v1/chat/completions"

QUESTIONS = [
    "What are the modbus parameters for the GS11 drive?",
    "How do I wire RS-485 between a Micro820 and GS10?",
    "What is the default baud rate for the PowerFlex 525 serial port?",
    "My conveyor prox sensor shows occupied too long, what should I check?",
    "What are the fault codes for the GS10 VFD?",
    "How do I set up Modbus communication on the Micro820?",
    "What maintenance intervals does the Marathon Y56C motor require?",
    "I need the wiring diagram for panel E-12",
    "What safety procedures should I follow before working on a VFD?",
    "Compare the GS10 and GS11 drives",
]

CITE_RE = re.compile(r"\[\d+\]|source:|cite|p\.\d+|page \d+", re.IGNORECASE)
PAGE_RE = re.compile(r"p\.\d+|page \d+", re.IGNORECASE)
EQUIP_RE = re.compile(r"powerflex|gs10|gs11|micro820|marathon|modbus|vfd", re.IGNORECASE)
HEDGE_RE = re.compile(r"don't have|do not have|no information|cannot find", re.IGNORECASE)
ACTION_RE = re.compile(r"\b(steps?|check|verify|set|configure|wire|connect|measure|inspect)\b", re.IGNORECASE)


def score_answer(ans: str) -> int:
    if not ans:
        return 0
    s = 0
    if CITE_RE.search(ans):
        s += 1
    if len(ans) > 200:
        s += 1
    if EQUIP_RE.search(ans):
        s += 1
    if not HEDGE_RE.search(ans) or len(ans) > 500:
        s += 1
    if ACTION_RE.search(ans):
        s += 1
    return min(s, 5)


def post(payload: dict, timeout: int = 90) -> dict:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    api_key = os.getenv("PIPELINE_API_KEY", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    today = dt.date.today().isoformat()
    out_dir = Path(os.environ.get("TEMP", "/tmp")) / f"bench-staging-{today}"
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_path = Path("tests") / f"golden_staging_benchmark_{today}.csv"
    csv_path.parent.mkdir(exist_ok=True)

    rows = []
    for i, q in enumerate(QUESTIONS, start=1):
        print(f"[bench] Q{i}: {q}")
        payload = {
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": q}],
        }
        try:
            resp = post(payload)
        except Exception as e:
            resp = {"error": str(e)}
        (out_dir / f"q{i}.json").write_text(json.dumps(resp, indent=2))

        try:
            ans = resp["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            ans = resp.get("error", "(no content)")
        ans_clean = (ans or "").replace("\n", " ").replace('"', '""')
        cites = len(CITE_RE.findall(ans))
        pages = len(PAGE_RE.findall(ans))
        score = score_answer(ans)
        rows.append((i, q, ans_clean, cites, pages, score))

    header = "idx,question,channel,answer,cites_sources,page_numbers,grounded_vs_generic,quality_score,notes\n"
    with csv_path.open("w", encoding="utf-8") as fh:
        fh.write(header)
        for i, q, a, c, p, s in rows:
            fh.write(f'{i},"{q}",staging-pipeline,"{a}",{c},{p},,{s},\n')

    avg = sum(r[5] for r in rows) / len(rows) if rows else 0.0
    print()
    print(f"raw JSON: {out_dir}")
    print(f"CSV:      {csv_path}")
    print(f"avg quality score: {avg:.2f}/5 (baseline 2026-05-20: 3.64/5)")
    return 0 if avg >= 3.5 else 1


if __name__ == "__main__":
    sys.exit(main())
