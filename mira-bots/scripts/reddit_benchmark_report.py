#!/usr/bin/env python3
"""Reddit Benchmark Report — Generate CSV + console summary from a benchmark run.

Usage:
    python mira-bots/scripts/reddit_benchmark_report.py --run-id 1
    python mira-bots/scripts/reddit_benchmark_report.py --run-id 1 --csv report.csv
"""

import argparse
import csv
import io
import logging
import os
import sys
from collections import Counter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("reddit-benchmark-report")

# Add mira-bots to path for shared imports
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.benchmark_db import get_run, list_results, list_runs  # noqa: E402


def generate_report(run_id: int, db_path: str | None = None) -> dict:
    """Generate a report for a given benchmark run.

    Returns {
        "run": dict,
        "summary": {
            "total", "errors", "confidence_distribution",
            "avg_latency_ms", "p95_latency_ms",
        },
        "results": [dict, ...],
        "console": str,
    }
    """
    run = get_run(run_id, db_path)
    if not run:
        return {"error": f"Run {run_id} not found"}

    results = list_results(run_id, db_path)
    if not results:
        return {"run": run, "summary": {}, "results": [], "console": "No results."}

    # Confidence distribution
    conf_counts = Counter(r.get("confidence", "unknown") or "unknown" for r in results)

    # Latency stats
    latencies = [r["latency_ms"] for r in results if r.get("latency_ms")]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else 0
    sorted_lat = sorted(latencies)
    p95_idx = int(len(sorted_lat) * 0.95) if sorted_lat else 0
    p95_latency = sorted_lat[min(p95_idx, len(sorted_lat) - 1)] if sorted_lat else 0

    error_count = sum(1 for r in results if r.get("error"))

    summary = {
        "total": len(results),
        "errors": error_count,
        "confidence_distribution": dict(conf_counts),
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": p95_latency,
    }

    # Console output
    lines = [
        f"=== Benchmark Run #{run_id} ===",
        f"Status:    {run.get('status', '?')}",
        f"Started:   {run.get('started_at', '?')}",
        f"Finished:  {run.get('finished_at', '?')}",
        f"Questions: {summary['total']}",
        f"Errors:    {summary['errors']}",
        "",
        "Confidence Distribution:",
    ]
    for level in ("high", "medium", "low", "none", "unknown"):
        count = conf_counts.get(level, 0)
        if count:
            pct = count / len(results) * 100
            bar = "#" * int(pct / 2)
            lines.append(f"  {level:8s} {count:3d} ({pct:5.1f}%) {bar}")

    lines.extend(
        [
            "",
            f"Avg latency:  {avg_latency:,} ms",
            f"P95 latency:  {p95_latency:,} ms",
            "",
            "--- Top 5 Results ---",
        ]
    )

    for r in results[:5]:
        title = (r.get("question_title") or "?")[:60]
        conf = r.get("confidence", "?")
        lat = r.get("latency_ms", 0)
        err = r.get("error", "")
        status = f"ERR: {err[:40]}" if err else f"conf={conf} lat={lat}ms"
        lines.append(f"  [{r.get('subreddit', '?'):20s}] {title}")
        lines.append(f"    {status}")

    console = "\n".join(lines)
    return {"run": run, "summary": summary, "results": results, "console": console}


def to_csv(results: list[dict]) -> str:
    """Convert results list to CSV string."""
    if not results:
        return ""
    buf = io.StringIO()
    fields = [
        "question_id",
        "question_title",
        "subreddit",
        "confidence",
        "latency_ms",
        "next_state",
        "error",
        "reply",
    ]
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in results:
        writer.writerow(r)
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Reddit Benchmark Report")
    parser.add_argument("--run-id", type=int, default=0, help="Benchmark run ID (0 = latest)")
    parser.add_argument("--csv", dest="csv_path", default="", help="Write CSV to this path")
    parser.add_argument("--db", default="", help="SQLite DB path override")
    args = parser.parse_args()

    db_path = args.db or os.getenv("MIRA_DB_PATH")

    run_id = args.run_id
    if run_id == 0:
        runs = list_runs(limit=1, db_path=db_path)
        if not runs:
            print("No benchmark runs found.")
            sys.exit(1)
        run_id = runs[0]["id"]

    report = generate_report(run_id, db_path)
    if "error" in report:
        print(f"Error: {report['error']}")
        sys.exit(1)

    print(report["console"])

    if args.csv_path:
        csv_data = to_csv(report["results"])
        with open(args.csv_path, "w", newline="") as f:
            f.write(csv_data)
        print(f"\nCSV written to {args.csv_path}")


if __name__ == "__main__":
    main()
