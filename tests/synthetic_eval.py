#!/usr/bin/env python3
"""MIRA Synthetic Evaluation Runner — Master orchestrator for all 5 regimes.

Usage:
    python tests/synthetic_eval.py --regimes 1,2,3,4 --threshold 0.80
    python tests/synthetic_eval.py --regimes all --full-judge
    python tests/synthetic_eval.py --regimes 1 --mode dry-run
    python tests/synthetic_eval.py --regimes 3 --mode offline --output results/

Exit code: 0 if overall pass rate >= threshold, 1 otherwise.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Add repo root to path
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tests.scoring.composite import CaseResult, RunResult, aggregate_run
from tests.scoring.thresholds import DEFAULT_THRESHOLD
from tests.reporting.json_results import write_run_json, write_aggregate_json
from tests.reporting.markdown_report import write_eval_report

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("synthetic-eval")

TESTS_DIR = Path(__file__).parent
DEFAULT_OUTPUT = TESTS_DIR / "results"

# Regime name mapping
REGIME_MAP = {
    "1": "regime1_telethon",
    "2": "regime2_rag",
    "3": "regime3_nameplate",
    "4": "regime4_synthetic",
    "5": "regime5_nemotron",
}


def _check_prerequisites(regime: str, mode: str = "dry-run") -> tuple[bool, str]:
    """Check if a regime's prerequisites are met."""
    if regime == "regime5_nemotron" and mode not in ("dry-run", "offline"):
        if not os.getenv("NVIDIA_API_KEY"):
            return False, "NVIDIA_API_KEY not set — Regime 5 blocked for live mode"
    return True, ""


async def _run_regime(
    regime: str,
    mode: str = "dry-run",
) -> RunResult:
    """Run a single regime and return aggregated results."""
    logger.info("Running %s (mode=%s)...", regime, mode)
    t0 = time.monotonic()
    run_id = str(uuid.uuid4())[:8]
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    results: list[CaseResult] = []

    if regime == "regime1_telethon":
        from tests.regime1_telethon.test_replay_loop import regime1_runner
        results = await regime1_runner(
            mode=mode,
            bot_username=os.getenv("TELEGRAM_BOT_USERNAME", "@MIRABot"),
            timeout=int(os.getenv("TELEGRAM_TEST_TIMEOUT", "60")),
            ingest_url=os.getenv("MIRA_INGEST_URL", "http://localhost:8002"),
        )
    elif regime == "regime2_rag":
        from tests.regime2_rag.test_retrieval_precision import regime2_runner
        results = await regime2_runner(mode=mode)
    elif regime == "regime3_nameplate":
        from tests.regime3_nameplate.test_ocr_accuracy import regime3_runner
        results = await regime3_runner(mode=mode)
    elif regime == "regime4_synthetic":
        from tests.regime4_synthetic.test_tiered_questions import regime4_runner
        results = await regime4_runner(mode=mode)
    elif regime == "regime5_nemotron":
        from tests.regime5_nemotron.test_bulk_qa import regime5_runner
        results = await regime5_runner(mode=mode)
    else:
        logger.error("Unknown regime: %s", regime)

    duration = time.monotonic() - t0
    run = aggregate_run(run_id, ts, regime, results, duration)

    logger.info(
        "  %s: %d/%d PASS (%d%%) in %.1fs",
        regime, run.passed_cases, run.total_cases,
        int(run.pass_rate * 100), duration,
    )
    return run


async def run_all(
    regimes: list[str],
    mode: str = "dry-run",
    threshold: float = DEFAULT_THRESHOLD,
    output_dir: Path = DEFAULT_OUTPUT,
) -> list[RunResult]:
    """Run multiple regimes and generate reports."""
    runs: list[RunResult] = []

    for regime in regimes:
        ok, msg = _check_prerequisites(regime, mode=mode)
        if not ok:
            logger.warning("Skipping %s: %s", regime, msg)
            continue

        run = await _run_regime(regime, mode=mode)
        runs.append(run)

        # Write per-regime JSON
        write_run_json(run, output_dir / regime)

    if not runs:
        logger.error("No regimes were run")
        return runs

    # Write aggregate JSON
    write_aggregate_json(runs, output_dir)

    # Write Markdown report
    report_path = write_eval_report(runs, output_dir, threshold=threshold)
    logger.info("Report: %s", report_path)

    # Print banner
    _print_banner(runs, threshold)

    return runs


def _print_banner(runs: list[RunResult], threshold: float) -> None:
    """Print the evaluation banner to stdout."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_cases = sum(r.total_cases for r in runs)
    total_passed = sum(r.passed_cases for r in runs)
    overall_rate = total_passed / total_cases if total_cases > 0 else 0.0
    status = "PASS" if overall_rate >= threshold else "FAIL"

    print()
    print("=" * 50)
    print(f"FACTORYLM EVAL -- {ts}")
    print("=" * 50)

    for run in runs:
        pct = int(run.pass_rate * 100)
        avg = run.avg_latency_ms / 1000 if run.avg_latency_ms else 0.0

        if run.regime == "regime4_synthetic":
            tier_summary = ""
            if run.results and run.results[0].metadata.get("tier_summary"):
                tier_summary = run.results[0].metadata["tier_summary"]
            print(f"Regime 4 Question Evolution: {tier_summary}")
        else:
            labels = {
                "regime1_telethon": "Regime 1 Telethon Replay:",
                "regime2_rag": "Regime 2 RAG Triplets:",
                "regime3_nameplate": "Regime 3 Nameplate Vision:",
                "regime5_nemotron": "Regime 5 Nemotron Generated:",
            }
            label = labels.get(run.regime, run.regime)
            print(f"{label:<35} {run.passed_cases}/{run.total_cases} PASS  ({pct}%)  avg {avg:.1f}s")

    print("=" * 50)
    print(f"OVERALL: {int(overall_rate * 100)}% | THRESHOLD: {int(threshold * 100)}% | STATUS: {status}")
    print("=" * 50)
    print()


def main():
    parser = argparse.ArgumentParser(
        description="MIRA Synthetic Evaluation Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--regimes", type=str, default="1,2,3,4",
        help="Comma-separated regime numbers (1-5) or 'all' (default: 1,2,3,4)",
    )
    parser.add_argument(
        "--mode", type=str, default="dry-run",
        choices=["dry-run", "offline", "http", "telethon", "live"],
        help="Execution mode (default: dry-run)",
    )
    parser.add_argument(
        "--threshold", type=float, default=DEFAULT_THRESHOLD,
        help=f"Overall pass threshold (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--output", type=str, default=str(DEFAULT_OUTPUT),
        help=f"Output directory (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--full-judge", action="store_true",
        help="Enable LLM-as-judge scoring (slower, requires ANTHROPIC_API_KEY)",
    )
    args = parser.parse_args()

    # Parse regimes
    if args.regimes == "all":
        regime_keys = ["1", "2", "3", "4", "5"]
    else:
        regime_keys = [r.strip() for r in args.regimes.split(",")]

    regimes = []
    for k in regime_keys:
        if k in REGIME_MAP:
            regimes.append(REGIME_MAP[k])
        else:
            logger.error("Unknown regime: %s (valid: 1-5 or 'all')", k)
            sys.exit(2)

    # Map mode aliases
    mode = args.mode
    if mode == "live":
        mode = "telethon"

    output_dir = Path(args.output)
    runs = asyncio.run(run_all(regimes, mode=mode, threshold=args.threshold, output_dir=output_dir))

    # Exit code based on overall pass rate
    if not runs:
        sys.exit(1)

    total = sum(r.total_cases for r in runs)
    passed = sum(r.passed_cases for r in runs)
    overall = passed / total if total > 0 else 0.0

    sys.exit(0 if overall >= args.threshold else 1)


if __name__ == "__main__":
    main()
