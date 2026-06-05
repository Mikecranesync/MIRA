#!/usr/bin/env python3
"""CI guard — no NEW unguarded `INSERT INTO kg_relationships`.

The doctrine (`.claude/CLAUDE.md` § "Knowledge graph proposals", ADR-0017,
`.claude/skills/managing-the-knowledge-graph`): MIRA proposes, a human
verifies. A MIRA-inferred edge must NOT be written straight to
`kg_relationships` — it goes through the propose path
(`mira-crawler/ingest/proposal_writer.py` /
`mira-hub/.../proposals-writer.ts::upsertInferredProposal`). The only
verified write is the human-approval decide route.

This guard scans the tree for direct `kg_relationships` inserts and fails if
any appear in a file NOT on the allowlist
(`scripts/kg_write_guard_allowlist.txt`). The allowlist is the baseline of
known/legitimate sites: the decide route, the flag-gated ingest branches,
the not-yet-migrated hub writers (#1721), seeds, and tests. A NEW writer must
either propose, or be added to the allowlist with a justification reviewers
can see in the diff.

Match is case-insensitive and whitespace-normalized, so reformatting an
existing line doesn't trip it. Pure stdlib; runnable locally:

    python3 scripts/kg_write_guard.py            # scan, exit 1 on violations
    python3 scripts/kg_write_guard.py --list     # print every insert site + status
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# `insert into kg_relationships`, tolerant of run-together whitespace/newlines
# and case. The table name + INSERT INTO sit on one line in every real site.
_INSERT_RE = re.compile(r"insert\s+into\s+kg_relationships\b", re.IGNORECASE)

_SCAN_SUFFIXES = {".py", ".ts", ".tsx", ".sql"}
_SKIP_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", ".venv", "venv",
    "__pycache__", ".turbo", "coverage", ".pytest_cache",
}

REPO_ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "kg_write_guard_allowlist.txt"


def load_allowlist(path: Path = ALLOWLIST_PATH) -> set[str]:
    """Repo-relative paths permitted to contain a direct kg_relationships
    insert. Blank lines and `#` comments are ignored."""
    allow: set[str] = set()
    if not path.exists():
        return allow
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            allow.add(line)
    return allow


def _scan_file(p: Path) -> bool:
    try:
        text = p.read_text(errors="ignore")
    except OSError:
        return False
    return bool(_INSERT_RE.search(text))


def find_insert_sites(root: Path = REPO_ROOT) -> list[str]:
    """All repo-relative paths (sorted) containing a direct kg_relationships
    insert."""
    hits: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix not in _SCAN_SUFFIXES:
                continue
            if _scan_file(p):
                hits.append(p.relative_to(root).as_posix())
    return sorted(hits)


def find_violations(root: Path = REPO_ROOT, allowlist: set[str] | None = None) -> list[str]:
    """Insert sites that are NOT on the allowlist."""
    allow = load_allowlist() if allowlist is None else allowlist
    return [s for s in find_insert_sites(root) if s not in allow]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="print every insert site + allow/VIOLATION status")
    args = ap.parse_args(argv)

    allow = load_allowlist()
    sites = find_insert_sites()
    violations = [s for s in sites if s not in allow]

    if args.list:
        for s in sites:
            print(f"  {'allow' if s in allow else 'VIOLATION'}  {s}")

    if violations:
        print(
            "\n❌ kg-write-guard: new unguarded `INSERT INTO kg_relationships` "
            f"in {len(violations)} file(s):",
            file=sys.stderr,
        )
        for v in violations:
            print(f"   - {v}", file=sys.stderr)
        print(
            "\nMIRA-inferred edges must PROPOSE (proposal_writer.py / "
            "upsertInferredProposal), not write kg_relationships directly "
            "(ADR-0017). If this write is the human-approval path or a "
            "flag-gated/seed/test site, add it to "
            "scripts/kg_write_guard_allowlist.txt with a one-line reason.",
            file=sys.stderr,
        )
        return 1

    print(f"✅ kg-write-guard: {len(sites)} insert site(s), all allowlisted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
