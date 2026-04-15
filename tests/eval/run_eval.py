#!/usr/bin/env python3
"""MIRA Eval Runner — v2.6.0 with LLM-as-judge.

Fires each scenario fixture through mira-pipeline, runs 5 binary checkpoints,
optionally calls an LLM-as-judge for four quality dimensions, and writes a
markdown scorecard to tests/eval/runs/.

Usage (from repo root on VPS):
    # Against live VPS pipeline (via docker exec — no port mapping required):
    python3 tests/eval/run_eval.py

    # With judge enabled (same as above — judge is on by default):
    python3 tests/eval/run_eval.py

    # Disable judge (hourly cheap mode):
    EVAL_DISABLE_JUDGE=1 python3 tests/eval/run_eval.py

    # Against a local pipeline (dev):
    PIPELINE_URL=http://localhost:9099 python3 tests/eval/run_eval.py

    # Dry run (no actual HTTP calls — sanity check fixture loading):
    python3 tests/eval/run_eval.py --dry-run

    # Custom output dir:
    python3 tests/eval/run_eval.py --output /tmp/eval-runs

Environment:
    PIPELINE_URL         Default: uses docker exec (VPS mode). Set to http://host:port for direct.
    PIPELINE_API_KEY     Bearer token (optional; auth is skipped if unset on server side).
    EVAL_CHAT_PREFIX     Prefix for chat_id isolation (default: "eval").
    MIRA_DB_PATH         Path to mira.db SQLite (default: /opt/mira/data/mira.db on VPS).
    DOCKER_CONTAINER     Container name for docker-exec mode (default: mira-pipeline-saas).
    EVAL_DISABLE_JUDGE   Set to "1" to skip LLM-as-judge (hourly fast mode).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Resolve repo root (script lives at tests/eval/run_eval.py)
REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tests.eval.grader import ScenarioGrade, grade_scenario  # noqa: E402
from tests.eval.judge import DIMENSIONS, Judge, JudgeResult  # noqa: E402

logger = logging.getLogger("mira-eval")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Configuration ─────────────────────────────────────────────────────────────

PIPELINE_URL = os.getenv("PIPELINE_URL", "")  # empty = docker-exec mode
PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY", "")
EVAL_CHAT_PREFIX = os.getenv("EVAL_CHAT_PREFIX", "eval")
MIRA_DB_PATH = os.getenv("MIRA_DB_PATH", "/opt/mira/data/mira.db")
DOCKER_CONTAINER = os.getenv("DOCKER_CONTAINER", "mira-pipeline-saas")
FIXTURES_DIR = Path(__file__).parent / "fixtures"
RUNS_DIR = Path(__file__).parent / "runs"


# ── HTTP transport ────────────────────────────────────────────────────────────


def _call_pipeline(chat_id: str, user_message: str) -> tuple[str, int, int]:
    """POST a single turn to the pipeline.

    Returns (response_text, http_status, latency_ms).
    Two modes:
      - Direct HTTP (PIPELINE_URL set): uses subprocess curl for zero-dependency portability.
      - Docker-exec mode (PIPELINE_URL empty): curl runs inside the pipeline container.
    """
    payload = json.dumps({
        "model": "mira-diagnostic",
        "messages": [{"role": "user", "content": user_message}],
        "user": chat_id,
    })

    headers = ["-H", "Content-Type: application/json"]
    if PIPELINE_API_KEY:
        headers += ["-H", f"Authorization: Bearer {PIPELINE_API_KEY}"]

    target_url = (PIPELINE_URL or "http://localhost:9099") + "/v1/chat/completions"

    curl_args = (
        ["curl", "-s", "-o", "/tmp/mira_eval_resp.json", "-w", "%{http_code}",
         "-X", "POST", target_url]
        + headers
        + ["-d", payload]
    )

    t0 = time.monotonic()
    if PIPELINE_URL:
        # Direct HTTP mode
        result = subprocess.run(curl_args, capture_output=True, text=True, timeout=120)
    else:
        # Docker-exec mode: run curl inside the pipeline container
        result = subprocess.run(
            ["docker", "exec", DOCKER_CONTAINER] + curl_args,
            capture_output=True, text=True, timeout=120,
        )
    latency_ms = int((time.monotonic() - t0) * 1000)

    status_code = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0

    # Read response body from temp file
    if PIPELINE_URL:
        try:
            body = Path("/tmp/mira_eval_resp.json").read_text()
        except FileNotFoundError:
            body = "{}"
    else:
        # Read from inside the container
        read_result = subprocess.run(
            ["docker", "exec", DOCKER_CONTAINER, "cat", "/tmp/mira_eval_resp.json"],
            capture_output=True, text=True,
        )
        body = read_result.stdout

    try:
        data = json.loads(body)
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    except (json.JSONDecodeError, IndexError, KeyError):
        reply = ""
        if status_code == 0:
            status_code = 500

    return reply, status_code, latency_ms


# ── FSM state reader ──────────────────────────────────────────────────────────


def _read_fsm_state(chat_id: str) -> str:
    """Read FSM state for a chat_id from mira.db.

    Falls back to 'UNKNOWN' if DB is not readable or session not found.
    """
    db_path = Path(MIRA_DB_PATH)
    if not db_path.exists():
        return "UNKNOWN"
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT state FROM conversation_state WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        conn.close()
        return row["state"] if row else "IDLE"
    except Exception as e:
        logger.warning("FSM DB read failed for %s: %s", chat_id, e)
        return "UNKNOWN"


# ── Fixture loader ────────────────────────────────────────────────────────────


def _load_fixtures(fixtures_dir: Path) -> list[dict]:
    """Load scenario fixtures from fixtures_dir, sorted by filename.

    Loads files matching:
      - NN_*.yaml  — original numbered scenarios (01_gs10_overcurrent.yaml, etc.)
      - vfd_*.yaml — VFD vendor corpus scenarios (Sprint A and beyond)

    Other YAML files (vision fixtures, smoke tests, etc.) are skipped — they
    use a different schema and must be run by their own dedicated runners.
    Files without a top-level ``id`` field are silently skipped.
    """
    fixtures = []
    seen: set[str] = set()
    candidates = sorted(
        list(fixtures_dir.glob("[0-9][0-9]_*.yaml"))
        + list(fixtures_dir.glob("vfd_*.yaml"))
    )
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        with open(path) as f:
            fixture = yaml.safe_load(f)
        if "id" not in fixture:
            logger.warning("Skipping %s — missing required 'id' field", path.name)
            continue
        fixture["_path"] = str(path)
        fixtures.append(fixture)
    return fixtures


# ── Scenario runner ───────────────────────────────────────────────────────────


def run_scenario(
    fixture: dict,
    dry_run: bool = False,
    judge: Judge | None = None,
) -> tuple[ScenarioGrade, JudgeResult | None]:
    """Execute a single scenario fixture and return (ScenarioGrade, JudgeResult | None).

    Each scenario gets a unique chat_id so FSM sessions are isolated.
    judge is called once per scenario (on the last response, last user question).
    """
    run_id = uuid.uuid4().hex[:8]
    chat_id = f"{EVAL_CHAT_PREFIX}-{fixture['id']}-{run_id}"

    turns = fixture.get("turns", [])
    user_turns = [t for t in turns if t["role"] == "user"]

    responses: list[str] = []
    latencies_ms: list[int] = []
    http_statuses: list[int] = []

    if dry_run:
        logger.info("[DRY RUN] %s — %d user turns (no HTTP calls)", fixture["id"], len(user_turns))
        from tests.eval.grader import CheckpointResult
        grade = ScenarioGrade(
            scenario_id=fixture["id"],
            final_fsm_state="(dry-run)",
            total_turns=len(user_turns),
            last_response="(dry-run)",
        )
        grade.checkpoints = [
            CheckpointResult("cp_reached_state", True, "dry-run"),
            CheckpointResult("cp_pipeline_active", True, "dry-run"),
            CheckpointResult("cp_keyword_match", True, "dry-run"),
            CheckpointResult("cp_no_5xx", True, "dry-run"),
            CheckpointResult("cp_turn_budget", True, "dry-run"),
        ]
        return grade, None

    logger.info("Running scenario: %s (chat_id=%s)", fixture["id"], chat_id)

    turn_log: list[dict] = []

    for i, turn in enumerate(user_turns):
        content = turn["content"]
        logger.info("  Turn %d: %s", i + 1, content[:60])
        try:
            reply, status, latency = _call_pipeline(chat_id, content)
        except subprocess.TimeoutExpired:
            reply, status, latency = "", 504, 120_000
        except Exception as e:
            logger.error("  Turn %d error: %s", i + 1, e)
            reply, status, latency = "", 500, 0

        responses.append(reply)
        http_statuses.append(status)
        latencies_ms.append(latency)

        fsm_after = _read_fsm_state(chat_id)
        turn_log.append({"turn": i + 1, "user_msg": content, "fsm_state": fsm_after})
        logger.info("  -> HTTP %d, %dms, %d chars, fsm=%s", status, latency, len(reply), fsm_after)

        if i < len(user_turns) - 1:
            time.sleep(0.5)

    final_state = turn_log[-1]["fsm_state"] if turn_log else _read_fsm_state(chat_id)
    logger.info("  Final FSM state: %s", final_state)

    grade = grade_scenario(
        fixture=fixture,
        final_fsm_state=final_state,
        responses=responses,
        latencies_ms=latencies_ms,
        http_statuses=http_statuses,
        user_turn_count=len(user_turns),
    )

    # ── LLM-as-judge (once per scenario) ──────────────────────────────────────
    judge_result: JudgeResult | None = None
    if judge and not judge.disabled:
        last_response = responses[-1] if responses else ""
        last_user_question = user_turns[-1]["content"] if user_turns else ""
        # RAG context is not exposed by the pipeline OpenAI-compat response —
        # pass empty string; judge prompt handles this as "no KB chunks retrieved".
        rag_context = ""
        generated_by = fixture.get("judge_generated_by", "unknown")

        judge_result = judge.grade(
            response=last_response,
            rag_context=rag_context,
            user_question=last_user_question,
            generated_by=generated_by,
            scenario_id=fixture["id"],
            conversation_history=turn_log if len(turn_log) > 1 else None,
        )

    return grade, judge_result


# ── Scorecard writer ──────────────────────────────────────────────────────────

_CHECKPOINT_LABELS = [
    "FSM state",
    "Pipeline active",
    "Keyword match",
    "No 5xx",
    "Turn budget",
]

_JUDGE_LABELS = ["Grnd", "Help", "Tone", "Inst", "Flow"]
_JUDGE_LABEL_MAP = dict(zip(DIMENSIONS, _JUDGE_LABELS))


def _icon(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def _score_cell(result: JudgeResult | None, dim: str) -> str:
    """Format a single judge score cell for the scorecard table."""
    if result is None or result.error:
        return "—"
    score = result.scores.get(dim)
    return str(score) if score is not None else "—"


def write_scorecard(
    grades: list[ScenarioGrade],
    run_date: str,
    output_path: Path,
    prev_path: Path | None,
    dry_run: bool,
    judge_results: list[JudgeResult | None] | None = None,
    judge_raw_path: Path | None = None,
) -> None:
    """Write markdown scorecard to output_path.

    If judge_results is provided, four additional score columns are appended to
    the results table and an aggregate judge summary section is written at the bottom.
    Raw judge JSON is written to judge_raw_path (one JSON object per line).
    """
    total = len(grades)
    total_passed = sum(1 for g in grades if g.passed)
    pass_rate = 100 * total_passed / total if total else 0
    has_judge = bool(judge_results and any(r is not None for r in judge_results))

    lines = [
        f"# MIRA Eval Scorecard — {run_date}",
        "",
        f"**Pass rate:** {total_passed}/{total} scenarios ({pass_rate:.0f}%)",
        f"**Mode:** {'DRY RUN' if dry_run else 'LIVE'}",
        f"**Judge:** {'enabled' if has_judge else 'disabled (EVAL_DISABLE_JUDGE=1)'}",
        f"**Checkpoints:** {' / '.join(_CHECKPOINT_LABELS)}",
        "",
    ]

    if dry_run:
        lines.append("> DRY RUN — no HTTP calls made, fixture loading validated only.\n")

    # ── Summary table ─────────────────────────────────────────────────────────
    judge_header = " | ".join(_JUDGE_LABELS) if has_judge else ""
    judge_sep = "|".join([":---:"] * len(_JUDGE_LABELS)) if has_judge else ""

    header = "| Scenario | " + " | ".join(_CHECKPOINT_LABELS)
    sep = "|----------|" + "|".join(["-" * (len(lbl) + 2) for lbl in _CHECKPOINT_LABELS])
    if has_judge:
        header += " | " + judge_header
        sep += "|" + judge_sep
    header += " | Score | FSM State |"
    sep += "|-------|-----------|"

    lines += ["## Results", "", header, sep]

    jr_list = judge_results if judge_results else [None] * len(grades)
    for g, jr in zip(grades, jr_list):
        cp_cells = " | ".join(_icon(c.passed) for c in g.checkpoints)
        judge_cells = ""
        if has_judge:
            judge_cells = " | " + " | ".join(_score_cell(jr, dim) for dim in DIMENSIONS)
        state_cell = g.final_fsm_state or "?"
        row = f"| `{g.scenario_id}` | {cp_cells}{judge_cells} | {g.score} | {state_cell} |"
        lines.append(row)

    lines += [""]

    # ── Judge aggregate summary ───────────────────────────────────────────────
    if has_judge:
        scored = [jr for jr in jr_list if jr is not None and jr.succeeded]
        if scored:
            avg_by_dim = {
                dim: sum(jr.scores[dim] for jr in scored) / len(scored)
                for dim in DIMENSIONS
            }
            lines += [
                "## Judge Summary",
                "",
                f"*{len(scored)}/{len(grades)} scenarios scored "
                f"({'all' if len(scored) == len(grades) else 'partial'} coverage)*",
                "",
            ]

            # Aggregate line
            agg = " | ".join(f"{_JUDGE_LABEL_MAP[d]} {avg_by_dim[d]:.1f}" for d in DIMENSIONS)
            lines.append(f"**Average scores:** {agg}")
            lines.append("")

            # Trend vs previous run — look for previous judge data in raw JSONL
            if prev_path and prev_path.exists():
                prev_judge_path = prev_path.with_suffix("").with_name(
                    prev_path.stem + "-judge.jsonl"
                )
                if prev_judge_path.exists():
                    try:
                        prev_scored = [json.loads(ln) for ln in prev_judge_path.read_text().splitlines() if ln.strip()]
                        prev_avgs: dict[str, float] = {}
                        for dim in DIMENSIONS:
                            vals = [r["scores"][dim] for r in prev_scored if r.get("scores", {}).get(dim)]
                            if vals:
                                prev_avgs[dim] = sum(vals) / len(vals)
                        if prev_avgs:
                            trend_parts = []
                            for dim in DIMENSIONS:
                                if dim in prev_avgs:
                                    delta = avg_by_dim[dim] - prev_avgs[dim]
                                    arrow = "▲" if delta > 0.1 else ("▼" if delta < -0.1 else "→")
                                    trend_parts.append(
                                        f"{_JUDGE_LABEL_MAP[dim]} {arrow}{delta:+.1f}"
                                    )
                            if trend_parts:
                                lines.append(f"**Trend vs previous:** {' | '.join(trend_parts)}")
                                lines.append("")
                    except Exception as e:
                        logger.warning("Could not read previous judge data for trend: %s", e)

            # Per-scenario notes for failed or low-scoring results
            low_threshold = 2
            low_scoring = [
                (jr, g) for jr, g in zip(jr_list, grades)
                if jr and jr.succeeded and any(v <= low_threshold for v in jr.scores.values())
            ]
            if low_scoring:
                lines += ["### Low-Scoring Scenarios (≤2 on any dimension)", ""]
                for jr, g in low_scoring:
                    lines.append(f"**`{g.scenario_id}`** (judge: {jr.judge_provider}/{jr.judge_model})")
                    for dim in DIMENSIONS:
                        score = jr.scores.get(dim, 0)
                        if score <= low_threshold:
                            note = jr.notes.get(dim, "")
                            lines.append(f"  - {_JUDGE_LABEL_MAP[dim]} = {score}: {note}")
                    lines.append("")

    # ── Failures (binary checkpoint failures) ─────────────────────────────────
    failures = [g for g in grades if not g.passed]
    if failures:
        lines += ["## Failures", ""]
        for g in failures:
            lines.append(f"### {g.scenario_id}")
            for cp in g.checkpoints:
                if not cp.passed:
                    lines.append(f"- **{cp.name}** FAILED: {cp.reason}")
            if g.last_response:
                preview = g.last_response[:200].replace("\n", " ")
                lines.append(f"- Last response: `{preview}...`")
            lines.append("")

    # ── Diff vs previous run ──────────────────────────────────────────────────
    if prev_path and prev_path.exists():
        prev_text = prev_path.read_text()
        prev_ids = set(re.findall(r"`([\w_]+)`", prev_text))
        curr_ids = {g.scenario_id for g in grades if g.passed}
        regressions = prev_ids - curr_ids
        recoveries = curr_ids - prev_ids

        if regressions or recoveries:
            lines += ["## Delta vs Previous Run", ""]
            if regressions:
                lines.append("**Regressions (was passing, now failing):**")
                for sid in sorted(regressions):
                    lines.append(f"- {sid}")
                lines.append("")
            if recoveries:
                lines.append("**Recoveries (was failing, now passing):**")
                for sid in sorted(recoveries):
                    lines.append(f"- {sid}")
                lines.append("")

    # ── Timing summary ────────────────────────────────────────────────────────
    if any(g.latency_ms_total for g in grades):
        total_ms = sum(g.latency_ms_total for g in grades)
        lines += [
            "## Timing",
            "",
            f"Total wall time: {total_ms / 1000:.1f}s across {total} scenarios",
            "",
        ]

    lines.append("---")
    lines.append(f"*Generated by `tests/eval/run_eval.py` at {datetime.now(timezone.utc).isoformat()}*")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n")
    logger.info("Scorecard written to %s", output_path)

    # ── Raw judge JSONL ───────────────────────────────────────────────────────
    if has_judge and judge_raw_path:
        judge_raw_path.parent.mkdir(parents=True, exist_ok=True)
        with judge_raw_path.open("w") as f:
            for jr in jr_list:
                if jr is not None:
                    f.write(json.dumps(jr.to_dict()) + "\n")
        logger.info("Raw judge JSON written to %s", judge_raw_path)


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA eval runner — v2.6.0 with LLM-as-judge")
    parser.add_argument("--dry-run", action="store_true", help="Load fixtures only, no HTTP calls")
    parser.add_argument(
        "--output", default=str(RUNS_DIR),
        help=(
            "Output path. If ends with .md, used as the scorecard file directly "
            "(useful for timestamped Celery runs). Otherwise treated as a directory "
            "and the scorecard is written as YYYY-MM-DD.md inside it. "
            "Default: tests/eval/runs/"
        ),
    )
    parser.add_argument(
        "--fixtures", default=str(FIXTURES_DIR),
        help="Directory containing YAML fixture files",
    )
    args = parser.parse_args()

    # Support --output as either a directory or a direct .md file path
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_arg = Path(args.output)
    if args.output.endswith(".md"):
        output_path = output_arg
        output_dir = output_path.parent
    else:
        output_dir = output_arg
        output_path = output_dir / f"{run_date}.md"

    # Sibling JSONL for raw judge output
    judge_raw_path = output_path.with_suffix("").with_name(output_path.stem + "-judge.jsonl")

    # Find previous scorecard for diff
    existing = sorted(output_dir.glob("*.md"))
    prev_path = (
        existing[-2]
        if output_path in existing and len(existing) >= 2
        else (existing[-1] if existing else None)
    )

    # Load fixtures
    fixtures = _load_fixtures(Path(args.fixtures))
    if not fixtures:
        logger.error("No YAML fixtures found in %s", args.fixtures)
        return 1
    logger.info("Loaded %d fixtures from %s", len(fixtures), args.fixtures)

    # Initialise judge (respects EVAL_DISABLE_JUDGE env var)
    judge = Judge()
    judge_enabled = not (judge.disabled or args.dry_run)
    if judge_enabled:
        logger.info("LLM-as-judge enabled — scores will be appended to scorecard")
    else:
        logger.info("LLM-as-judge disabled")

    # Run scenarios
    grades: list[ScenarioGrade] = []
    judge_results: list[JudgeResult | None] = []

    for fixture in fixtures:
        grade, jr = run_scenario(fixture, dry_run=args.dry_run, judge=judge if judge_enabled else None)
        grades.append(grade)
        judge_results.append(jr)
        status = "PASS" if grade.passed else "FAIL"
        judge_summary = ""
        if jr and jr.succeeded:
            judge_summary = f" judge_avg={jr.average:.1f}"
        logger.info("%s %s (%s)%s", status, grade.scenario_id, grade.score, judge_summary)

    # Write scorecard
    write_scorecard(
        grades,
        run_date,
        output_path,
        prev_path,
        dry_run=args.dry_run,
        judge_results=judge_results if judge_enabled else None,
        judge_raw_path=judge_raw_path if judge_enabled else None,
    )

    # Exit non-zero if any scenario failed (useful for CI)
    failed = sum(1 for g in grades if not g.passed)
    if failed:
        logger.warning("%d/%d scenarios failed — see scorecard for details", failed, len(grades))
    else:
        logger.info("All %d scenarios passed.", len(grades))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
