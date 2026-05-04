#!/usr/bin/env python3
"""Prejudged Benchmark Report — Per-case + aggregate report from a prejudged run.

Usage:
    python mira-bots/scripts/prejudged_benchmark_report.py --run-id 1
    python mira-bots/scripts/prejudged_benchmark_report.py --run-id 1 --csv report.csv
    python mira-bots/scripts/prejudged_benchmark_report.py  # latest run
"""

import argparse
import csv
import io
import json
import logging
import os
import sys
from collections import Counter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("prejudged-benchmark-report")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.benchmark_db import (  # noqa: E402
    get_prejudged_run,
    list_prejudged_conversations,
    list_prejudged_runs,
)


def generate_report(run_id: int, db_path: str | None = None) -> dict:
    """Generate a report for a prejudged benchmark run.

    Returns {
        "run": dict,
        "summary": {...},
        "conversations": [dict, ...],
        "console": str,
    }
    """
    run = get_prejudged_run(run_id, db_path)
    if not run:
        return {"error": f"Run {run_id} not found"}

    convs = list_prejudged_conversations(run_id, db_path)
    if not convs:
        return {"run": run, "summary": {}, "conversations": [], "console": "No results."}

    # Verdict distribution
    verdict_counts = Counter(c.get("verdict") or "unknown" for c in convs)

    # Score stats
    scores = [c["composite_score"] for c in convs if c.get("composite_score") is not None]
    avg_score = sum(scores) / len(scores) if scores else 0.0
    min_score = min(scores) if scores else 0.0
    max_score = max(scores) if scores else 0.0

    # Dimension averages
    dims = [
        "evidence_utilization",
        "path_efficiency",
        "gsd_compliance",
        "root_cause_alignment",
        "expert_comparison",
    ]
    dim_avgs = {}
    for d in dims:
        vals = [c[d] for c in convs if c.get(d) is not None]
        dim_avgs[d] = sum(vals) / len(vals) if vals else 0.0

    # Turn stats
    turns = [c["turn_count"] for c in convs if c.get("turn_count")]
    avg_turns = sum(turns) / len(turns) if turns else 0.0

    # Diagnosis rate
    diag_count = sum(1 for c in convs if c.get("reached_diagnosis"))
    diag_rate = diag_count / len(convs) * 100 if convs else 0.0

    # Latency
    latencies = [c["total_latency_ms"] for c in convs if c.get("total_latency_ms")]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else 0

    error_count = sum(1 for c in convs if c.get("error"))

    summary = {
        "total": len(convs),
        "errors": error_count,
        "avg_score": round(avg_score, 2),
        "min_score": round(min_score, 2),
        "max_score": round(max_score, 2),
        "verdict_distribution": dict(verdict_counts),
        "dimension_averages": {k: round(v, 2) for k, v in dim_avgs.items()},
        "avg_turns": round(avg_turns, 1),
        "diagnosis_rate": round(diag_rate, 1),
        "avg_latency_ms": avg_latency,
    }

    # Console output
    lines = [
        f"=== Prejudged Benchmark Run #{run_id} ===",
        f"Status:         {run.get('status', '?')}",
        f"Started:        {run.get('started_at', '?')}",
        f"Finished:       {run.get('finished_at', '?')}",
        f"Cases:          {summary['total']}",
        f"Errors:         {summary['errors']}",
        f"Diagnosis Rate: {summary['diagnosis_rate']}%",
        f"Avg Turns:      {summary['avg_turns']}",
        f"Avg Latency:    {summary['avg_latency_ms']:,} ms",
        "",
        f"=== Composite Score: {summary['avg_score']:.2f} / 10.0 ===",
        f"  Min: {summary['min_score']:.2f}  Max: {summary['max_score']:.2f}",
        "",
        "Dimension Averages:",
    ]
    dim_labels = {
        "evidence_utilization": "Evidence Utilization",
        "path_efficiency": "Path Efficiency",
        "gsd_compliance": "GSD Compliance",
        "root_cause_alignment": "Root Cause Alignment",
        "expert_comparison": "Expert Comparison",
    }
    weights = {
        "evidence_utilization": 0.20,
        "path_efficiency": 0.20,
        "gsd_compliance": 0.25,
        "root_cause_alignment": 0.25,
        "expert_comparison": 0.10,
    }
    for d in dims:
        val = dim_avgs.get(d, 0.0)
        w = weights[d]
        bar = "#" * int(val)
        lines.append(f"  {dim_labels[d]:25s} {val:5.2f} (w={w:.2f}) {bar}")

    lines.extend(["", "Verdict Distribution:"])
    for verdict in ("excellent", "good", "acceptable", "poor", "failed", "unknown"):
        count = verdict_counts.get(verdict, 0)
        if count:
            pct = count / len(convs) * 100
            bar = "#" * int(pct / 2)
            lines.append(f"  {verdict:12s} {count:3d} ({pct:5.1f}%) {bar}")

    lines.extend(["", "--- Per-Case Results ---"])
    for c in convs:
        title = (c.get("case_title") or "?")[:45]
        verdict = c.get("verdict", "?")
        score = c.get("composite_score", 0) or 0
        turns_used = c.get("turn_count", 0)
        diag = "Y" if c.get("reached_diagnosis") else "N"
        err = c.get("error", "")
        diff = c.get("difficulty", "?")

        if err:
            status = f"ERR: {err[:40]}"
        else:
            status = f"score={score:.1f} verdict={verdict} turns={turns_used} diag={diag}"

        lines.append(f"  [{diff:6s}] {title}")
        lines.append(f"    {status}")

        reasoning = c.get("judge_reasoning", "")
        if reasoning:
            lines.append(f"    Judge: {reasoning[:100]}")

    console = "\n".join(lines)
    return {"run": run, "summary": summary, "conversations": convs, "console": console}


def to_csv(conversations: list[dict]) -> str:
    """Convert conversations to CSV string."""
    if not conversations:
        return ""
    buf = io.StringIO()
    fields = [
        "case_id",
        "case_title",
        "equipment_type",
        "difficulty",
        "turn_count",
        "reached_diagnosis",
        "final_state",
        "evidence_utilization",
        "path_efficiency",
        "gsd_compliance",
        "root_cause_alignment",
        "expert_comparison",
        "composite_score",
        "verdict",
        "total_latency_ms",
        "error",
        "judge_reasoning",
    ]
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for c in conversations:
        writer.writerow(c)
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Prejudged Benchmark Report")
    parser.add_argument("--run-id", type=int, default=0, help="Run ID (0 = latest)")
    parser.add_argument("--csv", dest="csv_path", default="", help="Write CSV to this path")
    parser.add_argument(
        "--json", dest="json_path", default="", help="Write JSON summary to this path"
    )
    parser.add_argument("--db", default="", help="SQLite DB path override")
    args = parser.parse_args()

    db_path = args.db or os.getenv("MIRA_DB_PATH")

    run_id = args.run_id
    if run_id == 0:
        runs = list_prejudged_runs(limit=1, db_path=db_path)
        if not runs:
            print("No prejudged benchmark runs found.")
            sys.exit(1)
        run_id = runs[0]["id"]

    report = generate_report(run_id, db_path)
    if "error" in report:
        print(f"Error: {report['error']}")
        sys.exit(1)

    print(report["console"])

    if args.csv_path:
        csv_data = to_csv(report["conversations"])
        with open(args.csv_path, "w", newline="") as f:
            f.write(csv_data)
        print(f"\nCSV written to {args.csv_path}")

    if args.json_path:
        with open(args.json_path, "w") as f:
            json.dump(report["summary"], f, indent=2)
        print(f"JSON written to {args.json_path}")


if __name__ == "__main__":
    main()
