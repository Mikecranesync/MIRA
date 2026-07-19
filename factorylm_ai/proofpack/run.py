"""``factorylm_ai.proofpack`` CLI -- the Together experiments runner (handoff §10).

Usage::

    python -m factorylm_ai.proofpack --experiment all
    python -m factorylm_ai.proofpack --experiment e01 --live --budget-usd 0.50 --images-dir <dir>

Dry-run (no ``--live``) is the default everywhere: every experiment runs
against the mock provider, costs exactly $0.00, and is fully deterministic --
this is the only path CI ever exercises. ``--live`` additionally requires
``TOGETHERAI_API_KEY`` set AND ``FACTORYLM_AI_ALLOW_NETWORK`` truthy (the
spend-law network gate shared with ``providers/together.py``); without both,
``--live`` exits 2 with a clear message instead of silently downgrading to a
dry run. Every call -- live or mock -- is routed through a
:class:`~factorylm_ai.budget.BudgetGuard` and logged via
:func:`~factorylm_ai.telemetry.log_model_run` (see
``experiments._call_and_record``). A run always writes exactly one markdown
report (see ``report.py``) to ``--report-dir``; exit 0 means "ran and wrote a
report", not "every score passed" -- the report is the deliverable, scores
may still show failures.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from ..budget import BudgetGuard
from ..providers import get_provider
from . import experiments, report

logger = logging.getLogger("factorylm-ai")

_DEFAULT_REPORT_DIR = "factorylm_ai/proofpack/reports"
_FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _network_allowed() -> bool:
    # or-form is mandatory (repo env-parsing law): a compose-mapped
    # ${FACTORYLM_AI_ALLOW_NETWORK:-} delivers "".
    return (os.getenv("FACTORYLM_AI_ALLOW_NETWORK") or "").lower() in {"1", "true"}


def _api_key_present() -> bool:
    return bool(os.getenv("TOGETHERAI_API_KEY") or "")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m factorylm_ai.proofpack",
        description=(
            "Run the ZTA proofpack experiments (e01-e04) dry-run (default: "
            "mock provider, $0, deterministic) or --live (together, "
            "budget-capped, network-gated)."
        ),
    )
    parser.add_argument(
        "--experiment",
        choices=[*experiments.ALL_EXPERIMENT_IDS, "all"],
        default="all",
        help="Which experiment to run (default: all).",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        default=False,
        help=(
            "Run against the together provider instead of the mock. Requires "
            "TOGETHERAI_API_KEY set AND FACTORYLM_AI_ALLOW_NETWORK truthy "
            "(1/true) -- neither is ever set in CI, by design."
        ),
    )
    parser.add_argument(
        "--budget-usd",
        type=float,
        default=None,
        help=(
            "Hard dollar cap for this invocation. Default: "
            "FACTORYLM_AI_BUDGET_USD env var, or 1.00 if unset "
            "(see factorylm_ai.budget.BudgetGuard)."
        ),
    )
    parser.add_argument(
        "--report-dir",
        default=_DEFAULT_REPORT_DIR,
        help=f"Directory to write the markdown report to (default: {_DEFAULT_REPORT_DIR}).",
    )
    parser.add_argument(
        "--images-dir",
        default=None,
        help="Directory of real case images for e01. Required for a --live e01 run.",
    )
    return parser


async def _run_selected_experiments(args: argparse.Namespace) -> int:
    provider_name = "together" if args.live else "mock"
    provider = get_provider(provider_name)
    budget = BudgetGuard(cap_usd=args.budget_usd)

    selected = (
        list(experiments.ALL_EXPERIMENT_IDS) if args.experiment == "all" else [args.experiment]
    )
    images_dir = Path(args.images_dir) if args.images_dir else None

    results: list[experiments.ExperimentResult] = []
    for exp_id in selected:
        fn = experiments.EXPERIMENTS[exp_id]
        result = await fn(
            provider,
            budget,
            fixtures_dir=_FIXTURES_DIR,
            live=args.live,
            images_dir=images_dir,
        )
        results.append(result)
        logger.info(
            "proofpack %s: cases=%d scored=%d cost_usd=%.5f",
            exp_id,
            result["cases"],
            result["scored"],
            result["cost_usd"],
        )

    report_path = report.write_report(
        results,
        args.report_dir,
        live=args.live,
        provider_name=provider.name,
        budget_cap_usd=budget.cap_usd,
        budget_spent_usd=budget.spent_usd,
    )
    print(f"factorylm_ai.proofpack: wrote report to {report_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns a process exit code (0/2) -- never raises for
    a user-facing input error; only :mod:`asyncio.run` propagates an
    unexpected internal exception.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.live and not (_api_key_present() and _network_allowed()):
        print(
            "factorylm_ai.proofpack: --live requires TOGETHERAI_API_KEY set AND "
            "FACTORYLM_AI_ALLOW_NETWORK truthy (1/true). Neither is set in CI by "
            "design (spend law) -- set both explicitly to spend real money, or "
            "drop --live to run the free, deterministic mock dry-run.",
            file=sys.stderr,
        )
        return 2

    return asyncio.run(_run_selected_experiments(args))
