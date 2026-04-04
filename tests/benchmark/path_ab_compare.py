"""Path A vs Path B benchmark harness.

Runs 20 maintenance queries through both inference paths and records
response text, latency, and tier used. Outputs a comparison table for
blind quality scoring.

Usage:
  python tests/benchmark/path_ab_compare.py \
    --path-a-url http://localhost:5000 \
    --path-b-url http://charlie:5000

Environment:
  ANTHROPIC_API_KEY must be set for Path A (Claude) queries.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Benchmark queries — 20 real maintenance scenarios
# ---------------------------------------------------------------------------

BENCHMARK_QUERIES = [
    # Fault code lookups (Tier 1 candidates)
    "What does fault code OC mean on a GS20 VFD?",
    "PowerFlex 525 fault F047 — what is it and how do I clear it?",
    "Allen-Bradley Micro820 red fault LED blinking — what does that indicate?",
    "What does alarm code AL-03 mean on a Grundfos CR pump controller?",
    # Procedure lookups
    "How to reset a GS10 VFD after an overcurrent trip?",
    "Steps to check motor winding resistance with a megger?",
    "Procedure for aligning a coupled centrifugal pump?",
    "How to replace a contactor on a motor starter?",
    # Work order / PM queries
    "Create a work order for pump P-204 bearing replacement",
    "What PM tasks are due this week for conveyor C-12?",
    "When was the last oil change on compressor K-301?",
    # Simple knowledge lookups
    "What is the rated FLA for a 10HP 460V motor?",
    "What wire size for a 30A branch circuit at 480V?",
    "What torque spec for 1/2-13 Grade 5 bolts?",
    # Complex RCA queries (Tier 2/3 candidates)
    "Intermittent overcurrent trips on conveyor C-12 main drive that correlate "
    "with ambient temperature above 95F but only during afternoon shift. "
    "Motor current is 18A on a 20A drive. What should I investigate?",
    "Centrifugal pump P-204 has increasing vibration on the drive end bearing. "
    "Readings went from 0.15 to 0.45 ips over three weeks. The pump was "
    "realigned six months ago. What could be causing this trend?",
    "We have recurring seal failures on reactor vessel agitator A-101. "
    "Three failures in the last year. Mechanical seals, Plan 11 flush. "
    "What is the most likely root cause?",
    "VFD is tripping on overvoltage during deceleration. Decel time is set to "
    "5 seconds. Motor is 25HP. No braking resistor installed. What are my options?",
    # Multi-step diagnostic
    "My PLC is showing a comm loss error to a remote I/O rack. The rack is "
    "on EtherNet/IP. Other devices on the same switch are working. "
    "Walk me through troubleshooting this.",
    # Safety-adjacent
    "I see burn marks on a wire terminal in a motor control center. "
    "What should I do before investigating further?",
]


async def query_path(
    client: httpx.AsyncClient,
    base_url: str,
    query: str,
    endpoint: str = "/rag",
    force_tier: str | None = None,
) -> dict:
    """Send a query to a MIRA sidecar instance and return the result."""
    url = f"{base_url.rstrip('/')}{endpoint}"

    if endpoint == "/route":
        payload = {
            "query": query,
            "asset_id": "benchmark",
            "user_id": "benchmark",
            "tag_snapshot": {},
        }
        if force_tier:
            payload["force_tier"] = force_tier
    else:
        payload = {"query": query, "asset_id": "benchmark", "tag_snapshot": {}}

    t0 = time.monotonic()
    try:
        resp = await client.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {
            "response": data.get("response") or data.get("answer", ""),
            "latency_ms": elapsed_ms,
            "tier_used": data.get("tier_used", "path_a"),
            "model": data.get("model", ""),
            "error": "",
        }
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {
            "response": "",
            "latency_ms": elapsed_ms,
            "tier_used": "error",
            "model": "",
            "error": str(e),
        }


async def run_benchmark(
    path_a_url: str,
    path_b_url: str,
    output_dir: str,
) -> None:
    """Run all benchmark queries through both paths."""
    results = []
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    async with httpx.AsyncClient() as client:
        for i, query in enumerate(BENCHMARK_QUERIES, 1):
            print(f"[{i:2d}/{len(BENCHMARK_QUERIES)}] {query[:80]}...")

            # Path A: RAG endpoint (Claude backend)
            path_a_result = await query_path(client, path_a_url, query, endpoint="/rag")

            # Path B: Route endpoint (tier routing)
            path_b_result = await query_path(client, path_b_url, query, endpoint="/route")

            results.append(
                {
                    "query_id": i,
                    "query": query,
                    "path_a_response": path_a_result["response"],
                    "path_a_latency_ms": path_a_result["latency_ms"],
                    "path_a_tier": path_a_result["tier_used"],
                    "path_a_model": path_a_result["model"],
                    "path_a_error": path_a_result["error"],
                    "path_b_response": path_b_result["response"],
                    "path_b_latency_ms": path_b_result["latency_ms"],
                    "path_b_tier": path_b_result["tier_used"],
                    "path_b_model": path_b_result["model"],
                    "path_b_error": path_b_result["error"],
                    "quality_a": "",  # Filled in manually during blind scoring
                    "quality_b": "",
                }
            )

    # Write results
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # JSON (full data)
    json_file = out_path / f"benchmark_{timestamp}.json"
    json_file.write_text(json.dumps(results, indent=2))

    # CSV (for spreadsheet scoring)
    csv_file = out_path / f"benchmark_{timestamp}.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)

    # Summary table
    print("\n" + "=" * 80)
    print(f"BENCHMARK COMPLETE — {len(results)} queries")
    print("=" * 80)
    print(f"{'#':>3}  {'Path A ms':>10}  {'Path B ms':>10}  {'B Tier':>8}  {'B Faster?':>10}")
    print("-" * 80)

    b_faster = 0
    for r in results:
        faster = r["path_b_latency_ms"] < r["path_a_latency_ms"]
        if faster:
            b_faster += 1
        print(
            f"{r['query_id']:3d}  {r['path_a_latency_ms']:10d}  "
            f"{r['path_b_latency_ms']:10d}  {r['path_b_tier']:>8}  "
            f"{'YES' if faster else 'no':>10}"
        )

    print("-" * 80)
    print(f"Path B faster on {b_faster}/{len(results)} queries")
    print(f"\nResults: {json_file}")
    print(f"Scoring: {csv_file}")
    print("\nNext: blind-score quality_a and quality_b columns (1-5 scale) in the CSV.")


def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA Path A vs Path B benchmark")
    parser.add_argument(
        "--path-a-url",
        default="http://localhost:5000",
        help="Path A sidecar URL (default: http://localhost:5000)",
    )
    parser.add_argument(
        "--path-b-url",
        default="http://100.70.49.126:5000",
        help="Path B sidecar URL on Charlie (default: http://100.70.49.126:5000)",
    )
    parser.add_argument(
        "--output-dir",
        default="tests/benchmark/results",
        help="Output directory for results (default: tests/benchmark/results)",
    )
    args = parser.parse_args()

    asyncio.run(run_benchmark(args.path_a_url, args.path_b_url, args.output_dir))


if __name__ == "__main__":
    main()
