#!/usr/bin/env python3
"""Derive the next release version from git TAGS, not from a committed file.

WHY THIS EXISTS
---------------
`/VERSION` is a single monotonic line in a tracked file, and `docs/CHANGELOG.md`
is prepended to at the top. Every PR therefore edits the SAME line of the SAME
file, so each merge to `main` conflicts every other open PR — and a conflicting
PR receives NO CI at all, because GitHub cannot build the merge ref. It silently
stops being verified while still looking open and healthy. Observed four times in
one session on 2026-07-29.

GitHub's own documentation is the way out. Per
https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
releases are built on **git tags**; the docs contain no guidance about storing a
version in a repository file. And this repo's `main-branch-protection` ruleset
targets `branch` only — **tags are unprotected**, so a workflow can create them
without pushing to `main` and without any branch-protection accommodation.

So: the tag IS the save point, and the version is DERIVED from the tags. There is
no shared line left to conflict on.

The bump level comes from the merge commit subject, which this repo already
mandates as a Conventional Commit (`CLAUDE.md`: feat/fix/security/docs/refactor/
test/chore/BREAKING). No new authoring discipline is introduced.

TRANSITION SAFETY
-----------------
While `/VERSION` still exists, it acts as a FLOOR: the derived version can never
go backwards relative to it. That keeps the two worlds consistent during the
changeover, and once `/VERSION` is retired the floor simply stops mattering.

USAGE
    py -3 tools/release/next_version.py --latest-tag v3.231.0 --subject "feat: x"
    py -3 tools/release/next_version.py            # reads git + /VERSION itself
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

SEMVER_RE = re.compile(r"\Av?(\d+)\.(\d+)\.(\d+)\Z")

# Conventional-commit type -> semver component. Mirrors the types CLAUDE.md
# mandates. Anything unrecognised is treated as a patch: a merge that reached
# main is a change worth a save point, and silently NOT tagging it would lose the
# restore point this whole mechanism exists to provide.
BUMP_BY_TYPE: dict[str, str] = {
    "breaking": "major",
    "feat": "minor",
    "fix": "patch",
    "security": "patch",
    "perf": "patch",
    "refactor": "patch",
    "test": "patch",
    "docs": "patch",
    "chore": "patch",
}
DEFAULT_BUMP = "patch"


class VersionError(Exception):
    """Fail loudly. A wrong version silently overwrites nothing, but a MISSING
    tag loses a restore point, so every failure here must be visible."""


def parse_semver(text: str) -> tuple[int, int, int]:
    m = SEMVER_RE.match(text.strip())
    if not m:
        raise VersionError(f"not a semver: {text!r}")
    return tuple(int(g) for g in m.groups())  # type: ignore[return-value]


def bump_from_subject(subject: str) -> str:
    """Read the bump level out of a Conventional Commit subject.

    `feat!:` / `fix(x)!:` and a `BREAKING CHANGE` body marker are MAJOR — the `!`
    convention is the part most easily missed, and getting it wrong understates a
    breaking release.
    """
    s = subject.strip()
    if "BREAKING CHANGE" in s or "BREAKING-CHANGE" in s:
        return "major"
    m = re.match(r"\A([a-zA-Z]+)(\([^)]*\))?(!)?:", s)
    if not m:
        return DEFAULT_BUMP
    ctype = m.group(1).lower()
    if m.group(3) == "!":  # feat!: / fix(scope)!:
        return "major"
    if ctype == "breaking":
        return "major"
    return BUMP_BY_TYPE.get(ctype, DEFAULT_BUMP)


def apply_bump(current: tuple[int, int, int], bump: str) -> tuple[int, int, int]:
    major, minor, patch = current
    if bump == "major":
        return (major + 1, 0, 0)
    if bump == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def _git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise VersionError(f"git {' '.join(args)} failed: {e}") from e


def latest_tag_from_git() -> str | None:
    out = _git("tag", "--list", "v*", "--sort=-v:refname")
    for line in out.splitlines():
        if SEMVER_RE.match(line.strip()):
            return line.strip()
    return None


def version_floor(repo_root: Path) -> tuple[int, int, int] | None:
    """/VERSION as a transition floor. Absent or unparseable => no floor."""
    f = repo_root / "VERSION"
    if not f.is_file():
        return None
    try:
        return parse_semver(f.read_text(encoding="utf-8"))
    except VersionError:
        return None


def next_version(
    latest_tag: str | None,
    subject: str,
    floor: tuple[int, int, int] | None = None,
) -> str:
    """The next version: bump the latest tag, then respect the floor.

    With no tags at all this starts from the floor (or 0.0.0), so a fresh repo
    still produces a usable first tag instead of erroring.
    """
    base = parse_semver(latest_tag) if latest_tag else (floor or (0, 0, 0))
    candidate = apply_bump(base, bump_from_subject(subject))
    if floor is not None and floor > candidate:
        # /VERSION is ahead of the tags (a hand-bumped PR that has not been
        # tagged yet). Never move backwards — take the floor and patch past it.
        candidate = apply_bump(floor, "patch") if floor == base else floor
    return ".".join(str(n) for n in candidate)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Derive the next release version from git tags.")
    ap.add_argument("--latest-tag", default=None, help="override the latest v* tag")
    ap.add_argument("--subject", default=None, help="commit subject (default: HEAD's)")
    ap.add_argument("--no-floor", action="store_true", help="ignore /VERSION as a floor")
    args = ap.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    try:
        tag = args.latest_tag if args.latest_tag is not None else latest_tag_from_git()
        subject = args.subject if args.subject is not None else _git("log", "-1", "--pretty=%s")
        floor = None if args.no_floor else version_floor(root)
        print(next_version(tag, subject, floor))
    except VersionError as e:
        print(f"::error::{e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
