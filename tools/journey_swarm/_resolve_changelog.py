"""Resolve a top-of-file docs/CHANGELOG.md rebase conflict, newest entry first.

Both sides append a new release section at the top, so git always conflicts on
line 1. This keeps BOTH sections and orders them newest-first, optionally
renumbering the incoming (branch) heading to a new version.

Usage:  py -3 tools/journey_swarm/_resolve_changelog.py [NEW_VERSION]

Not part of the product — a merge helper for the swarm PR chain.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CHANGELOG = Path("docs/CHANGELOG.md")


def main() -> int:
    new_version = sys.argv[1] if len(sys.argv) > 1 else ""
    text = CHANGELOG.read_text(encoding="utf-8")
    pattern = re.compile(
        r"^<<<<<<< [^\n]*\n(?P<ours>.*?)^=======\n(?P<theirs>.*?)^>>>>>>> [^\n]*\n",
        re.DOTALL | re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        print("no conflict markers found", file=sys.stderr)
        return 1
    ours = match.group("ours")  # main's entry
    theirs = match.group("theirs")  # the branch's entry
    if new_version:
        theirs = re.sub(
            r"^### v\d+\.\d+\.\d+", f"### v{new_version}", theirs, count=1, flags=re.MULTILINE
        )
    merged = theirs.rstrip("\n") + "\n\n" + ours
    CHANGELOG.write_text(text[: match.start()] + merged + text[match.end() :], encoding="utf-8")
    head = merged.splitlines()[0] if merged.splitlines() else ""
    print(f"resolved — branch entry first: {head[:80]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
