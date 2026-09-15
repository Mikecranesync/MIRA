#!/usr/bin/env python3
"""hold-gate — make a PR "HELD" state machine-enforceable.

A label or a title string is NOT a merge gate on its own: GitHub's merge
machinery reads neither. This gate turns that intent into a *required status
check*. When wired into main's required checks (see docs/ci/hold-gate.md), a
red hold-gate blocks merge AND blocks an armed auto-merge until the hold is
cleared — closing the exact gap that let a "[HELD / DO NOT MERGE]" PR
auto-merge (post-mortem: #3189).

Pure decision function `is_held(title, labels)` is unit-tested; `main()` reads
the PR title + labels from the GitHub Actions event and exits non-zero when
held so the check goes red.
"""

from __future__ import annotations

import json
import os
import re
import sys

# Case-insensitive title markers that signal a deliberate hold.
TITLE_MARKERS = re.compile(r"\b(HELD|DO NOT MERGE|DO-NOT-MERGE|WIP|DRAFT)\b", re.IGNORECASE)

# Label names (lower-cased, exact) that signal a deliberate hold.
HOLD_LABELS = {"do-not-merge", "do not merge", "hold", "held", "wip", "blocked"}


def is_held(title: str, labels: list[str]) -> tuple[bool, str]:
    """Return (held, reason). Held when the title carries a hold marker OR any
    label is a hold label. Reason is a short human string for the check output."""
    label_set = {str(lbl).strip().lower() for lbl in labels}
    hit_labels = sorted(label_set & HOLD_LABELS)
    if hit_labels:
        return True, f"hold label present: {', '.join(hit_labels)}"
    m = TITLE_MARKERS.search(title or "")
    if m:
        return True, f'title contains a hold marker: "{m.group(0)}"'
    return False, "no hold label or title marker"


def _load_event() -> tuple[str, list[str]]:
    """Read the PR title + label names from the GitHub Actions event payload.
    Falls back to HOLD_TITLE / HOLD_LABELS_JSON env for local runs and tests."""
    path = os.environ.get("GITHUB_EVENT_PATH")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            event = json.load(fh)
        pr = event.get("pull_request", {}) or {}
        title = pr.get("title", "") or ""
        labels = [lbl.get("name", "") for lbl in (pr.get("labels", []) or [])]
        return title, labels
    title = os.environ.get("HOLD_TITLE", "")
    try:
        labels = json.loads(os.environ.get("HOLD_LABELS_JSON", "[]"))
    except json.JSONDecodeError:
        labels = []
    return title, labels


def main() -> int:
    title, labels = _load_event()
    held, reason = is_held(title, labels)
    if held:
        print(
            f"::error::hold-gate: this PR is HELD — {reason}. "
            f"Remove the hold label / hold marker from the title to allow merge."
        )
        print(f"hold-gate: HELD — {reason}")
        return 1
    print(f"hold-gate: OK — {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
