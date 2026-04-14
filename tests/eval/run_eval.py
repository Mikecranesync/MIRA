#!/usr/bin/env python3
"""MIRA Eval Runner — Week-1 MVP.

Fires each scenario fixture through mira-pipeline, runs 5 binary checkpoints,
writes a markdown scorecard to tests/eval/runs/YYYY-MM-DD.md.

Usage (from repo root on VPS):
    # Against live VPS pipeline (via docker exec — no port mapping required):
    python3 tests/eval/run_eval.py

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

from tests.eval.grader import ScenarioGrade, grade_scenario

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
    """Load all YAML fixtures from fixtures_dir, sorted by filename."""
    fixtures = []
    for path in sorted(fixtures_dir.glob("*.yaml")):
        with open(path) as f:
            fixture = yaml.safe_load(f)
        fixture["_path"] = str(path)
        fixtures.append(fixture)
    return fixtures


# ── Scenario runner ───────────────────────────────────────────────────────────


def run_scenario(fixture: dict, dry_run: bool = False) -> ScenarioGrade:
    """Execute a single scenario fixture and return a ScenarioGrade.

    Each scenario gets a unique chat_id so FSM sessions are isolated.
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
        # Return a synthetic grade with all checkpoints passing for fixture validation
        from tests.eval.grader import (
            CheckpointResult,
            ScenarioGrade,
        )
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
        return grade

    logger.info("Running scenario: %s (chat_id=%s)", fixture["id"], chat_id)

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
        logger.info("  -> HTTP %d, %dms, %d chars", status, latency, len(reply))

        # Brief pause between turns to avoid hammering
        if i < len(user_turns) - 1:
            time.sleep(0.5)

    # Read FSM state after all turns
    final_state = _read_fsm_state(chat_id)
    logger.info("  Final FSM state: %s", final_state)

    return grade_scenario(
        fixture=fixture,
        final_fsm_state=final_state,
        responses=responses,
        latencies_ms=latencies_ms,
        http_statuses=http_statuses,
        user_turn_count=len(user_turns),
    )


# ── Scorecard writer ──────────────────────────────────────────────────────────

_CHECKPOINT_LABELS = [
    "FSM state",
    "Pipeline active",
    "Keyword match",
    "No 5xx",
    "Turn budget",
]


def _icon(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def write_scorecard(
    grades: list[ScenarioGrade],
    run_date: str,
    output_path: Path,
    prev_path: Path | None,
    dry_run: bool,
) -> None:
    """Write markdown scorecard to output_path."""
    total = len(grades)
    total_passed = sum(1 for g in grades if g.passed)
    pass_rate = 100 * total_passed / total if total else 0

    lines = [
        f"# MIRA Eval Scorecard — {run_date}",
        "",
        f"**Pass rate:** {total_passed}/{total} scenarios ({pass_rate:.0f}%)",
        f"**Mode:** {'DRY RUN' if dry_run else 'LIVE'}",
        f"**Checkpoints:** {' / '.join(_CHECKPOINT_LABELS)}",
        "",
    ]

    if dry_run:
        lines.append("> DRY RUN — no HTTP calls made, fixture loading validated only.\n")

    # Summary table
    lines += [
        "## Results",
        "",
        "| Scenario | " + " | ".join(_CHECKPOINT_LABELS) + " | Score | FSM State |",
        "|----------|" + "|".join(["-" * (len(l) + 2) for l in _CHECKPOINT_LABELS]) + "|-------|-----------|",
    ]

    for g in grades:
        cp_cells = " | ".join(_icon(c.passed) for c in g.checkpoints)
        state_cell = g.final_fsm_state or "?"
        row = f"| `{g.scenario_id}` | {cp_cells} | {g.score} | {state_cell} |"
        lines.append(row)

    lines += [""]

    # Detail section for failures
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

    # Diff vs previous run
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

    # Timing summary
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


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="MIRA eval runner — Week-1 MVP")
    parser.add_argument("--dry-run", action="store_true", help="Load fixtures only, no HTTP calls")
    parser.add_argument(
        "--output", default=str(RUNS_DIR),
        help="Directory to write scorecards (default: tests/eval/runs/)",
    )
    parser.add_argument(
        "--fixtures", default=str(FIXTURES_DIR),
        help="Directory containing YAML fixture files",
    )
    args = parser.parse_args()

    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_dir = Path(args.output)
    output_path = output_dir / f"{run_date}.md"

    # Find previous scorecard for diff
    existing = sorted(output_dir.glob("*.md"))
    prev_path = existing[-1] if existing else None

    # Load fixtures
    fixtures = _load_fixtures(Path(args.fixtures))
    if not fixtures:
        logger.error("No YAML fixtures found in %s", args.fixtures)
        return 1
    logger.info("Loaded %d fixtures from %s", len(fixtures), args.fixtures)

    # Run scenarios
    grades: list[ScenarioGrade] = []
    for fixture in fixtures:
        grade = run_scenario(fixture, dry_run=args.dry_run)
        grades.append(grade)
        status = "PASS" if grade.passed else "FAIL"
        logger.info("%s %s (%s)", status, grade.scenario_id, grade.score)

    # Write scorecard
    write_scorecard(grades, run_date, output_path, prev_path, dry_run=args.dry_run)

    # Exit non-zero if any scenario failed (useful for CI)
    failed = sum(1 for g in grades if not g.passed)
    if failed:
        logger.warning("%d/%d scenarios failed — see scorecard for details", failed, len(grades))
    else:
        logger.info("All %d scenarios passed.", len(grades))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
