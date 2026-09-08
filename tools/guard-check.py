#!/usr/bin/env python3
"""Answer "does this PR need the `legacy-ui-exception` label?" in seconds.

WHY THIS EXISTS
---------------
On 2026-09-08 three sessions spent an afternoon inferring that answer from red
`Legacy UI Lifecycle Guard` badges, and got it wrong in both directions:

  * one session read a red check and inferred a guarded-path violation, when the
    guard was actually erroring on `exception approval metadata is missing
    required GitHub objects` — a bug fixed in #3689 that still ran on any PR
    whose BASE predated the fix, because the workflow uses `pull_request_target`
    and executes only `base.sha`'s copy. Updating the base changed the failure's
    REASON, not its OUTCOME;
  * another read the registry globs and concluded `mira-hub/src/components/**`
    was exempt. It is not.

A red badge tells you the check failed. It does not tell you WHICH files the
guard objects to, or whether it objects at all. This asks the guard directly.

CONTROLS ARE NOT OPTIONAL
-------------------------
Every run first evaluates one path that MUST be allowed and one that MUST be
denied, and aborts if either misbehaves. Without them a tool that returned
"blocked" for everything would be indistinguishable from a correct one on a day
when everything is blocked — which is exactly the day this was written.

USAGE
    tools/guard-check.py 3693 3682          # by PR number (needs `gh`)
    tools/guard-check.py --files a.ts b.tsx # by path

Use the CommandLineTools interpreter: Homebrew's python3 lacks the deps.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))

from ui_surface_lifecycle_guard import (  # noqa: E402
    ChangedFile,
    evaluate,
    load_guard_policy,
)

REGISTRY = REPO / "docs/architecture/convergence/REGISTRY.yaml"

# One path that must pass and one that must fail. If either flips, the guard's
# scope changed or this tool is broken — and every verdict below is unreliable.
CONTROLS = [("docs/README.md", True), ("mira-hub/src/app/(hub)/feed/page.tsx", False)]


def guarded(policy, paths: list[str]) -> list[str]:
    return [
        p
        for p in paths
        if not evaluate(
            [ChangedFile(path=p, status="modified")], [], "", policy,
            exception_approval_valid=False,
        ).allowed
    ]


def pr_files(number: str) -> list[str]:
    out = subprocess.run(
        ["gh", "pr", "view", number, "--json", "files", "-q", ".files[].path"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.split()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("prs", nargs="*", help="PR numbers")
    ap.add_argument("--files", nargs="*", default=[], help="paths instead of a PR")
    args = ap.parse_args()

    policy = load_guard_policy(str(REGISTRY))

    for path, expect in CONTROLS:
        got = not guarded(policy, [path])
        state = "ok" if got == expect else "BROKEN"
        print(f"CONTROL {path:<44} allowed={got}  expect={expect}  {state}")
        if got != expect:
            print("\nControls failed — every verdict below would be unreliable. Aborting.",
                  file=sys.stderr)
            return 2
    print()

    blocked = 0
    for number in args.prs:
        files = pr_files(number)
        hits = guarded(policy, files)
        blocked += bool(hits)
        print(f"#{number}  needs-label={bool(hits)}  guarded {len(hits)}/{len(files)}")
        for h in hits:
            print(f"    {h}")
    if args.files:
        hits = guarded(policy, args.files)
        blocked += bool(hits)
        print(f"files  needs-label={bool(hits)}  guarded {len(hits)}/{len(args.files)}")
        for h in hits:
            print(f"    {h}")
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
