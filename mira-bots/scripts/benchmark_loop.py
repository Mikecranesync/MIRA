#!/usr/bin/env python3
"""MIRA Benchmark Autonomous Loop — harvest → benchmark → judge → iterate.

Runs up to MAX_ITERATIONS cycles. Each cycle:
  1. Harvest questions from Reddit (local, no creds)
  2. Sync new questions to BRAVO DB
  3. Run benchmark on BRAVO (real Claude inference)
  4. Capture report
  5. LLM-as-judge evaluation (Claude claude-opus-4-5)
  6. Log results, attempt adaptive fixes
  7. Exit if judge score >= 8 or iterations exhausted

Usage:
    doppler run --project factorylm --config prd -- python mira-bots/scripts/benchmark_loop.py
"""

import csv
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

import anthropic

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MAX_ITERATIONS = 100
TARGET_SCORE = 8
INTER_ITERATION_WAIT = 30  # seconds
LOCAL_DB = os.getenv("MIRA_DB_PATH", "./data/mira.db")
BRAVO_DB = "/Users/bravonode/Mira/mira-bridge/data/mira.db"
CONTAINER_DB = "/data/mira.db"
CONTAINER = "mira-bot-telegram"
DOCKER_PATH = "/usr/local/bin:/opt/homebrew/bin"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

# Timestamp for this loop session
SESSION_TS = datetime.now().strftime("%Y%m%d_%H%M%S")
RESULTS_DIR = os.path.join(REPO_ROOT, "mira-bots", "benchmark_results", f"loop_{SESSION_TS}")
os.makedirs(RESULTS_DIR, exist_ok=True)

LOG_CSV = os.path.join(RESULTS_DIR, "loop_log.csv")
JUDGE_JSONL = os.path.join(RESULTS_DIR, "judge_evaluations.jsonl")
FINAL_REPORT = os.path.join(RESULTS_DIR, "final_report.txt")

JUDGE_PROMPT = """You are a research quality evaluator assessing an AI benchmark for
industrial maintenance diagnostic systems.

Evaluate the following benchmark report and score it from 1 to 10
where:
  1-3 = poor (too few questions, results not meaningful)
  4-6 = acceptable (emerging signal but not publishable)
  7   = good (meaningful results, minor gaps)
  8-9 = great (publication-ready, strong signal)
  10  = excellent (rigorous, multi-domain, statistically robust)

Scoring criteria:
  - Corpus size: n<10 caps score at 5, n<30 caps at 7, n>=50 allows 8+
  - Confidence distribution: all-medium = cap at 6 (no LLM inference hit)
  - High confidence rate: >30% needed for score 7+, >40% for score 8+
  - Error rate: >10% errors caps score at 5
  - Subreddit diversity: single subreddit caps at 7
  - Latency: mean >15s caps at 7 (mobile UX unacceptable)
  - GSD compliance: if any responses gave direct answers, cap at 6

Benchmark Report:
{report}

Respond in this exact JSON format:
{{"score": <integer 1-10>, "corpus_size": <integer>, "high_confidence_pct": <float>, "error_rate": <float>, "blocking_issues": ["<issue 1>", "<issue 2>"], "what_to_fix_next": "<single most impactful improvement>", "reasoning": "<2-3 sentence evaluation>"}}"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def run_local(cmd: str, timeout: int = 120) -> tuple[int, str]:
    """Run a local command, return (exit_code, output)."""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return 1, "TIMEOUT"


def run_bravo(cmd: str, timeout: int = 300) -> tuple[int, str]:
    """Run a command on BRAVO via SSH. Uses double quotes for Windows compatibility."""
    # Use subprocess list form to avoid shell quoting issues
    try:
        result = subprocess.run(
            ["ssh", "bravo", cmd],
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return 1, "TIMEOUT"


def run_container(python_cmd: str, timeout: int = 600) -> tuple[int, str]:
    """Run a Python command inside mira-bot-telegram on BRAVO."""
    escaped = python_cmd.replace("'", "'\\''")
    cmd = (
        f"export PATH={DOCKER_PATH}:$PATH && "
        f"docker exec -e PYTHONPATH=/app {CONTAINER} python -c '{escaped}'"
    )
    return run_bravo(cmd, timeout=timeout)


def run_container_script(
    script_path: str, env_extras: str = "", timeout: int = 600
) -> tuple[int, str]:
    """Run a Python script inside mira-bot-telegram on BRAVO."""
    cmd = (
        f"export PATH={DOCKER_PATH}:$PATH && "
        f"docker exec {env_extras} {CONTAINER} python {script_path}"
    )
    return run_bravo(cmd, timeout=timeout)


# ---------------------------------------------------------------------------
# Step 1: Harvest
# ---------------------------------------------------------------------------


def harvest() -> dict:
    """Run reddit_harvest.py locally. Returns harvest result dict."""
    log("HARVEST: Running reddit_harvest.py ...")
    env = os.environ.copy()
    env["MIRA_DB_PATH"] = LOCAL_DB
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        result = subprocess.run(
            [sys.executable, os.path.join(REPO_ROOT, "mira-core", "scripts", "reddit_harvest.py")],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
            encoding="utf-8",
            errors="replace",
        )
        output = result.stdout + result.stderr
        log(f"HARVEST: exit={result.returncode}")
        # Parse last line for result dict
        for line in reversed(output.strip().split("\n")):
            if "Result:" in line:
                m = re.search(r"\{.*\}", line)
                if m:
                    # Python repr uses single quotes — convert to valid JSON
                    raw = m.group().replace("'", '"')
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        pass
        # Parse "Total inserted" line
        for line in output.split("\n"):
            if "Total inserted" in line:
                log(f"HARVEST: {line.strip()}")
        return {"harvested": 0, "skipped": 0, "total": 0}
    except Exception as exc:
        log(f"HARVEST ERROR: {exc}")
        return {"harvested": 0, "skipped": 0, "total": 0, "error": str(exc)}


# ---------------------------------------------------------------------------
# Step 2: Sync new questions to BRAVO
# ---------------------------------------------------------------------------


def sync_to_bravo() -> int:
    """Export all local questions as INSERT OR IGNORE, run on BRAVO. Returns count."""
    log("SYNC: Exporting questions to BRAVO ...")
    db = sqlite3.connect(LOCAL_DB)
    rows = db.execute(
        "SELECT source, subreddit, post_id, title, body, score, url, harvested_at "
        "FROM benchmark_questions"
    ).fetchall()
    db.close()

    if not rows:
        log("SYNC: No questions to sync")
        return 0

    # Build SQL file
    sql_path = os.path.join(RESULTS_DIR, "sync.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        for r in rows:
            vals = []
            for v in r:
                if isinstance(v, str):
                    vals.append("'" + v.replace("'", "''") + "'")
                elif v is None:
                    vals.append("NULL")
                else:
                    vals.append(str(v))
            f.write(
                "INSERT OR IGNORE INTO benchmark_questions "
                "(source, subreddit, post_id, title, body, score, url, harvested_at) "
                f"VALUES ({', '.join(vals)});\n"
            )

    # SCP to BRAVO (convert Windows backslashes to forward slashes for scp)
    scp_path = sql_path.replace("\\", "/")
    rc, out = run_local(f"scp {scp_path} bravo:/tmp/benchmark_sync.sql", timeout=15)
    if rc != 0:
        log(f"SYNC: SCP failed: {out}")
        return 0

    # Run SQL on BRAVO
    rc, out = run_bravo(
        f"sqlite3 {BRAVO_DB} < /tmp/benchmark_sync.sql && "
        f"sqlite3 {BRAVO_DB} 'SELECT COUNT(*) FROM benchmark_questions;'"
    )
    if rc == 0:
        count = int(out.strip().split("\n")[-1])
        log(f"SYNC: BRAVO now has {count} questions")
        return count
    else:
        log(f"SYNC ERROR: {out}")
        return 0


# ---------------------------------------------------------------------------
# Step 3: Run benchmark on BRAVO
# ---------------------------------------------------------------------------


def run_benchmark(limit: int = 20) -> dict:
    """Run benchmark inside mira-bot-telegram container. Returns result dict."""
    log(f"BENCHMARK: Running {limit} questions on BRAVO ...")

    # First, make sure the latest runner script is on BRAVO
    runner_local = os.path.join(
        REPO_ROOT, "mira-bots", "scripts", "reddit_benchmark_run.py"
    ).replace("\\", "/")
    run_local(f"scp {runner_local} bravo:/tmp/reddit_benchmark_run.py", timeout=15)
    run_bravo(
        f"export PATH={DOCKER_PATH}:$PATH && "
        f"docker cp /tmp/reddit_benchmark_run.py {CONTAINER}:/app/scripts/reddit_benchmark_run.py"
    )

    # Also sync benchmark_db.py
    bdb_local = os.path.join(REPO_ROOT, "mira-bots", "shared", "benchmark_db.py").replace("\\", "/")
    run_local(f"scp {bdb_local} bravo:/tmp/benchmark_db.py", timeout=15)
    run_bravo(
        f"export PATH={DOCKER_PATH}:$PATH && "
        f"docker cp /tmp/benchmark_db.py {CONTAINER}:/app/shared/benchmark_db.py"
    )

    rc, out = run_container_script(
        "/app/scripts/reddit_benchmark_run.py",
        env_extras=f"-e PYTHONPATH=/app -e BENCHMARK_LIMIT={limit}",
        timeout=600,
    )

    log(f"BENCHMARK: exit={rc}")
    for line in out.strip().split("\n"):
        if "Result:" in line or "finished:" in line:
            log(f"BENCHMARK: {line.strip()}")

    # Parse result
    for line in reversed(out.strip().split("\n")):
        if "Result:" in line:
            m = re.search(r"\{.*\}", line)
            if m:
                raw = m.group().replace("'", '"')
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    pass
    return {"run_id": 0, "processed": 0, "errors": 0}


# ---------------------------------------------------------------------------
# Step 4: Capture report
# ---------------------------------------------------------------------------


def capture_report(run_id: int = 0) -> str:
    """Run report generator on BRAVO and capture output."""
    log(f"REPORT: Generating report (run_id={run_id}) ...")

    # Sync report script
    report_local = os.path.join(
        REPO_ROOT, "mira-bots", "scripts", "reddit_benchmark_report.py"
    ).replace("\\", "/")
    run_local(f"scp {report_local} bravo:/tmp/reddit_benchmark_report.py", timeout=15)
    run_bravo(
        f"export PATH={DOCKER_PATH}:$PATH && "
        f"docker cp /tmp/reddit_benchmark_report.py {CONTAINER}:/app/scripts/reddit_benchmark_report.py"
    )

    args = f"--run-id {run_id}" if run_id else ""
    rc, out = run_container_script(
        f"/app/scripts/reddit_benchmark_report.py {args}",
        env_extras="-e PYTHONPATH=/app",
        timeout=60,
    )

    if rc == 0:
        log(f"REPORT: Captured ({len(out)} chars)")
        return out.strip()
    else:
        log(f"REPORT ERROR: {out[:200]}")
        return out.strip()


# ---------------------------------------------------------------------------
# Step 5: LLM Judge
# ---------------------------------------------------------------------------


def judge_report(report_text: str, iteration: int) -> dict:
    """Call Claude as judge. Returns parsed JSON."""
    log("JUDGE: Evaluating report ...")

    client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY from env

    prompt = JUDGE_PROMPT.format(report=report_text)

    try:
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Parse JSON from response
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            result = json.loads(m.group())
            log(f"JUDGE: score={result.get('score', '?')}/10")
            return result
        else:
            log(f"JUDGE: Could not parse JSON from response: {raw[:200]}")
            return {"score": 0, "reasoning": raw[:500], "blocking_issues": ["parse_error"]}

    except Exception as exc:
        log(f"JUDGE ERROR: {exc}")
        return {"score": 0, "reasoning": str(exc), "blocking_issues": ["api_error"]}


# ---------------------------------------------------------------------------
# Step 6: Adaptive fixes
# ---------------------------------------------------------------------------


def attempt_adaptive_fix(judge_result: dict, iteration: int):
    """Attempt automatic fixes based on judge feedback."""
    issues = judge_result.get("blocking_issues", [])
    fix = judge_result.get("what_to_fix_next", "")

    issues_str = " | ".join(issues).lower()
    fix_lower = fix.lower()

    if "corpus too small" in issues_str or "corpus" in fix_lower:
        log("ADAPTIVE: Corpus too small — running extra harvest")
        harvest()
        time.sleep(5)
        harvest()
        sync_to_bravo()

    if "single subreddit" in issues_str or "diversity" in fix_lower:
        log(
            "ADAPTIVE: Subreddit diversity issue — harvest targets all 5, Reddit rate limits are the bottleneck"
        )

    if "canned response" in issues_str or "intent guard" in issues_str:
        log(
            "ADAPTIVE: Intent guard issue — questions may not match industrial keywords. Harvest filter should handle this."
        )

    if "latency" in issues_str:
        log("ADAPTIVE: High latency flagged — logging for manual review (Nemotron pipeline)")

    if "low high-confidence" in issues_str or "confidence" in fix_lower:
        log(
            "ADAPTIVE: Low confidence — would need knowledge ingestion for specific equipment types (manual step)"
        )


# ---------------------------------------------------------------------------
# Step 7: Logging
# ---------------------------------------------------------------------------


def init_log():
    """Create CSV log with headers."""
    with open(LOG_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "iteration",
                "timestamp",
                "corpus_size",
                "new_harvested",
                "benchmark_processed",
                "benchmark_errors",
                "high_pct",
                "med_pct",
                "low_pct",
                "none_pct",
                "mean_latency_ms",
                "error_rate",
                "judge_score",
                "blocking_issues",
                "what_to_fix_next",
            ]
        )


def append_log(
    iteration: int,
    harvest_result: dict,
    benchmark_result: dict,
    judge_result: dict,
    corpus_size: int,
):
    """Append one row to the CSV log."""
    # Parse confidence from judge result
    high_pct = judge_result.get("high_confidence_pct", 0)
    error_rate = judge_result.get("error_rate", 0)

    with open(LOG_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                iteration,
                datetime.now(timezone.utc).isoformat(),
                corpus_size,
                harvest_result.get("harvested", 0),
                benchmark_result.get("processed", 0),
                benchmark_result.get("errors", 0),
                high_pct,
                judge_result.get("med_pct", 0),
                judge_result.get("low_pct", 0),
                judge_result.get("none_pct", 0),
                judge_result.get("mean_latency_ms", 0),
                error_rate,
                judge_result.get("score", 0),
                " | ".join(judge_result.get("blocking_issues", [])),
                judge_result.get("what_to_fix_next", ""),
            ]
        )

    # Append judge JSON
    with open(JUDGE_JSONL, "a", encoding="utf-8") as f:
        entry = {"iteration": iteration, **judge_result}
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Final output
# ---------------------------------------------------------------------------


def write_final_output(iterations: list[dict], final_judge: dict):
    """Write final report and optional arXiv paragraph."""
    with open(FINAL_REPORT, "w", encoding="utf-8") as f:
        f.write("MIRA Benchmark Autonomous Loop — Final Report\n")
        f.write("=" * 60 + "\n")
        f.write(f"Session: {SESSION_TS}\n")
        f.write(f"Iterations completed: {len(iterations)}\n")
        f.write(f"Final judge score: {final_judge.get('score', '?')}/10\n\n")

        # Summary table
        f.write("Iteration Log:\n")
        f.write(
            f"{'#':>3} {'Corpus':>6} {'New':>4} {'Proc':>4} {'Err':>3} {'Score':>5} {'Issues'}\n"
        )
        f.write("-" * 70 + "\n")
        for it in iterations:
            f.write(
                f"{it['iteration']:>3} "
                f"{it['corpus_size']:>6} "
                f"{it['harvested']:>4} "
                f"{it['processed']:>4} "
                f"{it['errors']:>3} "
                f"{it['score']:>5} "
                f"{it.get('blocking_issues', '')}\n"
            )

        f.write("\n\nFinal Judge Evaluation:\n")
        f.write(json.dumps(final_judge, indent=2) + "\n")

        # 3-bullet summary
        if iterations:
            first = iterations[0]
            last = iterations[-1]
            f.write("\n\nSummary:\n")
            f.write(
                f"  - Starting state: {first['corpus_size']} questions, score {first['score']}/10\n"
            )
            f.write(f"  - Final state: {last['corpus_size']} questions, score {last['score']}/10\n")

            # Find biggest score jump
            best_jump = 0
            best_jump_iter = 0
            for i in range(1, len(iterations)):
                jump = iterations[i]["score"] - iterations[i - 1]["score"]
                if jump > best_jump:
                    best_jump = jump
                    best_jump_iter = i
            if best_jump > 0:
                f.write(
                    f"  - Biggest improvement: +{best_jump} points at iteration {best_jump_iter + 1}\n"
                )
            else:
                f.write("  - Score remained stable across iterations\n")

    # arXiv paragraph if score >= 8
    if final_judge.get("score", 0) >= TARGET_SCORE:
        arxiv_path = os.path.join(RESULTS_DIR, "arxiv_results_paragraph.md")
        corpus = final_judge.get("corpus_size", 0)
        high = final_judge.get("high_confidence_pct", 0)
        err = final_judge.get("error_rate", 0)
        with open(arxiv_path, "w", encoding="utf-8") as f:
            f.write(
                f"Over {len(iterations)} benchmark runs across {corpus} questions "
                f"harvested from r/IndustrialMaintenance, r/PLC, r/electricians, "
                f"r/HVAC, and r/AutomationTechnology, MIRA achieved {high:.0f}% "
                f"high-confidence classification with an error rate of {err:.1f}%. "
                f"The autonomous evaluation loop scored {final_judge['score']}/10 "
                f"on a research quality rubric assessed by Claude claude-opus-4-5.\n"
            )
        log(f"arXiv paragraph saved to {arxiv_path}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def main():
    log(
        f"Starting autonomous benchmark loop (max {MAX_ITERATIONS} iterations, target score {TARGET_SCORE})"
    )
    log(f"Results directory: {RESULTS_DIR}")

    # Ensure local data dir exists
    os.makedirs(os.path.dirname(LOCAL_DB), exist_ok=True)

    # Ensure benchmark tables exist locally
    from shared.benchmark_db import ensure_tables

    ensure_tables(LOCAL_DB)

    init_log()
    iterations = []
    final_judge = {}

    for i in range(1, MAX_ITERATIONS + 1):
        log(f"\n{'=' * 60}")
        log(f"ITERATION {i}/{MAX_ITERATIONS}")
        log(f"{'=' * 60}")

        # 1. Harvest
        harvest_result = harvest()

        # 2. Sync to BRAVO
        corpus_size = sync_to_bravo()

        # 3. Benchmark
        benchmark_result = run_benchmark(limit=20)
        run_id = benchmark_result.get("run_id", 0)

        # 4. Report
        report_text = capture_report(run_id=run_id)

        # Save report to file
        report_path = os.path.join(RESULTS_DIR, f"report_iter{i:03d}.txt")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report_text)

        # 5. Judge
        judge_result = judge_report(report_text, i)
        score = judge_result.get("score", 0)

        # 6. Log
        iter_data = {
            "iteration": i,
            "corpus_size": corpus_size,
            "harvested": harvest_result.get("harvested", 0),
            "processed": benchmark_result.get("processed", 0),
            "errors": benchmark_result.get("errors", 0),
            "score": score,
            "blocking_issues": " | ".join(judge_result.get("blocking_issues", [])),
        }
        iterations.append(iter_data)
        append_log(i, harvest_result, benchmark_result, judge_result, corpus_size)

        log(f"ITERATION {i} COMPLETE: corpus={corpus_size}, score={score}/10")

        # 7. Check exit conditions
        if score >= TARGET_SCORE:
            log(f"\n*** TARGET REACHED: score {score}/10 >= {TARGET_SCORE} ***")
            final_judge = judge_result
            break

        if i >= MAX_ITERATIONS:
            log(f"\n*** MAX ITERATIONS REACHED ({MAX_ITERATIONS}) ***")
            final_judge = judge_result
            break

        # 8. Adaptive fixes
        attempt_adaptive_fix(judge_result, i)

        # 9. Wait
        log(f"Waiting {INTER_ITERATION_WAIT}s before next iteration ...")
        time.sleep(INTER_ITERATION_WAIT)

        final_judge = judge_result

    # Final output
    write_final_output(iterations, final_judge)
    log(f"\nAll results saved to: {RESULTS_DIR}")

    # Print summary
    print("\n" + "=" * 60)
    print("LOOP COMPLETE")
    print("=" * 60)

    # Print log as table
    print("\nIteration Log:")
    print(f"{'#':>3} {'Corpus':>6} {'New':>4} {'Proc':>4} {'Err':>3} {'Score':>5}")
    print("-" * 40)
    for it in iterations:
        print(
            f"{it['iteration']:>3} "
            f"{it['corpus_size']:>6} "
            f"{it['harvested']:>4} "
            f"{it['processed']:>4} "
            f"{it['errors']:>3} "
            f"{it['score']:>5}"
        )

    print("\nFinal Judge Evaluation:")
    print(json.dumps(final_judge, indent=2))

    if iterations:
        first = iterations[0]
        last = iterations[-1]
        print("\nSummary:")
        print(f"  - Starting: {first['corpus_size']} questions, score {first['score']}/10")
        print(f"  - Final: {last['corpus_size']} questions, score {last['score']}/10")

    if final_judge.get("score", 0) >= TARGET_SCORE:
        arxiv_path = os.path.join(RESULTS_DIR, "arxiv_results_paragraph.md")
        if os.path.exists(arxiv_path):
            print("\narXiv Results Paragraph:")
            with open(arxiv_path, "r") as f:
                print(f.read())


if __name__ == "__main__":
    main()
