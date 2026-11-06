#!/usr/bin/env python3
"""Refuse a GitHub comment/PR/issue body that @-mentions a non-collaborator.

This repo is PUBLIC. Agent names (Grok, Codex, Cursor, BRAVO, CHARLIE, ...)
are not GitHub logins, so `@Grok` notifies an unrelated stranger (`grok`).
Run before every `gh pr comment` / `gh issue comment` / `gh issue create`:

    python3 scripts/check_gh_mentions.py BODY_FILE [--repo OWNER/REPO]

Exit 0: no mentions, or every mention is a repo collaborator.
Exit 1: at least one mention is not a collaborator (listed on stderr).
Exit 2: usage error or the collaborator lookup itself failed (fail closed).

Mentions inside fenced code blocks and inline `code` spans are ignored,
since GitHub does not notify for those. See
.claude/rules/claims-and-outward-actions.md (rule 5).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]*`")
# GitHub login: alnum or single hyphens, <=39 chars, not preceded by a word
# char, '/', '.' or '`' (excludes emails, paths like @/lib, and scoped pkgs).
MENTION = re.compile(r"(?<![\w/.`@])@([A-Za-z0-9](?:-?[A-Za-z0-9]){0,38})(?![\w-]*/)")


def mentions(body: str) -> list[str]:
    stripped = INLINE.sub("", FENCE.sub("", body))
    return sorted({m.group(1) for m in MENTION.finditer(stripped)}, key=str.lower)


def is_collaborator(repo: str, login: str) -> bool:
    r = subprocess.run(
        ["gh", "api", "-i", f"repos/{repo}/collaborators/{login}"],
        capture_output=True,
        text=True,
    )
    status = r.stdout.splitlines()[0] if r.stdout else ""
    if " 204" in status:
        return True
    if " 404" in status:
        return False
    raise RuntimeError(f"collaborator lookup failed for {login!r}: {status or r.stderr.strip()}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("body_file")
    ap.add_argument("--repo", default="Mikecranesync/MIRA")
    a = ap.parse_args()
    try:
        body = open(a.body_file, encoding="utf-8").read()
    except OSError as e:
        print(f"check_gh_mentions: {e}", file=sys.stderr)
        return 2
    found = mentions(body)
    try:
        bad = [m for m in found if not is_collaborator(a.repo, m)]
    except RuntimeError as e:
        print(f"check_gh_mentions: {e} (fail closed)", file=sys.stderr)
        return 2
    if bad:
        print(
            "check_gh_mentions: NOT collaborators of "
            f"{a.repo} (would notify a stranger): " + ", ".join("@" + m for m in bad),
            file=sys.stderr,
        )
        print("Write the agent name without '@' (e.g. 'Grok (writer lock)').", file=sys.stderr)
        return 1
    print(f"check_gh_mentions: OK ({len(found)} mention(s), all collaborators)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
