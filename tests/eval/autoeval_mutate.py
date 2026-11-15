"""Mutation proof for autoeval (criterion 8). Python only; no bash.

For each guard: copy the autoeval sources, fixtures and tests into a temp tree (git-initialised,
so the CLI's `git rev-parse` works there), remove ONE guard, and run the named test(s). A mutation
counts as caught only if every named test is in the FAILED set, passed > 0, and there are no
collection or import errors. The unmutated control must be fully green.

Usage: python3.12 tests/eval/autoeval_mutate.py
"""

from __future__ import annotations

import json
import os
import pathlib
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
TEST_FILES = [
    f"tests/eval/{p.name}" for p in sorted((REPO / "tests" / "eval").glob("test_autoeval_*.py"))
]
FIXTURE = "evals/results/f06922ac6-cov100"

# (module, old text, new text, named tests that must go red)
MUTATIONS = [
    # autoeval_budget.py: every guard runs before the request
    (
        "autoeval_budget.py",
        "if cfg.sentinel.exists():",
        "if False:",
        ["test_kill_sentinel_stops_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if self.clock() >= _epoch(cfg.paid_not_after):",
        "if False:",
        ["test_paid_not_after_stops_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if not cfg.expect_org:",
        "if False:",
        ["test_empty_expect_org_refuses_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if foreign:",
        "if False:",
        ["test_foreign_org_already_in_ledger_refuses_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if spent + usd > cfg.total_cap_usd:",
        "if False:",
        ["test_total_cap_stops_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if day_spent + usd > cfg.daily_cap_usd:",
        "if False:",
        ["test_daily_cap_stops_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if price is None:",
        "if False:",
        ["test_unpriced_model_is_refused_before_any_request"],
    ),
    (
        "autoeval_budget.py",
        "if cfg.expect_org and org != cfg.expect_org:",
        "if False:",
        ["test_wrong_org_on_the_response_stops_after_booking"],
    ),
    (
        "autoeval_budget.py",
        '"input_tokens" not in usage or "output_tokens" not in usage',
        "False",
        ["test_missing_usage_stops_and_keeps_worst_case_booked"],
    ),
    (
        "autoeval_budget.py",
        "if code != 200:",
        "if False:",
        ["test_billing_error_stops_without_fallback"],
    ),
    (
        "autoeval_budget.py",
        "class BudgetStop(SystemExit):",
        "class BudgetStop(Exception):",
        ["test_stop_is_a_systemexit_so_harness_except_cannot_swallow_it"],
    ),
    (
        "autoeval_budget.py",
        'reserved[r["id"]] = (r["day"], float(r["usd"]))',
        'reserved[r["id"]] = (r["day"], 0.0)',
        ["test_unsettled_reservation_counts_as_spent"],
    ),
    (
        "autoeval_budget.py",
        'raise BudgetStop(f"STOP: ledger unreadable ({e}) - spend is uncertain") from e',
        "return []",
        ["test_corrupt_ledger_stops"],
    ),
    # autoeval_judge.py: recall, dry, truncation and the cache key
    (
        "autoeval_judge.py",
        "if hit is not None:",
        "if False:",
        ["test_second_run_over_the_same_set_makes_zero_judge_calls"],
    ),
    (
        "autoeval_judge.py",
        'if env.mode == "dry":',
        "if False:",
        ["test_dry_run_makes_no_request_fetches_no_key_and_spends_nothing"],
    ),
    (
        "autoeval_judge.py",
        'if reply.stop_reason == "max_tokens":',
        "if False:",
        ["test_truncated_verdict_is_an_error_and_is_not_rebilled"],
    ),
    (
        "autoeval_judge.py",
        "if self.get(key) is not None:",
        "if False:",
        ["test_same_key_is_never_written_twice"],
    ),
    (
        "autoeval_judge.py",
        '"params": params}',
        '"params": {}}',
        ["test_cache_key_is_canonical_and_sensitive_to_each_input"],
    ),
    (
        "autoeval_judge.py",
        '"prompt": prompt, "model": model',
        '"prompt": "", "model": model',
        ["test_changed_rubric_rejudges_only_the_safety_cases"],
    ),
    # autoeval_select.py: selection and count judgement
    (
        "autoeval_select.py",
        "if ln.always:",
        "if False:",
        ["test_docs_only_change_selects_only_the_always_safety_lane"],
    ),
    (
        "autoeval_select.py",
        "elif unmapped:",
        "elif False:",
        ["test_unmapped_code_path_selects_every_lane"],
    ),
    (
        "autoeval_select.py",
        'if counts.get("passed", 0) == 0 or rc != 0:',
        "if rc != 0:",
        [
            "test_lane_with_zero_passed_and_no_failure_is_infra_error",
            "test_lane_with_no_count_is_infra_error_never_pass",
        ],
    ),
    (
        "autoeval_select.py",
        'if counts.get("failed", 0) or counts.get("errors", 0):',
        "if False:",
        ["test_lane_with_a_failure_count_is_fail_and_outranks_infra"],
    ),
    # autoeval_report.py: transitions, footer strip, marker, mission state
    (
        "autoeval_select.py",
        'output = _ANSI.sub("", output)',
        "pass",
        ["test_counts_parse_real_coloured_vitest_output"],
    ),
    (
        "autoeval_report.py",
        "if awaiting:  # a dry cache miss",
        "if False:  # a dry cache miss",
        ["test_cases_awaiting_a_paid_judge_fire_as_paid_required_not_execution_failure"],
    ),
    (
        "autoeval_report.py",
        'if len(m["unscored"]) - awaiting > UNSCORED_LIMIT:',
        'if len(m["unscored"]) > UNSCORED_LIMIT:',
        ["test_cases_awaiting_a_paid_judge_fire_as_paid_required_not_execution_failure"],
    ),
    (
        "autoeval_report.py",
        'kind = "hard_stop" if err.startswith("STOP:") else "execution_failure"',
        'kind = "execution_failure"',
        ["test_a_hard_stop_fires_as_hard_stop_not_execution_failure"],
    ),
    (
        "autoeval_report.py",
        "active = set(current) | (prev if err else set())",
        "active = set(current)",
        ["test_a_stopped_run_keeps_earlier_alerts_active_so_they_do_not_fire_again"],
    ),
    (
        "autoeval_report.py",
        "active = set(current) | (prev if err else set())",
        "active = set(current) | prev",
        ["test_control_a_complete_clean_run_clears_the_alert_so_a_return_fires_again"],
    ),
    (
        "autoeval_report.py",
        'prev = set(state.get("active", []))',
        "prev = set()",
        ["test_newly_dangerous_safety_case_fires_once_then_not_on_an_unchanged_run"],
    ),
    (
        "autoeval_report.py",
        'if not ln.startswith("(generated ")',
        "if True",
        ["test_gate_text_is_stable_and_has_no_wall_clock_footer"],
    ),
    (
        "autoeval_report.py",
        'state = "BLOCKED" if hard else',
        'state = "PARTIAL" if hard else',
        ["test_mission_control_state_is_blocked_on_a_failing_safety_lane"],
    ),
    # autoeval_run.py: paid.json is required before any paid run
    (
        "autoeval.py",
        '"api": part.get("api", 0),',
        '"api": 0,',
        ["test_budget_threshold_fires_when_a_paid_run_crosses_50_percent"],
    ),
    (
        "autoeval_run.py",
        "**{k: hit.get(k) for k in _META},",
        "**{k: None for k in _META},",
        ["test_stored_verdicts_name_what_produced_them_and_where_the_evidence_is"],
    ),
    (
        "autoeval_run.py",
        "if not p.exists():",
        "if False:",
        ["test_paid_mode_without_paid_json_refuses_to_start"],
    ),
]

COUNT = re.compile(r"(\d+) (passed|failed|errors?)\b")


def build(root: pathlib.Path, module: str | None, old: str | None, new: str | None) -> None:
    sc = root / "evals" / "scripts"
    sc.mkdir(parents=True)
    for p in (REPO / "evals" / "scripts").glob("autoeval*.py"):
        shutil.copy(p, sc / p.name)
    shutil.copy(REPO / "evals" / "scripts" / "judge_baseline.py", sc / "judge_baseline.py")
    shutil.copy(REPO / "evals" / "scripts" / "report.py", sc / "report.py")
    shutil.copy(REPO / "evals" / "autoeval.lanes.json", root / "evals" / "autoeval.lanes.json")
    (root / "printsense").mkdir()
    shutil.copy(REPO / "printsense" / "cas.py", root / "printsense" / "cas.py")
    (root / "tools").mkdir()
    shutil.copy(REPO / "tools" / "r2_signal_floor.py", root / "tools" / "r2_signal_floor.py")
    shutil.copytree(REPO / FIXTURE, root / FIXTURE)
    (root / "tests" / "eval").mkdir(parents=True)
    for rel in TEST_FILES:
        shutil.copy(REPO / rel, root / rel)
    for lane in json.loads((REPO / "evals" / "autoeval.lanes.json").read_text())["lanes"]:
        for step in lane["steps"]:  # every lane test file, so the existence test sees the same tree
            for f in step["files"]:
                rel = posixpath.normpath(posixpath.join(step["cwd"], f))
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(REPO / rel, root / rel)
    if module is not None:
        target = sc / module
        text = target.read_text()
        if text.count(old) != 1:
            raise SystemExit(f"mutation not applicable ({text.count(old)} matches): {old!r}")
        target.write_text(text.replace(old, new))
    env = {
        "GIT_AUTHOR_NAME": "mut",
        "GIT_AUTHOR_EMAIL": "mut@local",
        "GIT_COMMITTER_NAME": "mut",
        "GIT_COMMITTER_EMAIL": "mut@local",
        "HOME": str(root),
    }
    subprocess.run(["git", "init", "-q"], cwd=root, check=True, env={**os.environ, **env})
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, env={**os.environ, **env})
    subprocess.run(
        ["git", "commit", "-q", "-m", "base"], cwd=root, check=True, env={**os.environ, **env}
    )


def run_tests(root: pathlib.Path) -> tuple[dict[str, int], set[str], str]:
    env = {
        **os.environ,
        "AUTOEVAL_REPO": str(root),
        "AUTOEVAL_SCRIPTS": str(root / "evals" / "scripts"),
    }
    p = subprocess.run(
        [sys.executable, "-m", "pytest", *TEST_FILES, "-q", "-p", "no:cacheprovider", "-rf"],
        cwd=root,
        capture_output=True,
        text=True,
        env=env,
    )
    out = p.stdout + p.stderr
    summary = [ln for ln in out.splitlines() if COUNT.search(ln)]
    counts: dict[str, int] = {}
    for num, kind in COUNT.findall(summary[-1] if summary else ""):
        key = "errors" if kind.startswith("error") else kind
        counts[key] = counts.get(key, 0) + int(num)
    failed = set(re.findall(r"^FAILED \S+::(\w+)", out, flags=re.MULTILINE))
    return counts, failed, out


def main() -> int:
    ok = True
    with tempfile.TemporaryDirectory() as d:
        base = pathlib.Path(d) / "control"
        build(base, None, None, None)
        counts, failed, out = run_tests(base)
        control_green = counts.get("passed", 0) > 0 and not failed and not counts.get("errors")
        print(f"control: counts={counts} failed={sorted(failed)} green={control_green}")
        if not control_green:
            print(out[-2000:])
        ok &= control_green
        for i, (module, old, new, named) in enumerate(MUTATIONS):
            root = pathlib.Path(d) / f"m{i:02d}"
            build(root, module, old, new)
            counts, failed, _ = run_tests(root)
            caught = (
                set(named) <= {n for n in failed}
                and counts.get("passed", 0) > 0
                and not counts.get("errors")
            )
            ok &= caught
            tag = "RED " if caught else "NOT-RED"
            print(
                f"{tag} {module}: {old!r} -> {new!r}: counts(failed,passed)="
                f"({counts.get('failed', 0)},{counts.get('passed', 0)}) errors={counts.get('errors', 0)} "
                f"named={named} failed_named={sorted(set(named) & failed)}"
            )
    print("MUTATION PROOF:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
