#!/usr/bin/env python3
# tools/hooks/rm_guard.py
# Deterministic safety FLOOR for destructive `rm -rf` — the hard backstop that
# complements (does NOT replace) the judgment-based doctrine in
# `.claude/rules/dangerous-commands-safety.md`.
#
# Why a hook AND doctrine (2026-07-14 insights report):
#   The doctrine ("print the resolved absolute path before rm -rf") covers the
#   *judgment* cases a hook cannot verify. But an insights report captured a real
#   incident — a mistyped path in an `rm -rf` deleted the wrong `.git` admin
#   directory. `permissions.deny: "Bash(rm -rf /*)"` only catches deletes from
#   `/`; a static glob can't catch `rm -rf "$REPO"`, a relative `..`, a symlink,
#   or a quoted path. This module RESOLVES variables + normalizes + follows
#   symlinks, so those all collapse to the same absolute path and get caught.
#
# Scope: catastrophic literals + `.git` only (deliberately narrow — near-zero
# false positives so legitimate `rm -rf .audit-worktrees/x` / `graphify-out/` /
# `node_modules` / `/tmp/...` cleanup keeps working). Denies a recursive+force
# `rm` whose target resolves to:
#   - the root filesystem `/` (or a root glob `/*`)
#   - the caller's home directory (or an ancestor of it)
#   - the git repository root (or an ancestor of it)
#   - any `.git` admin directory
#
# It NEVER executes the command or any `$(...)`/backtick substitution — it is a
# pure string+path analysis (only read-only `realpath`/`git rev-parse`).
#
# Override: MIRA_ALLOW_RM=1 (handled in rm-guard.sh, matching the MIRA_ALLOW_*
# convention of prod-guard.sh / git-state-guard.sh).
#
# The logic lives here (importable, unit-tested by tests/test_rm_guard.py);
# rm-guard.sh is the thin PreToolUse wrapper that extracts the command and emits
# the permission JSON.

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from typing import Optional

# Shell separators that end one simple command and begin the next.
_SEP_TOKENS = {";", "&&", "||", "|", "&"}

# $VAR / ${VAR}
_VAR_RE = re.compile(r"\$\{(\w+)\}|\$(\w+)")
# command substitution — presence means we cannot resolve the operand safely.
_CMDSUB_RE = re.compile(r"\$\(|`")


def _tokenize(command: str) -> Optional[list]:
    """shlex-tokenize a command, keeping ;/&&/||/|/& as their own tokens.

    Returns None if the command can't be parsed (unbalanced quotes, etc.) — the
    caller then fails OPEN (allow), because a safety *floor* must not wedge the
    session; the doctrine + permission-deny still apply.
    """
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=";&|<>")
        lex.whitespace_split = True
        return list(lex)
    except ValueError:
        return None


def _rm_invocations(tokens: list):
    """Yield (operand_tokens, inline_env) for each `rm` simple-command.

    inline_env = leading `VAR=val` assignments on that same simple command, so
    `REPO=/x rm -rf $REPO` resolves `$REPO` deterministically without executing.
    """
    segments: list = []
    cur: list = []
    for t in tokens:
        if t in _SEP_TOKENS:
            segments.append(cur)
            cur = []
        else:
            cur.append(t)
    segments.append(cur)

    for seg in segments:
        assigns: dict = {}
        i = 0
        while i < len(seg) and re.match(r"^\w+=", seg[i]):
            k, _, v = seg[i].partition("=")
            assigns[k] = v
            i += 1
        if i < len(seg) and os.path.basename(seg[i]) == "rm":
            yield seg[i + 1 :], assigns


def _flags_and_operands(tokens: list):
    """Split rm arguments into (recursive, force, operands), honoring `--`."""
    recursive = force = False
    operands: list = []
    end_flags = False
    for t in tokens:
        if not end_flags and t == "--":
            end_flags = True
            continue
        if not end_flags and t.startswith("-") and len(t) > 1:
            if t.startswith("--"):
                if t == "--recursive":
                    recursive = True
                elif t == "--force":
                    force = True
            else:
                body = t[1:]
                if "r" in body.lower():
                    recursive = True
                if "f" in body:
                    force = True
            continue
        operands.append(t)
    return recursive, force, operands


def _expand(operand: str, env: dict, home: str) -> Optional[str]:
    """Expand ~ and $VAR / ${VAR} using env (unset -> empty, like bash).

    Returns None if the operand contains command substitution — we never resolve
    (let alone execute) those; the doctrine covers that judgment case.
    """
    if _CMDSUB_RE.search(operand):
        return None
    if operand == "~":
        operand = home or operand
    elif operand.startswith("~/"):
        operand = (home or "~") + operand[1:]

    def repl(m: "re.Match") -> str:
        name = m.group(1) or m.group(2)
        return env.get(name, "")

    return _VAR_RE.sub(repl, operand)


def _resolve(path: str, cwd: str) -> str:
    """Absolute, normalized, symlink-resolved path (read-only; never executes)."""
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    return os.path.realpath(path)


def _is_ancestor_or_equal(a: str, b: str) -> bool:
    """True if `a` is `b` or an ancestor directory of `b`."""
    a = a.rstrip("/") or "/"
    b = b.rstrip("/") or "/"
    return a == b or b.startswith(a + "/")


def _danger(p: str, home: str, repo_root: str) -> Optional[str]:
    if p == "/" or p == "//":
        return "the root filesystem '/'"
    if home:
        home_r = os.path.realpath(home)
        if _is_ancestor_or_equal(p, home_r):
            return "your home directory ({})".format(home_r)
    if repo_root:
        repo_r = os.path.realpath(repo_root)
        if _is_ancestor_or_equal(p, repo_r):
            return "the repository root ({})".format(repo_r)
    if os.path.basename(p.rstrip("/")) == ".git":
        return "a .git admin directory ({})".format(p)
    return None


def evaluate(
    command: str,
    *,
    cwd: str,
    env: Optional[dict] = None,
    home: Optional[str] = None,
    repo_root: Optional[str] = None,
) -> Optional[str]:
    """Return a human-readable deny reason if `command` contains a catastrophic
    recursive+force `rm`, else None. Pure analysis — never executes anything.
    """
    if not command or "rm" not in command:
        return None
    env = dict(env) if env is not None else dict(os.environ)
    home = home if home is not None else env.get("HOME", "")
    repo_root = repo_root or ""

    tokens = _tokenize(command)
    if tokens is None:
        return None  # unparseable -> fail open (doctrine + deny-glob still apply)

    for operand_tokens, inline_env in _rm_invocations(tokens):
        recursive, force, operands = _flags_and_operands(operand_tokens)
        if not (recursive and force):
            continue
        merged_env = dict(env)
        merged_env.update(inline_env)
        for op in operands:
            expanded = _expand(op, merged_env, home)
            if expanded is None:
                continue  # command substitution — unresolvable, doctrine covers it
            # Check the operand itself, plus the directory it globs (`/*`, `~/*`).
            candidates = [expanded]
            if expanded.endswith("*"):
                candidates.append(os.path.dirname(expanded) or ".")
            for cand in candidates:
                resolved = _resolve(cand, cwd)
                reason = _danger(resolved, home, repo_root)
                if reason:
                    return "'{}' resolves to {}".format(op, reason)
    return None


def _git_toplevel(cwd: str) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        pass
    return ""


def main() -> int:
    command = sys.stdin.read()
    if not command.strip():
        return 0
    cwd = os.getcwd()
    reason = evaluate(
        command,
        cwd=cwd,
        env=dict(os.environ),
        home=os.environ.get("HOME", ""),
        repo_root=_git_toplevel(cwd),
    )
    if reason:
        msg = (
            "Blocked by tools/hooks/rm-guard.sh: this recursive+force `rm` targets "
            + reason
            + ". Print and confirm the exact resolved absolute path first "
            + "(see .claude/rules/dangerous-commands-safety.md), target a specific "
            + "subdirectory, or set MIRA_ALLOW_RM=1 per-shell if this is truly intended."
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": msg,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
