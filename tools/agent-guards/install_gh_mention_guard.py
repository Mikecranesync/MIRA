#!/usr/bin/env python3
"""Install gh_mention_guard.py as a user-level Claude Code PreToolUse(Bash) hook on this node.

Idempotent. Copies the hook to ~/.claude/hooks/gh-mention-guard.py, backs up
~/.claude/settings.json, and appends the hook to the existing "Bash" PreToolUse
matcher (creating it if absent) without touching any other setting. Then checks
that the commit-hook scanners (gitleaks, rg) are installed, since without them
.githooks/pre-commit silently skips its secret and debug scans.

    python3 tools/agent-guards/install_gh_mention_guard.py [--home DIR] [--dry-run]

Exit 0 = hook installed (or already present) and both scanners found.
Exit 1 = hook installed but a scanner is missing (prints the brew command).
Exit 2 = settings.json unreadable; nothing was changed.

Rule: .claude/rules/claims-and-outward-actions.md (rule 5). Installed on BRAVO
and CHARLIE 2026-10-27; ALPHA was offline and still needs this run.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

HOOK_SRC = Path(__file__).with_name("gh_mention_guard.py")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--home", default=os.path.expanduser("~"), help="target home dir (tests use a temp dir)"
    )
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    claude = Path(a.home) / ".claude"
    hook_dst = claude / "hooks" / "gh-mention-guard.py"
    settings = claude / "settings.json"
    cmd = f'/usr/bin/env python3 "{hook_dst}"'

    try:
        data = json.loads(settings.read_text(encoding="utf-8")) if settings.exists() else {}
    except (OSError, ValueError) as e:
        print(f"install: cannot read {settings}: {e} - nothing changed", file=sys.stderr)
        return 2

    pre = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
    bash = next((e for e in pre if e.get("matcher") == "Bash"), None)
    if bash is None:
        bash = {"matcher": "Bash", "hooks": []}
        pre.append(bash)
    hooks = bash.setdefault("hooks", [])
    present = any(h.get("command") == cmd for h in hooks)

    if a.dry_run:
        print(f"dry-run: hook {'already present' if present else 'would be added'} in {settings}")
    else:
        hook_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HOOK_SRC, hook_dst)
        hook_dst.chmod(0o755)
        if present:
            print(f"hook already present in {settings}; hook file refreshed")
        else:
            if settings.exists():
                backup = settings.with_name(
                    f"settings.json.bak-{time.strftime('%Y%m%d%H%M%S')}-mention-guard"
                )
                shutil.copy2(settings, backup)
                print(f"backup: {backup}")
            hooks.append(
                {
                    "type": "command",
                    "command": cmd,
                    "timeout": 30,
                    "statusMessage": "Checking gh @mentions",
                }
            )
            settings.parent.mkdir(parents=True, exist_ok=True)
            settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"hook added to PreToolUse[Bash] in {settings}")

    missing = [t for t in ("gitleaks", "rg") if shutil.which(t) is None]
    if missing:
        print(
            f"MISSING scanners: {', '.join(missing)} -> brew install gitleaks ripgrep",
            file=sys.stderr,
        )
        return 1
    print("scanners: gitleaks and rg found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
