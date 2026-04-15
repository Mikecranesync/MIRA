#!/usr/bin/env python3
"""MIRA Offline Test Harness — v3.4.0

Runs the diagnostic pipeline entirely in-process.  No VPS, no Docker, no SSH.
LLM calls go to real providers (Groq / Claude / Gemini) via API keys.
NeonDB recall is live (hosted separately from VPS).

Quick-start (from repo root):
    # Load secrets first:
    doppler run --project factorylm --config prd -- python3 tests/eval/offline_run.py --suite full

Usage
-----
  # Test one photo — drop a nameplate image and see extracted fields + FSM
  python3 tests/eval/offline_run.py --photo tests/eval/fixtures/photos/pilz_pnoz_x3.jpg

  # Fire a synthetic conversation — no fixtures needed
  python3 tests/eval/offline_run.py \\
      --scenario "Yaskawa V1000 OC fault, resetting doesn't help" \\
      --synthetic-user

  # Full nightly-equivalent run in ~2 min, with LLM-as-judge
  python3 tests/eval/offline_run.py --suite full --judge

  # Text fixtures only (fast — no vision)
  python3 tests/eval/offline_run.py --suite text

  # Photo fixtures only
  python3 tests/eval/offline_run.py --suite photos

  # Diff current branch vs main (requires clean git state)
  python3 tests/eval/offline_run.py --suite text --diff vs-main

Environment (via Doppler or shell export):
  ANTHROPIC_API_KEY   Claude provider
  GROQ_API_KEY        Groq provider (preferred for synthetic user)
  NEON_DATABASE_URL   NeonDB RAG recall
  MIRA_TENANT_ID      Tenant for NeonDB scoping
  EVAL_DISABLE_JUDGE  Set to "1" to skip judge even with --judge flag
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ── Repo root + path setup ────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

import yaml  # noqa: E402

from tests.eval.grader import ScenarioGrade, grade_scenario  # noqa: E402
from tests.eval.judge import DIMENSIONS, Judge, JudgeResult  # noqa: E402
from tests.eval.local_pipeline import LocalPipeline, image_to_b64, _PHOTOS_DIR  # noqa: E402

# ── Rich display ──────────────────────────────────────────────────────────────

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.text import Text
    from rich import box
    _HAS_RICH = True
except ImportError:
    _HAS_RICH = False

_console = Console() if _HAS_RICH else None

logger = logging.getLogger("mira-offline-run")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# ── Paths ─────────────────────────────────────────────────────────────────────

_FIXTURES_DIR = Path(__file__).parent / "fixtures"
_PHOTOS_FIXTURES_DIR = _FIXTURES_DIR / "photos"
_RUNS_DIR = Path(__file__).parent / "runs"

# ── Fixture loaders ───────────────────────────────────────────────────────────


def _load_text_fixtures() -> list[dict]:
    """Load standard numbered + VFD fixtures (same pattern as run_eval.py)."""
    fixtures = []
    seen: set[str] = set()
    candidates = sorted(
        list(_FIXTURES_DIR.glob("[0-9][0-9]_*.yaml"))
        + list(_FIXTURES_DIR.glob("vfd_*.yaml"))
    )
    for path in candidates:
        if str(path) in seen:
            continue
        seen.add(str(path))
        with open(path) as f:
            fixture = yaml.safe_load(f)
        if "id" not in fixture:
            continue
        fixture["_path"] = str(path)
        fixtures.append(fixture)
    return fixtures


def _load_photo_fixtures() -> list[dict]:
    """Load photo fixtures from fixtures/photos/*.yaml."""
    fixtures = []
    for path in sorted(_PHOTOS_FIXTURES_DIR.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with open(path) as f:
            fixture = yaml.safe_load(f)
        if "id" not in fixture:
            continue
        fixture["_path"] = str(path)
        fixture["_is_photo"] = True
        fixtures.append(fixture)
    return fixtures


# ── Photo one-off mode ────────────────────────────────────────────────────────


async def run_photo_oneof(pipeline: LocalPipeline, photo_path: Path) -> None:
    """Ingest a single photo and print extracted fields + diagnostic response."""
    _print_header(f"Photo Analysis: {photo_path.name}")

    if not photo_path.exists():
        _print_error(f"File not found: {photo_path}")
        return

    photo_b64 = image_to_b64(photo_path)
    chat_id = f"photo-oneof-{uuid.uuid4().hex[:8]}"

    t0 = time.monotonic()
    _print_info(f"Sending photo ({photo_path.stat().st_size // 1024}KB) to engine...")

    reply, status, latency = await pipeline.call(chat_id, "What is this?", photo_b64)
    elapsed = int((time.monotonic() - t0) * 1000)

    if _HAS_RICH:
        panel = Panel(
            reply,
            title=f"[bold]MIRA Response[/bold] — HTTP {status}  {latency}ms",
            border_style="green" if status == 200 else "red",
        )
        _console.print(panel)
    else:
        print(f"\n=== MIRA Response (HTTP {status}, {latency}ms) ===")
        print(reply)
        print("=" * 60)

    fsm = pipeline.fsm_state(chat_id)
    _print_kv("FSM state", fsm)
    _print_kv("Total time", f"{elapsed}ms")


# ── Scenario one-off mode ─────────────────────────────────────────────────────


async def run_scenario_oneof(
    pipeline: LocalPipeline,
    scenario: str,
    use_synthetic_user: bool,
    judge: Judge | None,
) -> None:
    """Kick off a synthetic or scripted conversation from a seed string."""
    from tests.eval.synthetic_user import run_synthetic_conversation  # noqa: PLC0415

    _print_header(f"Scenario: {scenario[:80]}")

    if use_synthetic_user:
        _print_info("Running synthetic user conversation...")
        result = await run_synthetic_conversation(
            pipeline, scenario, max_turns=8, verbose=False
        )
        _print_transcript(result["transcript"])
        _print_kv("Final FSM state", result["final_fsm_state"])
        _print_kv("Turns", str(result["turns"]))

        # Judge last response if requested
        if judge and not judge.disabled and result["transcript"]:
            mira_turns = [t for t in result["transcript"] if t["role"] == "mira"]
            user_turns = [t for t in result["transcript"] if t["role"] == "user"]
            if mira_turns and user_turns:
                jr = judge.grade(
                    response=mira_turns[-1]["content"],
                    rag_context="",
                    user_question=user_turns[-1]["content"],
                    generated_by="unknown",
                    scenario_id="synthetic",
                )
                _print_judge_result(jr)
    else:
        # Non-synthetic: just send the seed as a single message
        chat_id = f"scenario-{uuid.uuid4().hex[:8]}"
        reply, status, latency = await pipeline.call(chat_id, scenario)
        if _HAS_RICH:
            _console.print(Panel(reply, title=f"MIRA — HTTP {status}  {latency}ms",
                                 border_style="green" if status == 200 else "red"))
        else:
            print(f"\n{reply}")
        _print_kv("FSM state", pipeline.fsm_state(chat_id))


# ── Suite runner ──────────────────────────────────────────────────────────────


async def run_suite(
    pipeline: LocalPipeline,
    fixtures: list[dict],
    judge: Judge | None,
    use_synthetic_user: bool,
) -> tuple[list[ScenarioGrade], list[JudgeResult | None], float]:
    """Run all fixtures in the suite.  Returns (grades, judge_results, total_seconds)."""
    from tests.eval.synthetic_user import run_synthetic_conversation  # noqa: PLC0415

    grades: list[ScenarioGrade] = []
    judge_results: list[JudgeResult | None] = []
    t_start = time.monotonic()

    total = len(fixtures)
    for idx, fixture in enumerate(fixtures, 1):
        scenario_id = fixture["id"]
        is_photo = fixture.get("_is_photo", False)
        _print_progress(idx, total, scenario_id, is_photo)

        if use_synthetic_user and not is_photo:
            # Use synthetic user instead of scripted turns
            seed = fixture.get("description", fixture["id"])
            result = await run_synthetic_conversation(
                pipeline, seed, max_turns=fixture.get("max_turns", 6), verbose=False
            )
            # Build compatible structure for grader
            responses = [t["content"] for t in result["transcript"] if t["role"] == "mira"]
            http_statuses = [t.get("http_status", 200) for t in result["transcript"] if t["role"] == "mira"]
            latencies_ms = [t.get("latency_ms", 0) for t in result["transcript"] if t["role"] == "mira"]
            final_state = result["final_fsm_state"]
            user_turn_count = result["turns"]
        else:
            # Standard scripted fixture run
            responses, http_statuses, latencies_ms, final_state = await pipeline.run_scenario(
                fixture, chat_id_prefix="offline"
            )
            user_turn_count = len([t for t in fixture.get("turns", []) if t["role"] == "user"])

        grade = grade_scenario(
            fixture=fixture,
            final_fsm_state=final_state,
            responses=responses,
            latencies_ms=latencies_ms,
            http_statuses=http_statuses,
            user_turn_count=user_turn_count,
        )
        grades.append(grade)

        # Photo-specific grading (vendor/model extraction)
        if is_photo and fixture.get("photo_expected"):
            _grade_photo_extraction(grade, fixture, responses)

        # Judge
        jr: JudgeResult | None = None
        if judge and not judge.disabled and responses:
            user_turns = [t for t in fixture.get("turns", []) if t["role"] == "user"]
            last_user = user_turns[-1]["content"] if user_turns else fixture.get("description", "")
            jr = judge.grade(
                response=responses[-1],
                rag_context="",
                user_question=last_user,
                generated_by=fixture.get("judge_generated_by", "unknown"),
                scenario_id=scenario_id,
            )
        judge_results.append(jr)

        _print_scenario_result(grade, jr)

    return grades, judge_results, time.monotonic() - t_start


# ── Photo extraction grader ───────────────────────────────────────────────────


def _grade_photo_extraction(grade: ScenarioGrade, fixture: dict, responses: list[str]) -> None:
    """Add pass/fail notes for vendor/model extraction from photo responses."""
    expected = fixture.get("photo_expected", {})
    if not expected or not responses:
        return

    first_response = responses[0].lower()
    notes = []

    ev = (expected.get("vendor") or "").lower()
    if ev and ev not in first_response:
        notes.append(f"vendor '{expected['vendor']}' not found in response")
    elif ev:
        notes.append(f"vendor '{expected['vendor']}' OK")

    em = (expected.get("model") or "").lower()
    if em and em not in first_response:
        notes.append(f"model '{expected['model']}' not found in response")
    elif em:
        notes.append(f"model '{expected['model']}' OK")

    if notes:
        # Append to grade error field for display (non-blocking, doesn't affect pass/fail)
        grade.error = " | ".join(notes)


# ── Scorecard ─────────────────────────────────────────────────────────────────


def write_offline_scorecard(
    grades: list[ScenarioGrade],
    judge_results: list[JudgeResult | None],
    total_seconds: float,
    suite: str,
    prev_path: Path | None,
) -> Path:
    """Write a markdown scorecard and return the path."""
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    output_path = _RUNS_DIR / f"{run_date}-offline-{suite}.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    total = len(grades)
    passed = sum(1 for g in grades if g.passed)
    has_judge = any(jr is not None and jr.succeeded for jr in judge_results)

    lines = [
        f"# MIRA Offline Eval — {run_date}",
        "",
        f"**Suite:** {suite}  |  **Pass rate:** {passed}/{total} ({100*passed//total if total else 0}%)",
        f"**Mode:** offline in-process  |  **Judge:** {'enabled' if has_judge else 'disabled'}",
        f"**Total runtime:** {total_seconds:.1f}s",
        "",
    ]

    # Results table
    judge_header = " | ".join(["Grnd", "Help", "Tone", "Inst"]) if has_judge else ""
    header = "| Scenario | FSM | RState | KeyKW | No5xx | TurnBudget | CitGrond"
    sep = "|----------|-----|--------|-------|-------|------------|--------"
    if has_judge:
        header += " | " + judge_header
        sep += "|" + "|".join([":----:"] * 4)
    header += " | Score |"
    sep += "|-------|"
    lines += ["## Results", "", header, sep]

    jr_iter = iter(judge_results)
    for g in grades:
        jr = next(jr_iter, None)
        cps = [c.passed for c in g.checkpoints]
        cp_cells = " | ".join("✓" if p else "✗" for p in cps)
        judge_cells = ""
        if has_judge and jr and jr.succeeded:
            judge_cells = " | " + " | ".join(
                str(jr.scores.get(d, "—")) for d in DIMENSIONS
            )
        mark = "✓" if g.passed else "✗"
        row = f"| `{g.scenario_id}` {mark} | {cp_cells}{judge_cells} | {g.score} |"
        lines.append(row)

    lines.append("")

    # Failures
    failures = [g for g in grades if not g.passed]
    if failures:
        lines += ["## Failures", ""]
        for g in failures:
            lines.append(f"### {g.scenario_id}")
            for cp in g.checkpoints:
                if not cp.passed:
                    lines.append(f"- **{cp.name}**: {cp.reason}")
            if g.error:
                lines.append(f"- Photo extraction: {g.error}")
            lines.append("")

    # Judge summary
    if has_judge:
        scored = [jr for jr in judge_results if jr and jr.succeeded]
        if scored:
            avg = {d: sum(jr.scores[d] for jr in scored) / len(scored) for d in DIMENSIONS}
            agg = "  ".join(f"{d[:4]}={avg[d]:.1f}" for d in DIMENSIONS)
            lines += ["## Judge Summary", "", f"**Averages:** {agg}", ""]

    # Regression diff vs previous run
    if prev_path and prev_path.exists():
        import re
        prev_text = prev_path.read_text()
        prev_passing = set(re.findall(r"`([\w_]+)` ✓", prev_text))
        curr_passing = {g.scenario_id for g in grades if g.passed}
        regressions = prev_passing - curr_passing
        recoveries = curr_passing - prev_passing
        if regressions:
            lines += ["## Regressions", ""]
            for sid in sorted(regressions):
                lines.append(f"- {sid}")
            lines.append("")
        if recoveries:
            lines += ["## Recoveries", ""]
            for sid in sorted(recoveries):
                lines.append(f"- {sid}")
            lines.append("")

    lines += [
        "---",
        f"*Generated by `offline_run.py` at {datetime.now(timezone.utc).isoformat()}*",
    ]

    output_path.write_text("\n".join(lines) + "\n")
    return output_path


# ── Rich display helpers ──────────────────────────────────────────────────────


def _print_header(title: str) -> None:
    if _HAS_RICH:
        _console.rule(f"[bold cyan]{title}[/bold cyan]")
    else:
        print(f"\n{'='*60}\n{title}\n{'='*60}")


def _print_info(msg: str) -> None:
    if _HAS_RICH:
        _console.print(f"[dim]{msg}[/dim]")
    else:
        print(f"  {msg}")


def _print_error(msg: str) -> None:
    if _HAS_RICH:
        _console.print(f"[bold red]ERROR:[/bold red] {msg}")
    else:
        print(f"ERROR: {msg}", file=sys.stderr)


def _print_kv(key: str, value: str) -> None:
    if _HAS_RICH:
        _console.print(f"  [bold]{key}:[/bold] {value}")
    else:
        print(f"  {key}: {value}")


def _print_progress(idx: int, total: int, scenario_id: str, is_photo: bool) -> None:
    tag = "[photo]" if is_photo else ""
    if _HAS_RICH:
        _console.print(
            f"[dim]({idx}/{total})[/dim] [bold]{scenario_id}[/bold] "
            f"[cyan]{tag}[/cyan]"
        )
    else:
        print(f"  ({idx}/{total}) {scenario_id} {tag}")


def _print_scenario_result(grade: ScenarioGrade, jr: JudgeResult | None) -> None:
    passed = grade.passed
    score_str = grade.score
    judge_str = ""
    if jr and jr.succeeded:
        judge_str = f"  judge_avg={jr.average:.1f}"

    if _HAS_RICH:
        color = "green" if passed else "red"
        mark = "✓" if passed else "✗"
        _console.print(
            f"    [{color}]{mark}[/{color}] {score_str} FSM={grade.final_fsm_state}"
            f"{judge_str}"
            + (f"\n    [dim]{grade.error}[/dim]" if grade.error else "")
        )
    else:
        mark = "PASS" if passed else "FAIL"
        print(f"    {mark} {score_str} FSM={grade.final_fsm_state}{judge_str}")
        if grade.error:
            print(f"    {grade.error}")


def _print_transcript(transcript: list[dict]) -> None:
    if _HAS_RICH:
        for t in transcript:
            role = t["role"]
            content = t["content"][:400]
            latency = t.get("latency_ms", 0)
            if role == "mira":
                latency_str = f" ({latency}ms)" if latency else ""
                _console.print(f"  [bold cyan]MIRA{latency_str}:[/bold cyan] {content}")
            else:
                _console.print(f"  [bold yellow]Tech:[/bold yellow] {content}")
            _console.print()
    else:
        for t in transcript:
            role = "MIRA" if t["role"] == "mira" else "Tech"
            print(f"  [{role}] {t['content'][:400]}")
            print()


def _print_judge_result(jr: JudgeResult) -> None:
    if jr.error:
        _print_error(f"Judge error: {jr.error}")
        return
    if _HAS_RICH:
        dim_str = "  ".join(
            f"[bold]{d[:4]}=[/bold]{jr.scores.get(d, '?')}" for d in DIMENSIONS
        )
        _console.print(f"\n  [bold]Judge scores:[/bold] {dim_str}  avg={jr.average:.1f}")
    else:
        print(f"\n  Judge: {jr.scores}  avg={jr.average:.1f}")


def _print_final_summary(
    grades: list[ScenarioGrade],
    judge_results: list[JudgeResult | None],
    total_seconds: float,
    scorecard_path: Path,
) -> None:
    total = len(grades)
    passed = sum(1 for g in grades if g.passed)
    failures = [g for g in grades if not g.passed]

    if _HAS_RICH:
        _console.rule("[bold]Summary[/bold]")
        color = "green" if passed == total else ("yellow" if passed > total * 0.8 else "red")
        _console.print(
            f"  [{color}]{passed}/{total} PASSED[/{color}]"
            f"  |  {total_seconds:.1f}s total"
        )
        if failures:
            _console.print(f"  [red]Failures:[/red] {', '.join(g.scenario_id for g in failures[:5])}")
        has_judge = any(jr and jr.succeeded for jr in judge_results)
        if has_judge:
            scored = [jr for jr in judge_results if jr and jr.succeeded]
            avg = sum(jr.average for jr in scored) / len(scored)
            _console.print(f"  Judge avg: {avg:.2f}/5.0")
        _console.print(f"  Scorecard: [link]{scorecard_path}[/link]")
    else:
        print(f"\n{'='*60}")
        print(f"RESULT: {passed}/{total} passed  ({total_seconds:.1f}s)")
        if failures:
            print(f"Failures: {', '.join(g.scenario_id for g in failures[:5])}")
        print(f"Scorecard: {scorecard_path}")


# ── main ──────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="MIRA offline test harness — no VPS required",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--suite",
        choices=["text", "photos", "full"],
        default="text",
        help="Fixture suite to run (default: text)",
    )
    p.add_argument(
        "--judge",
        action="store_true",
        help="Run LLM-as-judge on every response",
    )
    p.add_argument(
        "--synthetic-user",
        action="store_true",
        dest="synthetic_user",
        help="Replace scripted turns with synthetic LLM-backed technician",
    )
    p.add_argument(
        "--photo",
        metavar="PATH",
        help="Quick one-off: ingest one photo, print extracted fields",
    )
    p.add_argument(
        "--scenario",
        metavar="SEED",
        help='Quick one-off: kick a conversation (e.g. "Yaskawa V1000 OC fault")',
    )
    p.add_argument(
        "--diff",
        metavar="vs-main",
        help="Compare results vs previous scorecard (pass 'vs-main' or a path)",
    )
    p.add_argument(
        "--db",
        metavar="PATH",
        default=None,
        help="SQLite path for FSM state (default: /tmp/mira-offline-test.db)",
    )
    p.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable engine INFO logging",
    )
    return p


async def _async_main(args: argparse.Namespace) -> int:
    # ── Pipeline init ──────────────────────────────────────────────────────────
    _print_header("MIRA Offline Test Harness")
    _print_info(
        f"backend={os.getenv('INFERENCE_BACKEND', 'cloud')}  "
        f"neon={'ok' if os.getenv('NEON_DATABASE_URL') else 'MISSING'}  "
        f"anthropic={'ok' if os.getenv('ANTHROPIC_API_KEY') else 'MISSING'}  "
        f"groq={'ok' if os.getenv('GROQ_API_KEY') else 'MISSING'}"
    )

    pipeline = LocalPipeline(db_path=args.db, verbose=args.verbose)

    # ── Quick one-off: photo ───────────────────────────────────────────────────
    if args.photo:
        await run_photo_oneof(pipeline, Path(args.photo))
        return 0

    # ── Quick one-off: scenario ────────────────────────────────────────────────
    if args.scenario:
        judge = Judge() if args.judge else None
        await run_scenario_oneof(pipeline, args.scenario, args.synthetic_user, judge)
        return 0

    # ── Suite run ──────────────────────────────────────────────────────────────
    fixtures: list[dict] = []
    suite = args.suite

    if suite in ("text", "full"):
        text_fixtures = _load_text_fixtures()
        _print_info(f"Loaded {len(text_fixtures)} text fixtures")
        fixtures.extend(text_fixtures)

    if suite in ("photos", "full"):
        photo_fixtures = _load_photo_fixtures()
        _print_info(f"Loaded {len(photo_fixtures)} photo fixtures")
        fixtures.extend(photo_fixtures)

    if not fixtures:
        _print_error("No fixtures found — check fixtures/ directory")
        return 1

    judge = Judge() if (args.judge and not os.getenv("EVAL_DISABLE_JUDGE") == "1") else None
    if judge and not judge.disabled:
        _print_info("LLM-as-judge enabled")

    # Find previous scorecard for diff
    prev_path: Path | None = None
    if args.diff:
        existing = sorted(_RUNS_DIR.glob(f"*offline-{suite}*.md"))
        if existing:
            prev_path = existing[-1]
            _print_info(f"Comparing against: {prev_path.name}")

    _print_header(f"Running {len(fixtures)} fixtures ({suite} suite)")

    grades, judge_results, total_seconds = await run_suite(
        pipeline, fixtures, judge, args.synthetic_user
    )

    scorecard_path = write_offline_scorecard(
        grades, judge_results, total_seconds, suite, prev_path
    )

    _print_final_summary(grades, judge_results, total_seconds, scorecard_path)

    failures = sum(1 for g in grades if not g.passed)
    return 1 if failures else 0


def main() -> int:
    args = _build_parser().parse_args()
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    sys.exit(main())
