"""Release gate orchestrator — run evals stages, classify failures, emit verdict.

Usage:
  python evals/scripts/release_gate.py \
    --sha <commit_sha> \
    [--pr PR_NUMBER] \
    [--out-root evals/results] \
    [--cases evals/technician/cases.yaml evals/safety/cases.yaml] \
    [--with-android] \
    [--offline-only] \
    [--baseline evals/results/<prior-sha>/] \
    [--run-id <timestamp>]

Behavior:
  1. Create run dir <out-root>/<sha>-gate-<runid>
  2. Write manifest.json (sha, pr, branch, base_url, cases version, judge model env, timestamps, stages planned)
  3. Run stages in order:
     - drift_check (deterministic)
     - run_technician + safety (requires FLM_* env or --offline-only)
     - judge_baseline (requires GROQ_API_KEY or --offline-only)
     - report.py (emits verdict, exit 3 on HOLD)
     - optional run_android_workflows.py if --with-android
  4. Capture stdout/stderr to logs/<stage>.log
  5. Classify failures: INFRA_FAILURE (missing env, crashed stage) vs gate-fail (report exit 3)
  6. Emit ONE verdict: PASS (exit 0) | HOLD (exit 3) | INFRA_FAILURE (exit 4)

Exit codes:
  0 = PASS (all stages green, report says RELEASE)
  3 = HOLD (report says HOLD per §13 verdict logic)
  4 = INFRA_FAILURE (required stage crashed, blocked, or missing auth)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("release_gate")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Stage definitions: (name, command_builder, required, infra_check_fn)
STAGES = [
    ("drift_check", "drift_check", True, None),
    ("technician_safety", "run_technician", True, "run_technician_infra_check"),
    ("judge_baseline", "judge_baseline", True, "judge_baseline_infra_check"),
    ("report", "report", True, None),
]


def run_technician_infra_check() -> tuple[bool, str | None]:
    """Check if run_technician can proceed (requires FLM_* env vars)."""
    required_env = ["FLM_BASE_URL", "FLM_SESSION_COOKIE", "FLM_EVAL_NOTEBOOK_ID"]
    missing = [k for k in required_env if not os.getenv(k)]
    if missing:
        return False, f"missing env: {', '.join(missing)}"
    return True, None


def judge_baseline_infra_check() -> tuple[bool, str | None]:
    """Check if judge_baseline can proceed (requires GROQ_API_KEY)."""
    if not os.getenv("GROQ_API_KEY"):
        return False, "missing env: GROQ_API_KEY"
    return True, None


def build_drift_check_cmd(results_dir: Path) -> list[str]:
    """Build drift_check command."""
    return [
        sys.executable, "evals/scripts/drift_check.py",
        str(results_dir),
    ]


def build_run_technician_cmd(results_dir: Path, cases: list[str]) -> list[str]:
    """Build run_technician command."""
    cmd = [
        sys.executable, "evals/scripts/run_technician.py",
        "--cases", *cases,
        "--out", str(results_dir),
    ]
    return cmd


def build_judge_baseline_cmd(results_dir: Path) -> list[str]:
    """Build judge_baseline command."""
    return [
        sys.executable, "evals/scripts/judge_baseline.py",
        str(results_dir),
    ]


def build_report_cmd(results_dir: Path, baseline: Path | None) -> list[str]:
    """Build report.py command."""
    cmd = [
        sys.executable, "evals/scripts/report.py",
        str(results_dir),
    ]
    if baseline:
        cmd.extend(["--baseline", str(baseline)])
    return cmd


def build_android_cmd(results_dir: Path) -> list[str]:
    """Build run_android_workflows.py command."""
    return [
        sys.executable, "evals/scripts/run_android_workflows.py",
        str(results_dir),
    ]


def get_cases_version(cases: list[str]) -> str:
    """Compute sha of case files for manifest version tracking."""
    import hashlib

    combined = ""
    for case_file in cases:
        p = Path(case_file)
        if p.exists():
            combined += p.read_text()
    return hashlib.sha256(combined.encode()).hexdigest()[:12]


def run_stage(
    stage_name: str,
    cmd: list[str],
    logs_dir: Path,
    offline_only: bool = False,
) -> tuple[int, bool]:
    """
    Run a stage, capturing stdout/stderr.

    Returns (exit_code, is_infra_failure).
    is_infra_failure = True if stage crashed/blocked (not a gate failure).
    """
    log_file = logs_dir / f"{stage_name}.log"
    logger.info(f"Running {stage_name}...")

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=3600,
        )
        exit_code = result.returncode
        log_file.write_text(result.stdout)
        logger.info(f"{stage_name} exited {exit_code}")

        # Classify: exit 3 is HOLD (gate failure), nonzero others are INFRA
        if exit_code == 3:
            return exit_code, False  # HOLD, not infra
        elif exit_code != 0:
            return exit_code, True  # Crashed/blocked
        return exit_code, False

    except subprocess.TimeoutExpired:
        log_file.write_text("TIMEOUT after 3600s")
        logger.error(f"{stage_name} timed out")
        return 124, True

    except Exception as e:
        log_file.write_text(f"ERROR: {e}")
        logger.error(f"{stage_name} failed: {e}")
        return 1, True


def write_manifest(
    manifest_file: Path,
    sha: str,
    pr: int | None,
    branch: str,
    base_url: str,
    cases_version: str,
    judge_model_env: str,
    planned_stages: list[str],
) -> None:
    """Write manifest.json per §13 spec."""
    manifest = {
        "sha": sha,
        "pr": pr,
        "branch": branch,
        "base_url": base_url,
        "cases_version": cases_version,
        "judge_model_env": judge_model_env,
        "timestamp_start": datetime.now(timezone.utc).isoformat(),
        "stages_planned": planned_stages,
    }
    manifest_file.write_text(json.dumps(manifest, indent=2))
    logger.info(f"Manifest written to {manifest_file}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Release gate orchestrator — single entry point, one verdict"
    )
    ap.add_argument("--sha", required=True, help="commit SHA (required)")
    ap.add_argument("--pr", type=int, help="PR number (optional)")
    ap.add_argument(
        "--out-root",
        default="evals/results",
        help="output root (default evals/results)",
    )
    ap.add_argument(
        "--cases",
        nargs="+",
        default=["evals/technician/cases.yaml", "evals/safety/cases.yaml"],
        help="case files (default technician + safety)",
    )
    ap.add_argument(
        "--with-android",
        action="store_true",
        help="run android workflows after judge",
    )
    ap.add_argument(
        "--offline-only",
        action="store_true",
        help="run offline mode (skips live API calls, re-judges archive)",
    )
    ap.add_argument(
        "--baseline",
        help="baseline results dir for regression comparison",
    )
    ap.add_argument(
        "--run-id",
        help="run ID for output dir (default timestamp)",
    )
    args = ap.parse_args()

    # Setup
    sha = args.sha
    pr = args.pr
    out_root = Path(args.out_root)
    cases = args.cases
    with_android = args.with_android
    offline_only = args.offline_only
    baseline = Path(args.baseline) if args.baseline else None
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    # Create run directory
    run_dir = out_root / f"{sha}-gate-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = run_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Release gate: {sha} run={run_id}")
    logger.info(f"Output: {run_dir}")

    # Write manifest
    branch = os.getenv("GITHUB_HEAD_REF", "unknown")
    base_url = os.getenv("FLM_BASE_URL", "https://app.factorylm.com")
    cases_version = get_cases_version(cases)
    judge_model_env = os.getenv("JUDGE_MODEL", "groq")
    planned_stages = [s[0] for s in STAGES]
    if with_android:
        planned_stages.append("android")

    write_manifest(
        run_dir / "manifest.json",
        sha=sha,
        pr=pr,
        branch=branch,
        base_url=base_url,
        cases_version=cases_version,
        judge_model_env=judge_model_env,
        planned_stages=planned_stages,
    )

    # Stage execution — every stage records a status; the verdict below is
    # refused when execution was partial (§19: never convert INFRA/partial to PASS).
    # ok | gate_fail | blocked | infra_fail | skipped_offline
    stage_status: dict[str, str] = {}
    report_exit_code = None

    # STAGE 1: drift_check
    logger.info("--- Stage 1: drift_check ---")
    cmd = build_drift_check_cmd(run_dir)
    exit_code, _ = run_stage("drift_check", cmd, logs_dir, offline_only)
    stage_status["drift_check"] = "ok" if exit_code == 0 else "infra_fail"
    if exit_code != 0:
        logger.error(f"drift_check failed with exit {exit_code}")

    # STAGE 2: run_technician + safety
    if offline_only:
        logger.info("--- Stage 2: run_technician (OFFLINE, skipped by design) ---")
        if baseline:
            logger.info("Using archived results from baseline")
            stage_status["technician_safety"] = "skipped_offline"
        else:
            logger.error("offline mode without --baseline: nothing to score")
            stage_status["technician_safety"] = "blocked"
    else:
        logger.info("--- Stage 2: run_technician + safety ---")
        can_run, infra_err = run_technician_infra_check()
        if not can_run:
            logger.error(f"run_technician BLOCKED: {infra_err}")
            stage_status["technician_safety"] = "blocked"
        else:
            cmd = build_run_technician_cmd(run_dir, cases)
            exit_code, _ = run_stage("run_technician", cmd, logs_dir, offline_only)
            stage_status["technician_safety"] = "ok" if exit_code == 0 else "infra_fail"
            if exit_code != 0:
                logger.error(f"run_technician failed with exit {exit_code}")

    # STAGE 3: judge_baseline
    logger.info("--- Stage 3: judge_baseline ---")
    if offline_only and baseline:
        # Copy baseline scores to run_dir for judge to re-judge
        logger.info("Copying baseline scores for re-judgment (offline mode)")
        baseline_scores = baseline / "scores"
        if baseline_scores.exists():
            import shutil

            dest_scores = run_dir / "scores"
            if dest_scores.exists():
                shutil.rmtree(dest_scores)
            shutil.copytree(baseline_scores, dest_scores)
            logger.info(f"Copied {baseline_scores} -> {dest_scores}")

    can_run, infra_err = judge_baseline_infra_check()
    if not can_run and not offline_only:
        logger.error(f"judge_baseline BLOCKED: {infra_err}")
        stage_status["judge_baseline"] = "blocked"
    else:
        cmd = build_judge_baseline_cmd(run_dir)
        exit_code, _ = run_stage("judge_baseline", cmd, logs_dir, offline_only)
        if exit_code == 0:
            stage_status["judge_baseline"] = "ok"
        elif offline_only and (run_dir / "scores" / "_summary.json").exists():
            # Offline: the archived scores ARE the judged corpus. A judge that
            # cannot re-judge (e.g. no API key) is acceptable here ONLY because
            # the summary it would produce already exists in the run dir.
            logger.info(
                f"judge_baseline exited {exit_code}; archived scores/_summary.json present (offline) — accepted"
            )
            stage_status["judge_baseline"] = "ok"
        else:
            logger.error(f"judge_baseline failed with exit {exit_code}")
            stage_status["judge_baseline"] = "infra_fail"

    # STAGE 4: report
    logger.info("--- Stage 4: report ---")
    cmd = build_report_cmd(run_dir, baseline)
    exit_code, _ = run_stage("report", cmd, logs_dir, offline_only)
    report_exit_code = exit_code
    if exit_code == 0:
        stage_status["report"] = "ok"
    elif exit_code == 3:
        stage_status["report"] = "gate_fail"
    else:
        logger.error(f"report failed with exit {exit_code}")
        stage_status["report"] = "infra_fail"

    # STAGE 5 (optional): android
    if with_android:
        logger.info("--- Stage 5: run_android_workflows ---")
        cmd = build_android_cmd(run_dir)
        exit_code, _ = run_stage("android", cmd, logs_dir, offline_only)
        stage_status["android"] = "ok" if exit_code == 0 else "infra_fail"
        if exit_code != 0:
            logger.error(f"android failed with exit {exit_code}")

    # Persist per-stage outcomes into the manifest next to the plan.
    manifest_path = run_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        manifest = {}
    manifest["stages_result"] = stage_status
    manifest["timestamp_end"] = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    # VERDICT (§13/§19): required-stage trouble ALWAYS wins over the report exit.
    # A report that scored stale, partial, or missing inputs must never green
    # (or even HOLD) the gate — partial execution is an infrastructure verdict.
    bad_stages = [s for s, st in stage_status.items() if st in ("blocked", "infra_fail")]
    for stage_name, st in stage_status.items():
        logger.info(f"stage {stage_name}: {st}")
    if bad_stages:
        logger.error(f"VERDICT: INFRA_FAILURE (stages not cleanly executed: {', '.join(bad_stages)})")
        print("\nVERDICT: INFRA_FAILURE (exit 4)")
        return 4
    if report_exit_code == 3:
        logger.info("VERDICT: HOLD (from report §13 verdict logic)")
        print("\nVERDICT: HOLD (exit 3)")
        return 3
    logger.info("VERDICT: PASS (from report §13 verdict logic)")
    print("\nVERDICT: PASS (exit 0)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
