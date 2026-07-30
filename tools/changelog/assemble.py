#!/usr/bin/env python3
"""Assemble `changelog.d/` fragments into /VERSION + docs/CHANGELOG.md.

WHY
---
`/VERSION` is one monotonic line and `docs/CHANGELOG.md` is prepended to at the
top, so every PR edits the same line of the same file. Each merge to main then
conflicts every other open PR — and a conflicting PR gets NO CI, so it silently
stops being verified. Fragments are one-file-per-change, so PRs never collide.

See `changelog.d/README.md` for the authoring format and the rollout status
(both paths are currently accepted; assembly is operator-triggered on purpose).

USAGE
    py -3 tools/changelog/assemble.py --dry-run     # print, write nothing
    py -3 tools/changelog/assemble.py --apply       # write + delete fragments

Deliberately dependency-free (no PyYAML): the front matter is a handful of
`key: value` lines and this must run in any checkout without installing anything.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from pathlib import Path

# type -> semver component. Ordered by precedence; the highest impact across all
# pending fragments wins.
BUMP_BY_TYPE: dict[str, str] = {
    "breaking": "major",
    "feat": "minor",
    "fix": "patch",
    "security": "patch",
    "docs": "none",
    "chore": "none",
    "refactor": "none",
    "test": "none",
}
_BUMP_RANK = {"none": 0, "patch": 1, "minor": 2, "major": 3}

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.S)
SEMVER_RE = re.compile(r"\A(\d+)\.(\d+)\.(\d+)\Z")


class FragmentError(Exception):
    """A fragment is malformed. Fail loudly — a silently-skipped fragment is a
    lost changelog entry and a wrong version bump."""


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_fragment(path: Path) -> tuple[str, str, str]:
    """Return (type, title, body). `title` is optional and may be "".

    Raises FragmentError on anything unexpected — a silently-skipped fragment
    is both a lost release note and a wrong version bump."""
    text = path.read_text(encoding="utf-8")
    m = FRONT_MATTER_RE.match(text)
    if not m:
        raise FragmentError(
            f"{path.name}: missing `---` front matter. Expected:\n"
            "---\ntype: fix\n---\n\n<description>"
        )
    meta_block, body = m.group(1), m.group(2).strip()

    meta: dict[str, str] = {}
    for line in meta_block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise FragmentError(f"{path.name}: front-matter line is not `key: value`: {line!r}")
        k, v = line.split(":", 1)
        meta[k.strip().lower()] = v.strip().strip("\"'")

    ftype = meta.get("type", "")
    if not ftype:
        raise FragmentError(f"{path.name}: front matter has no `type:`")
    if ftype not in BUMP_BY_TYPE:
        raise FragmentError(
            f"{path.name}: unknown type {ftype!r}. Valid: {', '.join(sorted(BUMP_BY_TYPE))}"
        )
    if not body:
        raise FragmentError(f"{path.name}: body is empty — write the release note")
    return ftype, meta.get("title", ""), body


def find_fragments(frag_dir: Path) -> list[Path]:
    if not frag_dir.is_dir():
        return []
    return sorted(p for p in frag_dir.glob("*.md") if p.name.lower() != "readme.md")


def highest_bump(types: list[str]) -> str:
    best = "none"
    for t in types:
        cand = BUMP_BY_TYPE[t]
        if _BUMP_RANK[cand] > _BUMP_RANK[best]:
            best = cand
    return best


def bump_version(current: str, bump: str) -> str:
    m = SEMVER_RE.match(current.strip())
    if not m:
        raise FragmentError(f"/VERSION is not semver: {current!r}")
    major, minor, patch = (int(g) for g in m.groups())
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    return current.strip()


def render_entry(version: str, frags: list[tuple[str, str, str, str]], today: str) -> str:
    """frags: (name, type, title, body), already sorted by impact then name.

    Heading matches the existing house style in docs/CHANGELOG.md:
    `### v<semver> (<date>) - <type>(<scope>): <subject>`. The highest-impact
    fragment supplies the headline; the rest are listed beneath it.
    """
    _, head_type, head_title, _ = frags[0]
    if not head_title:
        subject = f"{head_type}: {len(frags)} change(s)"
    elif head_title.split("(")[0].split(":")[0].strip().lower() in BUMP_BY_TYPE:
        # Author already wrote a conventional-commit subject ("fix(ci): ...").
        # Prefixing the type again would render "fix: fix(ci): ...".
        subject = head_title
    else:
        subject = f"{head_type}: {head_title}"
    if len(frags) > 1:
        subject = f"{subject} (+{len(frags) - 1} more)"
    lines = [f"### v{version} ({today}) - {subject}", ""]
    # A single fragment's title is already the heading — don't repeat it.
    for name, ftype, title, body in frags:
        if len(frags) > 1:
            label = f"**{ftype}**" + (f" — {title}" if title else "")
            lines.append(f"{label}  \n_({name})_\n")
        lines.append(body)
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="print the result, write nothing")
    mode.add_argument(
        "--apply", action="store_true", help="write VERSION + CHANGELOG, delete fragments"
    )
    ap.add_argument(
        "--date", default=None, help="override the entry date (YYYY-MM-DD); default: today UTC"
    )
    args = ap.parse_args(argv)

    root = repo_root()
    frag_dir = root / "changelog.d"
    version_file = root / "VERSION"
    changelog = root / "docs" / "CHANGELOG.md"

    paths = find_fragments(frag_dir)
    if not paths:
        print("No fragments in changelog.d/ — nothing to assemble.")
        return 0

    try:
        parsed = [(p.name, *parse_fragment(p)) for p in paths]  # (name, type, title, body)
    except FragmentError as e:
        print(f"::error::{e}", file=sys.stderr)
        return 1

    parsed.sort(key=lambda t: (-_BUMP_RANK[BUMP_BY_TYPE[t[1]]], t[0]))
    bump = highest_bump([t[1] for t in parsed])
    current = version_file.read_text(encoding="utf-8").strip()

    if bump == "none":
        print(f"{len(parsed)} fragment(s), all release-neutral — no version bump.")
        new_version = current
    else:
        new_version = bump_version(current, bump)

    today = args.date or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    entry = render_entry(new_version, parsed, today)

    print(f"fragments : {len(parsed)}")
    for name, ftype, title, _ in parsed:
        print(f"  {ftype:9s} {name}  {title}")
    print(f"bump      : {bump}")
    print(f"version   : {current} -> {new_version}")
    print("-" * 70)
    print(entry)
    print("-" * 70)

    if args.dry_run:
        print("--dry-run: nothing written.")
        return 0

    # Preserve the file's existing shape: /VERSION carries no trailing newline.
    if new_version != current:
        version_file.write_text(new_version, encoding="utf-8", newline="")
    existing = changelog.read_text(encoding="utf-8")
    changelog.write_text(entry.rstrip("\n") + "\n\n" + existing, encoding="utf-8", newline="\n")
    for p in paths:
        p.unlink()

    print(
        f"Wrote VERSION={new_version}, prepended docs/CHANGELOG.md, removed {len(paths)} fragment(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
