#!/usr/bin/env python3
"""Aggregate a chunked prejudged benchmark run into the eval report shape.

Usage:
    py -3 aggregate.py <run_db.sqlite> <run_log.txt>

Reads per-case judge scores from the run DB (latest conversation per case wins)
and sums exact Together call/token usage from the per-case "judge_usage" JSON
blocks the runner prints. Dollar cost = tokens x the rate constant below —
tokens are measured, the rate is the published price at freeze time.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys

# Together published rate for meta-llama/Llama-3.3-70B-Instruct-Turbo at freeze
# time (2026-08-03): $0.88 per 1M tokens, input and output.
RATE_PER_MTOK = 0.88

DIMENSIONS = [
    "evidence_utilization",
    "path_efficiency",
    "gsd_compliance",  # result key kept for history; rubric text = DIALOGUE MODE
    "root_cause_alignment",
    "expert_comparison",
]


def main() -> None:
    db_path, log_path = sys.argv[1], sys.argv[2]
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    # Latest conversation per case (chunked runs create one run_id per case;
    # a re-run of a case supersedes the earlier row).
    rows = db.execute(
        """
        SELECT c.* FROM prejudged_conversations c
        JOIN (SELECT case_id, MAX(id) AS mid FROM prejudged_conversations GROUP BY case_id) m
          ON c.case_id = m.case_id AND c.id = m.mid
        ORDER BY c.case_id
        """
    ).fetchall()

    print(f"cases scored: {len(rows)}")
    print()
    hdr = ["case", "turns", "diag"] + [d[:8] for d in DIMENSIONS] + ["composite", "verdict"]
    print(" | ".join(hdr))
    for r in rows:
        cells = [str(r["case_id"]), str(r["turn_count"]), str(r["reached_diagnosis"])]
        cells += [f"{r[d]:.1f}" if r[d] is not None else "-" for d in DIMENSIONS]
        cells += [
            f"{r['composite_score']:.2f}" if r["composite_score"] is not None else "-",
            r["verdict"] or "-",
        ]
        print(" | ".join(cells))

    print()
    for d in DIMENSIONS + ["composite_score"]:
        vals = [r[d] for r in rows if r[d] is not None]
        if vals:
            print(f"mean {d}: {sum(vals) / len(vals):.3f}  (n={len(vals)})")

    # Exact usage from the per-case summary JSONs in the log.
    text = open(log_path, encoding="utf-8", errors="replace").read()
    usages = [json.loads(m) for m in re.findall(r'"judge_usage": (\{[^}]*\})', text)]
    calls = sum(u.get("calls", 0) for u in usages)
    ptok = sum(u.get("prompt_tokens", 0) for u in usages)
    ctok = sum(u.get("completion_tokens", 0) for u in usages)
    cost = (ptok + ctok) / 1_000_000 * RATE_PER_MTOK
    print()
    print(f"together usage: {calls} calls, {ptok} prompt tok, {ctok} completion tok")
    print(f"cost at ${RATE_PER_MTOK}/Mtok: ${cost:.4f}")


if __name__ == "__main__":
    main()
