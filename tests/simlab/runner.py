#!/usr/bin/env python3
"""SimLab scenario runner — machine-behavior eval harness.

Runs SimLab scenarios in-process against the MIRA Supervisor engine.
Machine context is pre-seeded as a direct-connection UNS-certified state
so the UNS confirmation gate is bypassed (the scene is already established).

Usage:
    # Load Doppler secrets first, then:
    doppler run --project factorylm --config prd -- \\
        python3 tests/simlab/runner.py

    # Run a single scenario:
    python3 tests/simlab/runner.py --scenario conveyor_jam_01

    # Dry run (schema loading only, no LLM calls):
    python3 tests/simlab/runner.py --dry-run

Output:
    tests/simlab/runs/YYYY-MM-DDTHHMM-simlab.md
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

_REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mira-bots"))
sys.path.insert(0, str(_REPO_ROOT))

from tests.simlab.checkpoints import evaluate_behavior_checkpoints
from tests.simlab.schema import SimLabScenario, load_all_scenarios, load_scenario

logger = logging.getLogger("mira-simlab")
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

_RUNS_DIR = Path(__file__).parent / "runs"
_SCENARIOS_DIR = Path(__file__).parent / "scenarios"


# ── State pre-seeding ─────────────────────────────────────────────────────────


def _build_initial_state(scenario: SimLabScenario) -> dict:
    """Build Supervisor state dict pre-seeded with machine context.

    Populates uns_context with source="direct_connection" so the engine
    skips the UNS confirmation gate — the SimLab runner IS the machine context.
    """
    ctx = scenario.machine_context
    asset_label = ctx.primary_asset_label()
    return {
        "state": "Q1",
        "asset_identified": asset_label,
        "uns_context": {
            "source": "direct_connection",
            "confidence": "certified",
            "uns_path": ctx.uns_path,
            "site": ctx.site,
            "manufacturer": next((c.manufacturer for c in ctx.components if c.manufacturer), ""),
            "model": next((c.model for c in ctx.components if c.model), ""),
        },
        "context": {
            "session_context": {
                "machine_type": scenario.machine_type,
                "equipment_type": scenario.machine_type,
                "tag_state": ctx.tag_state,
                "simlab_scenario_id": scenario.id,
            }
        },
        "exchange_count": 0,
        "fault_category": None,
        "final_state": None,
    }


# ── Scenario execution ────────────────────────────────────────────────────────


async def run_scenario(
    supervisor,
    scenario: SimLabScenario,
    dry_run: bool = False,
) -> dict:
    """Run one SimLab scenario. Returns result dict compatible with scorecard."""
    chat_id = f"simlab_{scenario.id}_{uuid.uuid4().hex[:8]}"

    # Reset + pre-seed state
    supervisor.reset(chat_id)
    initial_state = _build_initial_state(scenario)
    supervisor._save_state(chat_id, initial_state)

    user_turns = [t for t in scenario.turns if t.get("role") == "user"]
    bot_replies: list[str] = []
    final_state = "IDLE"
    error: str | None = None
    t_start = time.monotonic()

    if dry_run:
        return {
            "id": scenario.id,
            "name": scenario.name,
            "passed": True,
            "dry_run": True,
            "behavior_results": [],
            "standard_results": {},
            "bot_replies": [],
            "final_state": "N/A",
            "latency_ms": 0,
            "error": None,
        }

    for turn in user_turns[: scenario.max_turns]:
        message = turn.get("content", "")
        try:
            result = await supervisor.process_full(chat_id, message, photo_b64=None)
            reply = result.get("reply", "")
            final_state = result.get("next_state") or final_state
            bot_replies.append(reply)
        except Exception as e:
            error = str(e)
            logger.error("Scenario %s turn error: %s", scenario.id, e)
            break

    latency_ms = int((time.monotonic() - t_start) * 1000)

    # ── Standard checkpoints (keyword + state) ────────────────────────────────
    combined_text = " ".join(bot_replies).lower()
    kw_pass = (
        any(kw.lower() in combined_text for kw in scenario.expected_keywords)
        if scenario.expected_keywords
        else True
    )
    forbidden_hit = [kw for kw in scenario.forbidden_keywords if kw.lower() in combined_text]
    kw_fail_reason = f"Forbidden keywords: {forbidden_hit}" if forbidden_hit else None
    if kw_fail_reason:
        kw_pass = False
    state_pass = final_state == scenario.expected_final_state

    standard_results = {
        "cp_reached_state": {
            "passed": state_pass,
            "actual": final_state,
            "expected": scenario.expected_final_state,
        },
        "cp_keyword_match": {"passed": kw_pass, "reason": kw_fail_reason or "OK"},
        "cp_turn_budget": {"passed": len(user_turns) <= scenario.max_turns},
        "cp_no_error": {"passed": error is None, "error": error},
    }

    # ── Behavior checkpoints ──────────────────────────────────────────────────
    behavior_results = evaluate_behavior_checkpoints(scenario, bot_replies)

    all_standard_pass = all(v["passed"] for v in standard_results.values())
    all_behavior_pass = all(r.passed for r in behavior_results)
    overall_pass = all_standard_pass and all_behavior_pass

    return {
        "id": scenario.id,
        "name": scenario.name,
        "passed": overall_pass,
        "dry_run": False,
        "behavior_results": behavior_results,
        "standard_results": standard_results,
        "bot_replies": bot_replies,
        "final_state": final_state,
        "latency_ms": latency_ms,
        "error": error,
    }


# ── Supervisor setup ──────────────────────────────────────────────────────────


def _build_supervisor():
    from shared.engine import Supervisor

    db_path = os.getenv("SIMLAB_DB_PATH", "/tmp/mira_simlab.db")
    return Supervisor(
        db_path=db_path,
        openwebui_url=os.getenv("OPENWEBUI_URL", "http://localhost:3000"),
        api_key=os.getenv("OPENWEBUI_API_KEY", ""),
        collection_id=os.getenv("OPENWEBUI_COLLECTION_ID", ""),
    )


# ── Scorecard writer ──────────────────────────────────────────────────────────


def _write_scorecard(results: list[dict], output_path: Path) -> None:
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")

    lines = [
        f"# MIRA SimLab — Machine Behavior Eval — {ts}",
        "",
        f"**Scenarios:** {total}  |  **Pass rate:** {passed}/{total} ({100 * passed // total if total else 0}%)",
        "",
        "## Results",
        "",
        "| Scenario | State | Keywords | Behavior | Score |",
        "|----------|-------|----------|----------|-------|",
    ]

    for r in results:
        sr = r["standard_results"]
        state_icon = "✓" if sr.get("cp_reached_state", {}).get("passed") else "✗"
        kw_icon = "✓" if sr.get("cp_keyword_match", {}).get("passed") else "✗"
        beh_icons = " ".join("✓" if b.passed else "✗" for b in r["behavior_results"])
        total_checks = 2 + len(r["behavior_results"])
        check_pass = (
            (1 if state_icon == "✓" else 0)
            + (1 if kw_icon == "✓" else 0)
            + sum(1 for b in r["behavior_results"] if b.passed)
        )
        overall = "✓" if r["passed"] else "✗"
        lines.append(
            f"| `{r['id']}` {overall} | {state_icon} | {kw_icon} | {beh_icons or '—'} | {check_pass}/{total_checks} |"
        )

    failures = [r for r in results if not r["passed"]]
    if failures:
        lines += ["", "## Failures", ""]
        for r in failures:
            lines.append(f"### {r['id']}")
            sr = r["standard_results"]
            if not sr.get("cp_reached_state", {}).get("passed"):
                actual = sr["cp_reached_state"]["actual"]
                expected = sr["cp_reached_state"]["expected"]
                lines.append(
                    f"- **cp_reached_state** FAILED: State='{actual}', expected='{expected}'"
                )
            if not sr.get("cp_keyword_match", {}).get("passed"):
                lines.append(f"- **cp_keyword_match** FAILED: {sr['cp_keyword_match']['reason']}")
            for b in r["behavior_results"]:
                if not b.passed:
                    lines.append(f"- **{b.name}** FAILED: {b.reason}")
            if r["bot_replies"]:
                snippet = r["bot_replies"][-1][:200].replace("\n", " ")
                lines.append(f"- Last reply: `{snippet}...`")
            lines.append("")

    lines.append(f"---\n*Generated by SimLab runner at {datetime.now(timezone.utc).isoformat()}*")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines))
    print(f"Scorecard: {output_path}")


# ── CLI ───────────────────────────────────────────────────────────────────────


async def _main(args: argparse.Namespace) -> None:
    scenarios: list[SimLabScenario] = []

    if args.scenario:
        path = _SCENARIOS_DIR / f"{args.scenario}.yaml"
        if not path.exists():
            path = _SCENARIOS_DIR / args.scenario
        scenarios.append(load_scenario(path))
    else:
        scenarios = load_all_scenarios(_SCENARIOS_DIR)

    if not scenarios:
        print("No scenarios found.")
        return

    print(f"Loaded {len(scenarios)} scenario(s)")

    if args.dry_run:
        for s in scenarios:
            print(f"  [DRY RUN] {s.id} — {s.name}")
        print("Schema OK — no LLM calls made.")
        return

    supervisor = _build_supervisor()
    results = []
    for scenario in scenarios:
        print(f"Running: {scenario.id} ...", end=" ", flush=True)
        result = await run_scenario(supervisor, scenario)
        icon = "PASS" if result["passed"] else "FAIL"
        print(f"{icon} ({result['latency_ms']}ms)")
        results.append(result)

    passed = sum(1 for r in results if r["passed"])
    print(f"\nRESULT: {passed}/{len(results)} passed")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M")
    output_path = _RUNS_DIR / f"{ts}-simlab.md"
    _write_scorecard(results, output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="SimLab machine-behavior scenario runner")
    parser.add_argument("--scenario", help="Run a single scenario by ID (without .yaml)")
    parser.add_argument("--dry-run", action="store_true", help="Load schemas only, no LLM calls")
    args = parser.parse_args()
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()
