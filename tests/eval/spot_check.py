"""Targeted spot-check for specific fixtures — faster than running the full suite.

Usage:
    python3 tests/eval/spot_check.py <fixture1.yaml> [fixture2.yaml] ...

Runs each fixture through LocalPipeline + grader and prints pass/fail per checkpoint.
"""

from __future__ import annotations

import asyncio
import sys
import time
import uuid
from pathlib import Path

import yaml

# Ensure imports work from repo root
sys.path.insert(0, ".")
sys.path.insert(0, "mira-bots")

sys.path.insert(0, "tests")

from eval.local_pipeline import LocalPipeline
from eval.grader import grade_scenario


async def run_fixture(pipeline: LocalPipeline, fixture_path: Path) -> dict:
    with open(fixture_path) as f:
        fixture = yaml.safe_load(f)

    chat_id = f"spotcheck_{uuid.uuid4().hex[:8]}"
    turns = fixture.get("turns", [])

    responses: list[str] = []
    latencies_ms: list[int] = []
    http_statuses: list[int] = []
    retrieved_chunks: list[str] = []

    for turn in turns:
        user_msg = turn.get("content", turn.get("user", ""))
        try:
            reply, status, elapsed = await pipeline.call(chat_id, user_msg)
            responses.append(reply)
            latencies_ms.append(elapsed)
            http_statuses.append(status)
        except Exception as e:
            responses.append(f"ERROR: {e}")
            latencies_ms.append(0)
            http_statuses.append(500)

    final_state = pipeline.fsm_state(chat_id)

    grade = grade_scenario(
        fixture=fixture,
        final_fsm_state=final_state,
        responses=responses,
        latencies_ms=latencies_ms,
        http_statuses=http_statuses,
        user_turn_count=len(turns),
        retrieved_chunks=retrieved_chunks or None,
    )
    return {"fixture": fixture, "grade": grade, "responses": responses}


def print_result(result: dict) -> None:
    grade = result["grade"]
    fixture = result["fixture"]
    status = "PASS" if grade.passed else "FAIL"
    print(f"\n{'='*60}")
    print(f"[{status}] {grade.scenario_id}  ({grade.score})")
    print(f"  FSM: {grade.final_fsm_state}  turns: {grade.total_turns}")
    for cp in grade.checkpoints:
        icon = "✓" if cp.passed else "✗"
        print(f"  {icon} {cp.name}: {cp.reason}")
    if not grade.passed:
        last = result["responses"][-1] if result["responses"] else ""
        print(f"  Last reply[:150]: {last[:150]!r}")


async def main(fixture_paths: list[str]) -> None:
    pipeline = LocalPipeline()

    total = len(fixture_paths)
    passed = 0

    for path_str in fixture_paths:
        path = Path(path_str)
        if not path.exists():
            print(f"MISSING: {path}")
            continue
        result = await run_fixture(pipeline, path)
        print_result(result)
        if result["grade"].passed:
            passed += 1

    print(f"\n{'='*60}")
    print(f"RESULT: {passed}/{total} passed")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 tests/eval/spot_check.py <fixture.yaml> ...")
        sys.exit(1)
    asyncio.run(main(sys.argv[1:]))
