#!/usr/bin/env python3
"""Dedup + file (or comment-update) GitHub issues from web-review Findings.

Usage:
  python3 file_issues.py --repo Mikecranesync/MIRA --finding '<json>'
  python3 file_issues.py --repo Mikecranesync/MIRA --findings-file /tmp/f.json [--dry-run]

A Finding (input):
  {"id": "P0:/cmms:js-error-cssText", "severity": "P0", "page": "/cmms",
   "title": "JS TypeError", "evidence": "...", "suggested_fix": "...",
   "occurrences": 10, "source": "console"}

Behavior:
  1. Search existing issues for the fingerprint via `gh issue list --search`
  2. If found: comment "seen again on YYYY-MM-DD (N total)"
  3. Else: create new issue with structured body, labels [bug, web-review, severity:<P>]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

LABELS = ["bug", "web-review"]


def ensure_gh() -> None:
    if not shutil.which("gh"):
        print("ERROR: gh CLI not found in PATH. Install: brew install gh", file=sys.stderr)
        sys.exit(2)


def search_existing(repo: str, fingerprint: str) -> int | None:
    out = subprocess.run(
        ["gh", "issue", "list", "--repo", repo, "--state", "all",
         "--search", f"in:title [web-review] {fingerprint}",
         "--json", "number,title", "--limit", "5"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        print(f"gh search failed: {out.stderr.strip()}", file=sys.stderr)
        return None
    issues = json.loads(out.stdout or "[]")
    for issue in issues:
        if fingerprint in issue.get("title", ""):
            return issue["number"]
    return None


def comment_existing(repo: str, number: int, finding: dict, dry_run: bool) -> None:
    body = (
        f"Seen again on {date.today().isoformat()} by `web-review`.\n\n"
        f"- Source: `{finding.get('source','?')}`\n"
        f"- Occurrences this run: {finding.get('occurrences', 1)}\n"
        f"- Evidence: {finding.get('evidence','')[:300]}\n"
    )
    cmd = ["gh", "issue", "comment", str(number), "--repo", repo, "--body", body]
    if dry_run:
        print(f"DRY-RUN comment on #{number}: {body[:120]}…")
        return
    subprocess.run(cmd, check=True)
    print(f"Commented on existing issue #{number}")


def create_new(repo: str, finding: dict, dry_run: bool) -> None:
    sev = finding.get("severity", "P3")
    page = finding.get("page", "/")
    title = f"[web-review/{sev}] {page} — {finding.get('title','(no title)')}"
    if len(title) > 250:
        title = title[:247] + "…"
    body = f"""## Severity: {sev}
## Route: `{page}`
## Source: `{finding.get('source','?')}`
## Fingerprint: `{finding.get('id','?')}`

### Reproduction
1. Open the route above
2. Run the `web-review` skill (`.claude/skills/web-review/SKILL.md`)

### Evidence
```
{finding.get('evidence','')[:1000]}
```

### Suggested fix
{finding.get('suggested_fix') or '_(skill did not provide a specific suggestion — investigate)_'}

### Occurrences this run
{finding.get('occurrences', 1)}

---
_Auto-detected by the `web-review` skill on {date.today().isoformat()}._
"""
    label_args: list[str] = []
    for lbl in LABELS + [f"severity:{sev}"]:
        label_args += ["--label", lbl]
    cmd = ["gh", "issue", "create", "--repo", repo, "--title", title, "--body", body] + label_args
    if dry_run:
        print(f"DRY-RUN create: {title}")
        print(body[:300] + ("\n…" if len(body) > 300 else ""))
        return
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        print(f"ERROR creating issue: {out.stderr.strip()}", file=sys.stderr)
        sys.exit(3)
    print(out.stdout.strip())


def process_one(repo: str, finding: dict, dry_run: bool) -> None:
    fp = finding.get("id")
    if not fp:
        print("Skipping finding without id/fingerprint", file=sys.stderr)
        return
    existing = search_existing(repo, fp)
    if existing:
        comment_existing(repo, existing, finding, dry_run)
    else:
        create_new(repo, finding, dry_run)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, help="owner/repo")
    p.add_argument("--finding", help="Single finding as JSON string")
    p.add_argument("--findings-file", type=Path, help="JSON array of findings")
    p.add_argument("--dry-run", action="store_true", help="Print actions without calling gh")
    args = p.parse_args()

    ensure_gh()

    if args.finding:
        process_one(args.repo, json.loads(args.finding), args.dry_run)
    elif args.findings_file:
        for f in json.loads(args.findings_file.read_text()):
            process_one(args.repo, f, args.dry_run)
    else:
        print("Provide --finding or --findings-file", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
