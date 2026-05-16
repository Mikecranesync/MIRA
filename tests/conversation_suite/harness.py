"""CLI entry point for the MIRA conversation testing suite.

Usage:
    python -m tests.conversation_suite.harness --mode=mock --report=md
    python -m tests.conversation_suite.harness --mode=live --report=html
    python -m tests.conversation_suite.harness --filter=category:safety -v
    python -m tests.conversation_suite.harness --filter=id:gs10_wiring_01

Spec: docs/specs/mira-conversation-testing-spec.md
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from .evaluator import evaluate
from .report import write_report
from .runner import discover_fixtures, run_all

REPORTS_DIR = Path(__file__).parent / "runs"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="conversation-suite",
        description="Run MIRA conversation fixtures against Supervisor.process().",
    )
    p.add_argument(
        "--mode",
        choices=["mock", "live"],
        default="mock",
        help="mock (deterministic, no API) or live (real cascade). Default: mock.",
    )
    p.add_argument(
        "--report",
        choices=["md", "html", "jsonl", "none"],
        default="md",
        help="Output format. Default: md.",
    )
    p.add_argument(
        "--filter",
        default="",
        help="Filter spec: category:NAME, id:NAME, or tag:NAME.",
    )
    p.add_argument(
        "--platform",
        choices=["harness", "telegram", "slack", "hub"],
        default="harness",
        help="Platform string passed to Supervisor.process(). Use for adapter-parity testing.",
    )
    p.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Number of scenarios to run in parallel. Default: 1 (state-safe).",
    )
    p.add_argument(
        "--out",
        default=str(REPORTS_DIR),
        help=f"Output directory for the report. Default: {REPORTS_DIR}.",
    )
    p.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose logging."
    )
    return p


async def _run(args: argparse.Namespace) -> int:
    fixtures = discover_fixtures(args.filter)
    if not fixtures:
        print(f"No fixtures matched filter: {args.filter!r}", file=sys.stderr)
        return 2

    print(
        f"Running {len(fixtures)} scenario(s) — mode={args.mode}, "
        f"platform={args.platform}, concurrency={args.concurrency}"
    )
    runs = await run_all(
        fixtures,
        mode=args.mode,
        platform=args.platform,
        concurrency=args.concurrency,
    )
    grades = [evaluate(r) for r in runs]

    passed = sum(1 for g in grades if g.passed)
    safety_viols = sum(
        1
        for g in grades
        for cp in g.checkpoints
        if cp.name in ("hard_fail_safety", "hard_fail_plc_write") and not cp.passed
    )

    if args.report != "none":
        path = write_report(
            runs, grades, mode=args.mode, fmt=args.report, out_dir=Path(args.out)
        )
        print(f"Report: {path}")

    print(
        f"\nResults: {passed}/{len(grades)} passed "
        f"({(passed / max(len(grades), 1)) * 100:.0f}%), "
        f"safety_violations={safety_viols}"
    )

    if safety_viols > 0:
        return 3
    if passed < len(grades):
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
