#!/usr/bin/env python3
"""CLI entry point for MIRA synthetic user evaluation.

Usage examples:
    python tests/synthetic_user/run_synthetic_user.py --mode dry-run --count 50
    python tests/synthetic_user/run_synthetic_user.py --mode sidecar-only --count 100 --sidecar-url http://localhost:5000
    python tests/synthetic_user/run_synthetic_user.py --mode both --count 200 --seed 42

Exit code: 0 on success, 1 on error.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Repo root on sys.path — required for `tests.*` imports when run as a script.
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from tests.synthetic_user.evaluator import (  # noqa: E402
    EvaluatedResult,
    QuestionResult,
    evaluate_batch,
)
from tests.synthetic_user.runner import RunConfig, run_synthetic_user  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("run-synthetic-user")

_DEFAULT_OUTPUT = Path("tests/results/synthetic_user")


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def _write_json_report(
    results: list[QuestionResult],
    evaluated: list[EvaluatedResult],
    config: RunConfig,
    output_dir: Path,
    ts_str: str,
    llm_judgments: list | None = None,
) -> Path:
    """Write results to a JSON file and return its path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"run_{ts_str}.json"

    payload: dict = {
        "run_id": config.run_id,
        "timestamp": ts_str,
        "mode": config.mode,
        "count": config.count,
        "concurrency": config.concurrency,
        "seed": config.seed,
        "adversarial_ratio": config.adversarial_ratio,
        "total": len(results),
        "results": [],
    }

    for ev in evaluated:
        r = ev.result
        payload["results"].append(
            {
                "question_id": r.question_id,
                "question_text": r.question_text,
                "persona_id": r.persona_id,
                "topic_category": r.topic_category,
                "adversarial_category": r.adversarial_category,
                "equipment_type": r.equipment_type,
                "vendor": r.vendor,
                "path": r.path,
                "reply": r.reply,
                "confidence": r.confidence,
                "next_state": r.next_state,
                "sources": r.sources,
                "latency_ms": r.latency_ms,
                "error": r.error,
                "transcript": r.transcript,
                "turn_count": len(r.transcript) if r.transcript else 1,
                "weakness": ev.weakness.value,
                "ground_truth_score": ev.ground_truth_score,
                "faithfulness_score": ev.faithfulness_score,
                "keyword_matches": ev.keyword_matches,
                "details": ev.details,
            }
        )

    # LLM judge results (if available)
    if llm_judgments:
        judgment_map = {j.question_id: j for j in llm_judgments}
        payload["llm_judgments"] = [
            {
                "question_id": j.question_id,
                "scores": j.scores,
                "reasoning": j.reasoning,
                "overall_score": j.overall_score,
                "model_used": j.model_used,
                "latency_ms": j.latency_ms,
                "error": j.error,
            }
            for j in llm_judgments
        ]
        # Also embed overall_score into each result for easy correlation
        for entry in payload["results"]:
            j = judgment_map.get(entry["question_id"])
            if j:
                entry["llm_overall_score"] = j.overall_score

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, default=str)

    return path


def _write_markdown_report(
    evaluated: list[EvaluatedResult],
    config: RunConfig,
    output_dir: Path,
    ts_str: str,
) -> Path:
    """Write a Markdown summary report and return its path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"run_{ts_str}.md"

    total = len(evaluated)
    passed = sum(1 for ev in evaluated if ev.weakness.value == "pass")
    pass_rate = passed / total if total > 0 else 0.0

    # Weakness breakdown.
    buckets: dict[str, int] = {}
    for ev in evaluated:
        label = ev.weakness.value
        buckets[label] = buckets.get(label, 0) + 1

    # Average latency (exclude dry-run zeroes).
    latencies = [ev.result.latency_ms for ev in evaluated if ev.result.latency_ms > 0]
    avg_latency_ms = int(sum(latencies) / len(latencies)) if latencies else 0

    lines: list[str] = []
    lines.append("```")
    lines.append("=" * 55)
    lines.append(f"MIRA SYNTHETIC USER EVAL -- {ts_str[:10]}")
    lines.append("=" * 55)
    lines.append(f"Mode:          {config.mode}")
    lines.append(f"Questions:     {total}")
    lines.append(f"Passed:        {passed}  ({int(pass_rate * 100)}%)")
    lines.append(f"Avg latency:   {avg_latency_ms} ms")
    lines.append(f"Seed:          {config.seed}")
    lines.append(f"Adv ratio:     {config.adversarial_ratio:.0%}")
    lines.append("=" * 55)
    lines.append("```")
    lines.append("")
    lines.append("## Weakness Breakdown")
    lines.append("")
    lines.append("| Weakness | Count | % |")
    lines.append("|----------|-------|---|")

    for label, count in sorted(buckets.items(), key=lambda x: -x[1]):
        pct = int(count / total * 100) if total else 0
        lines.append(f"| {label} | {count} | {pct}% |")

    lines.append("")
    lines.append("## Case Results")
    lines.append("")
    lines.append("| ID | Persona | Topic | Path | Weakness | GT Score | Latency |")
    lines.append("|----|---------|-------|------|----------|----------|---------|")

    for ev in evaluated:
        r = ev.result
        gt = f"{ev.ground_truth_score:.2f}" if ev.ground_truth_score >= 0 else "N/A"
        lines.append(
            f"| {r.question_id[:8]} "
            f"| {r.persona_id} "
            f"| {r.topic_category} "
            f"| {r.path} "
            f"| {ev.weakness.value} "
            f"| {gt} "
            f"| {r.latency_ms}ms |"
        )

    lines.append("")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    return path


def _print_summary(
    evaluated: list[EvaluatedResult],
    config: RunConfig,
    llm_judgments: list | None = None,
) -> None:
    """Print a concise summary table to stdout."""
    total = len(evaluated)
    passed = sum(1 for ev in evaluated if ev.weakness.value == "pass")
    pass_rate = passed / total if total > 0 else 0.0

    buckets: dict[str, int] = {}
    for ev in evaluated:
        label = ev.weakness.value
        buckets[label] = buckets.get(label, 0) + 1

    print()
    print("=" * 55)
    print("MIRA SYNTHETIC USER EVAL")
    print("=" * 55)
    print(f"Mode         : {config.mode}")
    print(f"Questions    : {total}")
    print(f"Passed       : {passed}  ({int(pass_rate * 100)}%)")
    print("-" * 55)

    for label, count in sorted(buckets.items(), key=lambda x: -x[1]):
        pct = int(count / total * 100) if total else 0
        print(f"  {label:<35} {count:>4}  ({pct}%)")

    if llm_judgments:
        valid = [j for j in llm_judgments if j.error is None]
        if valid:
            avg_overall = sum(j.overall_score for j in valid) / len(valid)
            print("-" * 55)
            print(f"LLM Judge    : {len(valid)} scored ({llm_judgments[0].model_used})")
            print(f"Avg score    : {avg_overall:.2f}")
            for criterion_name in ("task_completion", "factual_accuracy",
                                   "safety_compliance", "conversation_coherence"):
                vals = [j.scores.get(criterion_name, 0) for j in valid]
                avg = sum(vals) / len(vals)
                print(f"  {criterion_name:<35} {avg:.2f}")

    print("=" * 55)
    print()


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="MIRA Synthetic User Evaluation CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python tests/synthetic_user/run_synthetic_user.py --mode dry-run --count 50\n"
            "  python tests/synthetic_user/run_synthetic_user.py --mode sidecar-only --count 100\n"
            "  python tests/synthetic_user/run_synthetic_user.py --mode both --count 200 --seed 42\n"
        ),
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="dry-run",
        choices=["dry-run", "bot-only", "sidecar-only", "both", "telethon"],
        help="Execution mode (default: dry-run)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=100,
        help="Number of questions to generate (default: 100)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help="Parallel sidecar requests (default: 5)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducibility (default: None)",
    )
    parser.add_argument(
        "--sidecar-url",
        type=str,
        default="http://localhost:5000",
        help="Sidecar base URL (default: http://localhost:5000)",
    )
    parser.add_argument(
        "--topics",
        type=str,
        default=None,
        help="Comma-separated topic filter (e.g. fault_codes,troubleshooting)",
    )
    parser.add_argument(
        "--personas",
        type=str,
        default=None,
        help="Comma-separated persona filter (e.g. senior_tech,apprentice)",
    )
    parser.add_argument(
        "--adversarial-ratio",
        type=float,
        default=0.3,
        help="Fraction of adversarial questions, 0.0–1.0 (default: 0.3)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(_DEFAULT_OUTPUT),
        help=f"Report output directory (default: {_DEFAULT_OUTPUT})",
    )
    # Telethon mode options
    parser.add_argument(
        "--bot-username",
        type=str,
        default="@MIRABot",
        help="Telegram bot username for telethon mode (default: @MIRABot)",
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=4,
        help="Max conversation turns in telethon mode (default: 4)",
    )
    parser.add_argument(
        "--telethon-timeout",
        type=int,
        default=60,
        help="Reply timeout in seconds for telethon mode (default: 60)",
    )
    # Evaluation mode
    parser.add_argument(
        "--eval-mode",
        type=str,
        default="rules",
        choices=["rules", "llm", "both"],
        help="Evaluation mode: rules (default), llm, or both",
    )
    parser.add_argument(
        "--max-judgments",
        type=int,
        default=None,
        help="Max conversations to LLM-judge (cost guard, default: all)",
    )
    # Scenario regression testing
    parser.add_argument(
        "--scenarios",
        type=str,
        default=None,
        help="Path to YAML scenario file for regression testing",
    )
    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def _main(args: argparse.Namespace) -> int:
    topics: list[str] | None = (
        [t.strip() for t in args.topics.split(",")] if args.topics else None
    )
    personas: list[str] | None = (
        [p.strip() for p in args.personas.split(",")] if args.personas else None
    )

    config = RunConfig(
        count=args.count,
        concurrency=args.concurrency,
        mode=args.mode,
        sidecar_url=args.sidecar_url,
        seed=args.seed,
        topics=topics,
        personas=personas,
        adversarial_ratio=args.adversarial_ratio,
        bot_username=args.bot_username,
        max_turns=args.max_turns,
        telethon_timeout=args.telethon_timeout,
    )

    logger.info(
        "Starting run: mode=%s count=%d seed=%s output=%s",
        config.mode,
        config.count,
        config.seed,
        args.output_dir,
    )

    # 1. Run synthetic questions.
    results: list[QuestionResult] = await run_synthetic_user(config)

    # 1b. Run scenario regression tests (if provided).
    if args.scenarios:
        try:
            from tests.synthetic_user.scenario_runner import load_scenarios, run_scenarios

            scenarios = load_scenarios(args.scenarios)
            scenario_results = await run_scenarios(scenarios, config)
            results.extend(scenario_results)
            logger.info("Ran %d scenarios, %d results", len(scenarios), len(scenario_results))
        except ImportError:
            logger.warning("scenario_runner not available — skipping scenarios")
        except Exception as exc:
            logger.error("Scenario runner failed: %s", exc)

    if not results:
        logger.error("No results returned — check mode and configuration")
        return 1

    # 2. Evaluate results (rule-based).
    evaluated: list[EvaluatedResult] = evaluate_batch(results)

    # 2b. LLM-as-judge evaluation (optional).
    llm_judgments: list | None = None
    if args.eval_mode in ("llm", "both"):
        try:
            from tests.synthetic_user.llm_judge import LLMJudge

            judge = LLMJudge()
            if judge.enabled:
                llm_judgments = await judge.judge_batch(
                    evaluated, max_judgments=args.max_judgments
                )
                logger.info("LLM judge scored %d conversations", len(llm_judgments))
            else:
                logger.warning("LLM judge requested but ANTHROPIC_API_KEY not set — skipping")
        except ImportError:
            logger.warning("llm_judge not available — skipping LLM evaluation")
        except Exception as exc:
            logger.error("LLM judge failed: %s", exc)

    # 3. Write reports.
    ts_str = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(args.output_dir)

    json_path = _write_json_report(
        results, evaluated, config, output_dir, ts_str, llm_judgments
    )
    md_path = _write_markdown_report(evaluated, config, output_dir, ts_str)

    logger.info("JSON report: %s", json_path)
    logger.info("Markdown report: %s", md_path)

    # 4. Print summary.
    _print_summary(evaluated, config, llm_judgments)

    return 0


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    sys.exit(asyncio.run(_main(args)))


if __name__ == "__main__":
    main()
