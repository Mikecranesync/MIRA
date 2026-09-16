#!/usr/bin/env python3
# tools/hooks/shared_root_file_guard.py
# Deterministic floor against one run silently overwriting another run's
# repo-root plan/handoff file.
#
# Why this exists (2026-09-15, near-miss caught twice in one overnight run):
#   `PLAN.md` and `HANDOFF.md` at the repo root are TRACKED, COMMITTED files, not
#   per-session scratch. They belong to whichever run wrote them last. The
#   `autonomous-run` skill's pre-flight says "PLAN.md exists at branch root" and
#   its closeout says "write HANDOFF.md" -- read literally, that instructs every
#   overnight run to overwrite the previous run's plan and handoff, and merging
#   the branch would DELETE them from `main`. It is the same shared-line problem
#   the repo killed `/VERSION` over (#3064).
#
#   During PR #3815 that happened twice. Nothing was lost, but only because the
#   Write tool said "updated" rather than "created" and the agent looked.
#   "Look at the tool output" is not a control. This is.
#
# What it does: on PreToolUse(Write|Edit), DENY a write to a repo-ROOT file whose
# basename is a known shared plan/handoff name, when that file is tracked and the
# current branch has never touched it. The fix is to use a branch-scoped name
# (`PLAN.<slice>.md`), which the denial message says outright.
#
# What it deliberately does NOT do:
#   - touch files in subdirectories (`docs/plans/PLAN.md` is not a shared line)
#   - touch untracked files (nothing to overwrite yet)
#   - block a branch that already owns the file (you are continuing your own work)
#   - guess when git cannot answer (no repo, no `origin/main`) -- it allows
#
# Override: MIRA_ALLOW_SHARED_ROOT=1 (per-shell, human).
#
# Doctrine this is the floor of: .claude/rules/shared-root-file-ownership.md

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

#: Basenames that are a shared line at the repo root. Each is a file that
#: multiple concurrent runs are independently instructed to write.
SHARED_ROOT_FILENAMES = frozenset(
    {
        "PLAN.md",
        "HANDOFF.md",
        "STATE.md",
        "NOTES.md",
        "TODO.md",
        "RESUME.md",
        "SESSION.md",
    }
)


def _git(repo: Path, *args: str) -> Optional[str]:
    """Run a read-only git command, or return None if git cannot answer."""
    try:
        done = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return (done.stdout or "").strip()


def repo_root(start: Path) -> Optional[Path]:
    top = _git(start, "rev-parse", "--show-toplevel")
    return Path(top) if top else None


def is_tracked(repo: Path, relative: str) -> bool:
    return bool(_git(repo, "ls-files", "--error-unmatch", "--", relative))


def branch_owns(repo: Path, relative: str, base: str = "origin/main") -> bool:
    """True when a commit on THIS branch (not on the base) touched the file.

    That is the ownership test. A run that has already committed its own
    `PLAN.md` on its own branch is continuing its own work and must not be
    blocked; a branch that has never touched the file is about to overwrite
    somebody else's.
    """
    if _git(repo, "rev-parse", "--verify", "--quiet", base) is None:
        return True  # no base to compare against -- fail open, never block blindly
    return bool(_git(repo, "log", f"{base}..HEAD", "--format=%H", "-1", "--", relative))


def verdict(file_path: str, env: Optional[dict] = None) -> Optional[str]:
    """Return a denial message, or None to allow.

    Every decision is derived from the path plus the git state of the repository
    that contains it, so the whole thing is testable against a scratch repo.
    """
    environ = os.environ if env is None else env
    if environ.get("MIRA_ALLOW_SHARED_ROOT") == "1":
        return None
    if not file_path:
        return None

    target = Path(file_path)
    if target.name not in SHARED_ROOT_FILENAMES:
        return None

    # Resolve through symlinks so a link into the repo root is still the repo root.
    try:
        resolved = target.resolve()
    except OSError:
        resolved = target
    parent = resolved.parent
    root = repo_root(parent if parent.exists() else Path.cwd())
    if root is None:
        return None  # not in a git repo -- not a shared line

    try:
        root_resolved = root.resolve()
    except OSError:
        root_resolved = root
    if parent != root_resolved:
        return None  # a copy in a subdirectory is nobody's shared line

    relative = resolved.name
    if not is_tracked(root, relative):
        return None  # nothing committed to overwrite
    if branch_owns(root, relative):
        return None  # this branch already owns it

    owner = _git(root, "log", "-1", "--format=%h %an %ad", "--date=short", "--", relative)
    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    slug = branch.rsplit("/", 1)[-1] if branch and branch != "HEAD" else "slice"
    stem = Path(relative).stem
    return (
        f"BLOCKED: {relative} at the repo root is a TRACKED, SHARED file and this "
        f"branch has never touched it. Last written by: {owner or 'an earlier commit'}. "
        f"Overwriting it would replace another run's work, and merging this branch "
        f"would delete theirs from main.\n"
        f"Write {stem}.{slug}.md instead (branch-scoped), or set "
        f"MIRA_ALLOW_SHARED_ROOT=1 for this shell if you genuinely own this file.\n"
        f"See .claude/rules/shared-root-file-ownership.md"
    )


def main() -> int:
    raw = "" if sys.stdin.isatty() else sys.stdin.read()
    file_path = ""
    if raw:
        try:
            payload = json.loads(raw)
            file_path = (payload.get("tool_input") or {}).get("file_path") or ""
        except (ValueError, AttributeError):
            file_path = ""
    message = verdict(file_path)
    if message:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": message,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
