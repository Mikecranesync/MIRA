"""
run_ingest_test.py — 100-case direct ingest endpoint validator.

Hits localhost:8002/ingest/photo directly (no Telegram, no Telethon).
Loads test_manifest_100.yaml, runs all cases, scores via judge.py,
writes report_100.md + results_100.json via report.py.

Usage:
    python3 run_ingest_test.py --all
    python3 run_ingest_test.py --cases vfd_overcurrent_01 plc_io_failure_21
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx
import yaml

# Allow running from repo root or from telegram_test_runner/
_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE))

import judge
import report as report_module

_MIRA_SERVER = os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost")
INGEST_URL = os.getenv("INGEST_URL", f"{_MIRA_SERVER}:8002/ingest/photo")
MANIFEST_PATH = _HERE / "test_manifest_100.yaml"
ARTIFACTS_DIR = str(_HERE.parent / "artifacts")


def load_manifest(case_filter: list[str] | None = None) -> list[dict]:
    with open(MANIFEST_PATH) as f:
        data = yaml.safe_load(f)
    cases = data.get("cases", [])
    if case_filter:
        cases = [c for c in cases if c["name"] in case_filter]
    return cases


def run_case(case: dict, client: httpx.Client) -> tuple[str | None, float]:
    """POST one case to the ingest endpoint. Returns (reply_text, elapsed_seconds)."""
    image_path = _HERE / case["image"]
    caption = case.get("caption", "")
    asset_tag = case.get("name", "test")

    try:
        with open(image_path, "rb") as img_file:
            image_bytes = img_file.read()

        t0 = time.monotonic()
        resp = client.post(
            INGEST_URL,
            files={"image": (image_path.name, image_bytes, "image/jpeg")},
            data={"asset_tag": asset_tag, "notes": caption},
            timeout=60,
        )
        elapsed = time.monotonic() - t0
        resp.raise_for_status()

        body = resp.json()
        # ingest endpoint returns {"description": "...", ...}
        reply_text = body.get("description") or body.get("reply") or str(body)
        return reply_text, elapsed

    except Exception as exc:
        print(f"  ERROR on {case['name']}: {exc}")
        return None, 0.0


def main():
    parser = argparse.ArgumentParser(description="Run 100-case ingest validation")
    parser.add_argument("--all", action="store_true", help="Run all 100 cases")
    parser.add_argument("--cases", nargs="+", metavar="NAME", help="Run specific cases by name")
    args = parser.parse_args()

    if not args.all and not args.cases:
        parser.print_help()
        sys.exit(1)

    case_filter = args.cases if args.cases else None
    cases = load_manifest(case_filter)

    if not cases:
        print("No cases matched. Check manifest path or case names.")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"MIRA 100-Case Ingest Validation")
    print(f"Endpoint: {INGEST_URL}")
    print(f"Cases to run: {len(cases)}")
    print(f"{'='*60}\n")

    results = []
    total = len(cases)
    window_pass = 0
    window_size = 10

    with httpx.Client() as client:
        for i, case in enumerate(cases, 1):
            print(f"[{i:3}/{total}] {case['name']} ... ", end="", flush=True)
            reply, elapsed = run_case(case, client)
            result = judge.score(case, reply, elapsed)
            result["reply"] = reply or ""
            result["caption"] = case.get("caption", "")
            result["scenario_type"] = case.get("scenario_type", "fault")
            result["fault_category"] = case.get("expected", {}).get("fault_category", "UNKNOWN")
            results.append(result)

            status = "PASS ✅" if result["passed"] else f"FAIL ❌ [{result['failure_bucket']}]"
            print(f"{status}  ({result['word_count']}w, {elapsed:.1f}s)")

            window_pass += 1 if result["passed"] else 0

            # Progress report every 10 cases
            if i % window_size == 0:
                start = i - window_size + 1
                print(f"\n  --- Cases {start}–{i}: {window_pass}/{window_size} pass ---\n")
                window_pass = 0

    # Final summary
    total_pass = sum(1 for r in results if r["passed"])
    pass_rate = total_pass / total * 100
    avg_words = sum(r["word_count"] for r in results) / total
    avg_elapsed = sum(r["elapsed"] for r in results) / total

    # Category breakdown
    by_cat: dict[str, dict] = {}
    for r in results:
        cat = r["fault_category"]
        if cat not in by_cat:
            by_cat[cat] = {"pass": 0, "total": 0}
        by_cat[cat]["total"] += 1
        if r["passed"]:
            by_cat[cat]["pass"] += 1

    print(f"\n{'='*60}")
    print(f"FINAL RESULTS: {total_pass}/{total} pass ({pass_rate:.1f}%)")
    print(f"Avg word count: {avg_words:.1f}  |  Avg response time: {avg_elapsed:.1f}s")
    print(f"{'='*60}")
    print(f"\nResults by category:")
    for cat, counts in sorted(by_cat.items()):
        cat_rate = counts['pass'] / counts['total'] * 100
        print(f"  {cat:<20} {counts['pass']}/{counts['total']}  ({cat_rate:.0f}%)")

    # Bucket breakdown
    buckets: dict[str, int] = {}
    for r in results:
        if not r["passed"] and r["failure_bucket"]:
            b = r["failure_bucket"]
            buckets[b] = buckets.get(b, 0) + 1
    if buckets:
        print(f"\nFailure buckets:")
        for b, cnt in sorted(buckets.items(), key=lambda x: -x[1]):
            print(f"  {b:<30} {cnt}")

    # Write report
    report_module.write_report(
        results=results,
        bot_username="mira-ingest",
        dry_run=False,
        artifacts_dir=ARTIFACTS_DIR,
        output_prefix="100",
    )

    # Verdict
    print(f"\n{'='*60}")
    if pass_rate >= 95:
        print(f"TARGET MET ✅  {pass_rate:.1f}% ≥ 95% — field ready")
    elif pass_rate >= 90:
        print(f"COMMIT THRESHOLD MET ⚠️  {pass_rate:.1f}% ≥ 90% — commit with notes")
    else:
        print(f"BELOW THRESHOLD ❌  {pass_rate:.1f}% < 90% — diagnose and fix before commit")
    print(f"{'='*60}\n")

    sys.exit(0 if pass_rate >= 90 else 1)


if __name__ == "__main__":
    main()
