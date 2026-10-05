#!/usr/bin/env python3
"""PreToolUse hook: keep Claude's tools out of the guarded-commit approval path.

The owner authorizes one exact guarded commit with
`tools/guarded_commit_approval.py approve` at a real terminal, and the git
pre-commit hook verifies the record. This hook adds the Claude-side layer:

  deny  Write/Edit, or any Bash command, that touches the approval store
        (`<git-common-dir>/mira-guarded-approvals/`). Only `approve` writes there.
  deny  wrapping `guarded_commit_approval.py` in a pseudo-terminal tool
        (script, expect, unbuffer, socat, pexpect, pty.spawn ...). Faking a
        terminal is the forgery the approval step exists to stop.
  deny  `git commit --no-verify` / `-n`. It skips gitleaks, shellcheck and
        actionlint along with the lifecycle check; the approval path keeps them.
  ask   `git commit` while guarded paths are staged, so the owner sees the
        commit. Approving that prompt grants nothing: the git hook still
        requires the owner's terminal approval for this exact tree.

It cannot see inside a script file, and a same-user process can evade it, the
same limit as tools/hooks/prod-guard.sh. It is defence in depth, not the gate.
Reads the PreToolUse JSON from stdin (or $CLAUDE_TOOL_INPUT); prints a
permission decision only when it has one.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

STORE = "mira-guarded-approvals"
APPROVAL_TOOL = "guarded_commit_approval"
PTY_WRAPPER = re.compile(
    r"(^|[\s;&|(])(script|expect|unbuffer|socat|empty|ptyexec)\s|pexpect|pty\.spawn|openpty"
)
GIT_COMMIT = re.compile(r"(^|[\s;&|(])git(\s+-[cC]\s+\S+)*\s+commit(\s|$)")
REPO = Path(__file__).resolve().parents[2]

Decision = Optional[tuple[str, str]]


def _commit_skips_hooks(cmd: str) -> bool:
    try:
        tokens = shlex.split(cmd, comments=False, posix=True)
    except ValueError:
        tokens = cmd.split()
    takes_value = {
        "-m",
        "-F",
        "-c",
        "-C",
        "--message",
        "--file",
        "--author",
        "--date",
        "-t",
        "--template",
    }
    seen_commit = False
    skip_next = False
    for tok in tokens:
        if not seen_commit:
            seen_commit = tok == "commit"
            continue
        if tok in {";", "&&", "||", "|"}:
            seen_commit = False
            continue
        if skip_next:
            skip_next = False
            continue
        if tok == "--no-verify" or tok == "-n":
            return True
        if tok in takes_value:
            skip_next = True
            continue
        if re.fullmatch(r"-[a-zA-Z]+", tok):
            flags = tok[1:]
            head = flags.split("m", 1)[0].split("F", 1)[0]
            if "n" in head:
                return True
            if flags.endswith(("m", "F", "c", "C")):
                skip_next = True
    return False


def staged_guarded() -> list[str]:
    """Guarded paths in the current index, via the same classifier the hook uses."""
    raw = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z", "--no-renames", "--diff-filter=ACMRD"],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    paths = [p for p in raw.stdout.split("\0") if p]
    if raw.returncode != 0 or not paths:
        return []
    sys.path.insert(0, str(REPO / "tools"))
    import guarded_commit_approval  # noqa: E402

    return guarded_commit_approval.guarded_paths(paths)


def decide(payload: dict, guarded: Callable[[], list[str]] = staged_guarded) -> Decision:
    tool = payload.get("tool_name")
    ti = payload.get("tool_input") or {}
    if tool in {"Write", "Edit", "MultiEdit", "NotebookEdit"}:
        target = str(ti.get("file_path") or ti.get("notebook_path") or "")
        if STORE in target:
            return (
                "deny",
                f"{STORE}/ is written only by `{APPROVAL_TOOL}.py approve` at the owner's terminal.",
            )
        return None
    if tool != "Bash":
        return None
    cmd = str(ti.get("command") or "")
    if STORE in cmd:
        return (
            "deny",
            f"{STORE}/ is written only by `{APPROVAL_TOOL}.py approve` at the owner's terminal.",
        )
    if APPROVAL_TOOL in cmd and PTY_WRAPPER.search(cmd):
        return (
            "deny",
            "Wrapping the approval tool in a pseudo-terminal fakes the owner's approval. "
            "The owner runs `approve` in their own terminal.",
        )
    if GIT_COMMIT.search(cmd):
        if _commit_skips_hooks(cmd):
            return (
                "deny",
                "`git commit --no-verify` skips gitleaks, shellcheck and actionlint too. For a guarded "
                "path the owner runs `python3 tools/guarded_commit_approval.py approve` in a real "
                "terminal, then commit normally.",
            )
        try:
            paths = guarded()
        except Exception:  # the git hook is the gate; never block on our own failure
            paths = []
        if paths:
            return (
                "ask",
                "This commit includes guarded path(s): "
                + ", ".join(paths)
                + ". Approving this prompt "
                "does NOT approve them: the pre-commit hook still requires the owner's terminal "
                "approval for this exact staged tree.",
            )
    return None


def main() -> int:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    raw = raw or os.environ.get("CLAUDE_TOOL_INPUT", "")
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return 0
    decision = decide(payload)
    if decision:
        kind, reason = decision
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": kind,
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
