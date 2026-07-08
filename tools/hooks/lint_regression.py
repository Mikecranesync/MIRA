#!/usr/bin/env python3
"""Regression-only lint gate for tools/hooks/stop-gate.sh.

The Stop gate must block on lint violations a SESSION introduced, not on
lint debt that already existed in the file before the session touched it
(see .claude/rules/debugging-conventions.md + session-discipline.md rule 2:
"distinguish pre-existing main failures from branch-introduced regressions").
Running `ruff check`/`shellcheck` on the whole file conflates the two — a
file with one pre-existing E741 fails forever, even for edits that never
touch that line. Compare per-rule violation counts against the file's
content at the merge-base commit; only the excess counts as new.

Usage: lint_regression.py <ruff|shellcheck> <merge_base> <file> [<file> ...]
Exit 0, silent, if no new violations. Exit 1 with a summary otherwise.
Fails open (skips, doesn't block) on a file this can't check — a Stop gate
that can itself hang/crash is worse than one that occasionally under-checks.
"""

import json
import subprocess
import sys


def ruff_violations(path, content=None):
    cmd = ["ruff", "check", "--force-exclude", "--output-format=json"]
    if content is None:
        cmd.append(path)
        proc = subprocess.run(cmd, capture_output=True, text=True)
    else:
        cmd += ["--stdin-filename", path, "-"]
        proc = subprocess.run(cmd, input=content, capture_output=True, text=True)
    if not proc.stdout.strip():
        return []
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []


def shellcheck_violations(path, content=None):
    cmd = ["shellcheck", "-S", "warning", "-f", "json"]
    if content is None:
        cmd.append(path)
        proc = subprocess.run(cmd, capture_output=True, text=True)
    else:
        cmd += ["-"]
        proc = subprocess.run(cmd, input=content, capture_output=True, text=True)
    if not proc.stdout.strip():
        return []
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []


def rule_key(tool, v):
    if tool == "ruff":
        return v.get("code") or v.get("rule") or "?"
    return v.get("code") or "?"


def count_by_rule(violations, tool):
    counts = {}
    for v in violations:
        k = rule_key(tool, v)
        counts[k] = counts.get(k, 0) + 1
    return counts


def baseline_content(merge_base, path):
    proc = subprocess.run(
        ["git", "show", f"{merge_base}:{path}"], capture_output=True, text=True
    )
    if proc.returncode != 0:
        return None  # file didn't exist at baseline -> every current violation is new
    return proc.stdout


def new_violation_count(tool, path, merge_base):
    get = ruff_violations if tool == "ruff" else shellcheck_violations
    current = get(path)
    base_src = baseline_content(merge_base, path)
    baseline = get(path, content=base_src) if base_src is not None else []
    cur_counts = count_by_rule(current, tool)
    base_counts = count_by_rule(baseline, tool)
    new_total = 0
    details = []
    for rule, cnt in cur_counts.items():
        extra = cnt - base_counts.get(rule, 0)
        if extra > 0:
            new_total += extra
            details.append(f"{rule}: +{extra}")
    return new_total, details


def main():
    if len(sys.argv) < 4:
        print(
            "usage: lint_regression.py <ruff|shellcheck> <merge_base> <file> [...]",
            file=sys.stderr,
        )
        sys.exit(2)
    tool, merge_base, *paths = sys.argv[1:]
    failures = []
    for path in paths:
        try:
            new_total, details = new_violation_count(tool, path, merge_base)
        except Exception as e:  # noqa: BLE001 - fail-open, never hang the Stop hook
            print(
                f"lint_regression: {path} check errored ({e}); skipping", file=sys.stderr
            )
            continue
        if new_total > 0:
            failures.append(f"{path} ({', '.join(details)})")
    if failures:
        print(f"NEW {tool} violations introduced this session:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
