#!/usr/bin/env python3
"""PreToolUse hook (matcher: Bash): block gh comment/issue/PR writes that @-mention a non-collaborator.

Why: on 2026-10-27 a BRAVO comment on the PUBLIC repo Mikecranesync/MIRA (#4570)
opened with "@Grok", which notified the unrelated GitHub user `grok`. Agent names
(Grok, Codex, Cursor, Claude, BRAVO, CHARLIE) are not our logins. Rule:
MIRA .claude/rules/claims-and-outward-actions.md rule 5.

Fires on: gh pr|issue comment|create|edit|review, and gh api calls touching
comments/issues/pulls. Scans the whole command text (covers inline --body and
same-command heredocs) plus every referenced body file (--body-file X, -F X,
body=@X), expanding $VARS assigned in the same command.

Exit 0 = allow. Exit 2 = block (reason on stderr, shown to Claude).
Fails OPEN on malformed stdin / non-gh commands; fails CLOSED when the
collaborator lookup itself errors. Bypass (human-approved only): prefix the
command with GH_MENTION_ALLOW=1.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

TRIGGER = re.compile(
    r"\bgh\s+(?:pr|issue)\s+(?:comment|create|edit|review)\b"
    r"|\bgh\s+api\b[^\n]*\b(?:comments|issues|pulls)\b"
)
FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]*`")
# Not preceded by a word char, / . ` @ = $ : (emails, paths, body=@file, $@, URLs);
# not followed by a path segment (scoped npm packages like @anthropic-ai/sdk).
MENTION = re.compile(r"(?<![\w/.`@=$:])@([A-Za-z0-9](?:-?[A-Za-z0-9]){0,38})(?![\w-]*/)")
ASSIGN = re.compile(r"(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=([^\s;&|)]+)")
FILE_ARGS = re.compile(
    r"(?:--body-file|--notes-file|(?<![\w-])-F)[\s=]+(?!body=)['\"]?([^\s'\";&|]+)"
    r"|\bbody=@['\"]?([^\s'\";&|]+)"
)
REPO_FLAG = re.compile(r"(?:-R|--repo)[\s=]+['\"]?([\w.-]+/[\w.-]+)")
REPO_API = re.compile(r"\brepos/([\w.-]+/[\w.-]+?)/")
DEFAULT_REPO = "Mikecranesync/MIRA"
CACHE = os.path.expanduser("~/.cache/gh-mention-guard.json")
TTL = 24 * 3600


def mentions(text: str) -> set[str]:
    return {m.group(1) for m in MENTION.finditer(INLINE.sub("", FENCE.sub("", text)))}


def expand(path: str, env: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        name = m.group(1) or m.group(2) or ""
        return env.get(name) or os.environ.get(name) or m.group(0) or ""

    return os.path.expanduser(re.sub(r"\$\{(\w+)\}|\$(\w+)", sub, path))


def resolve_repo(cmd: str, cwd: str) -> str:
    m = REPO_FLAG.search(cmd) or REPO_API.search(cmd)
    if m:
        return m.group(1)
    try:
        r = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            capture_output=True,
            text=True,
            cwd=cwd or None,
            timeout=15,
        )
        if r.returncode == 0 and "/" in r.stdout:
            return r.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return DEFAULT_REPO


def load_cache() -> dict:
    try:
        with open(CACHE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def is_collaborator(repo: str, login: str, cache: dict) -> bool:
    key = f"{repo.lower()}:{login.lower()}"
    if time.time() - cache.get(key, 0) < TTL:
        return True
    r = subprocess.run(
        ["gh", "api", "-i", f"repos/{repo}/collaborators/{login}"],
        capture_output=True,
        text=True,
        timeout=15,
    )
    status = r.stdout.splitlines()[0] if r.stdout else ""
    if " 204" in status:
        cache[key] = time.time()
        return True
    if " 404" in status:
        return False
    raise RuntimeError(status or r.stderr.strip() or "no response")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not TRIGGER.search(cmd):
        return 0
    if re.search(r"(?:^|\s)GH_MENTION_ALLOW=1\b", cmd):
        print("gh-mention-guard: bypassed by GH_MENTION_ALLOW=1", file=sys.stderr)
        return 0
    cwd = payload.get("cwd") or os.getcwd()
    env = dict(ASSIGN.findall(cmd))
    found = mentions(cmd)
    for m in FILE_ARGS.finditer(cmd):
        raw = m.group(1) or m.group(2)
        path = expand(raw, env)
        if not os.path.isabs(path):
            path = os.path.join(cwd, path)
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                found |= mentions(fh.read())
        except OSError:
            pass  # created later in this same command -> its heredoc is in cmd, already scanned
    if not found:
        return 0
    repo = resolve_repo(cmd, cwd)
    cache = load_cache()
    try:
        bad = sorted((x for x in found if not is_collaborator(repo, x, cache)), key=str.lower)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
        print(
            f"gh-mention-guard: BLOCKED (fail closed) - collaborator lookup failed on {repo}: {e}",
            file=sys.stderr,
        )
        return 2
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
    except OSError:
        pass
    if bad:
        print(
            f"gh-mention-guard: BLOCKED - {', '.join('@' + b for b in bad)} is not a collaborator of {repo}; "
            "posting would notify a stranger (public repo). Write agent names without '@' "
            "(e.g. 'Grok (writer lock)'). Human-approved bypass: prefix GH_MENTION_ALLOW=1.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
