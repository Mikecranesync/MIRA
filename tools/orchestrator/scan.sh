#!/usr/bin/env bash
# Product Orchestrator — scan script
# Inventories MIRA + factorylm work streams. Emits JSON to wiki/orchestrator/scan.json.
# Read-only. Auto-detects MIRA + factorylm paths.

set -euo pipefail

detect_repo() {
  local name="$1"
  if [ -n "${!2:-}" ] && [ -d "${!2}/.git" ]; then echo "${!2}"; return; fi
  for cand in "$HOME/$name" "/Users/charlienode/$name" "/Users/$USER/$name"; do
    if [ -d "$cand/.git" ]; then echo "$cand"; return; fi
  done
  for cand in /sessions/*/mnt/$name; do
    [ -d "$cand/.git" ] && { echo "$cand"; return; }
  done
  echo ""
}

MIRA_DIR=$(detect_repo "MIRA" MIRA_DIR)
FACTORYLM_DIR=$(detect_repo "factorylm" FACTORYLM_DIR)

OUT_DIR="${MIRA_DIR:-.}/wiki/orchestrator"
OUT="$OUT_DIR/scan.json"
mkdir -p "$OUT_DIR"

# All scanning + serialization in python — robust against quotes in commit msgs.
python3 - "$MIRA_DIR" "$FACTORYLM_DIR" "$OUT" <<'PYEOF'
import json, os, subprocess, sys
from datetime import datetime, timezone

MIRA_DIR, FL_DIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

def sh(cmd, cwd=None, default="", timeout=30):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return default

def have(cmd):
    return subprocess.run(["which", cmd], capture_output=True).returncode == 0

def scan_repo(path, name):
    if not path or not os.path.isdir(os.path.join(path, ".git")):
        return {"name": name, "present": False}

    cur = sh(["git", "branch", "--show-current"], cwd=path)
    # Bounded: untracked-file enumeration over a slow/network mount can take >20s on
    # large repos (factorylm). Skip untracked + submodules and cap at 10s; tracked-file
    # "modified" count is what scoring uses. Untracked count is best-effort (0 on timeout).
    status = sh(["git", "status", "--short", "--untracked-files=no", "--ignore-submodules=all"],
                cwd=path, timeout=10)
    modified = sum(1 for l in status.splitlines() if l and not l.startswith("??"))
    untracked = sum(1 for l in status.splitlines() if l.startswith("??"))

    unpushed = 0
    if cur:
        out = sh(["git", "log", f"origin/{cur}..HEAD", "--oneline"], cwd=path)
        unpushed = len([l for l in out.splitlines() if l.strip()])

    # Branches: sha | name | last_commit_iso | author | subject  — pipe-delimited
    branches_raw = sh(["git", "for-each-ref",
                       "--format=%(objectname:short)|%(refname:short)|%(committerdate:iso-strict)|%(authorname)|%(subject)",
                       "refs/heads/"], cwd=path)
    # Base ref to measure "behind" against: prefer origin/main, fall back to local main.
    base_ref = "origin/main" if sh(["git", "rev-parse", "--verify", "-q", "origin/main"], cwd=path) else "main"
    branches = []
    for line in branches_raw.splitlines():
        parts = line.split("|", 4)
        if len(parts) == 5:
            bname = parts[1]
            # Bounded per-branch rev-list — a slow/missing ref must never hang the scan.
            behind_raw = sh(["git", "rev-list", "--count", f"{bname}..{base_ref}"], cwd=path, timeout=5)
            try:
                behind_main = int(behind_raw)
            except ValueError:
                behind_main = 0
            branches.append({"sha": parts[0], "name": bname, "last_commit": parts[2],
                             "author": parts[3], "subject": parts[4], "behind_main": behind_main})

    # Stashes
    stashes_raw = sh(["git", "stash", "list", "--format=%gd|%s|%cI"], cwd=path)
    stashes = []
    for line in stashes_raw.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            stashes.append({"ref": parts[0], "subject": parts[1], "date": parts[2]})

    # Recent main commits (14d)
    recent_raw = sh(["git", "log", "--since=14 days ago",
                     "--pretty=format:%h|%cI|%an|%s", "main"], cwd=path)
    recent = []
    for line in recent_raw.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            recent.append({"sha": parts[0], "date": parts[1], "author": parts[2], "subject": parts[3]})

    prs, issues, issue_count = [], [], 0
    if have("gh"):
        out = sh(["gh", "pr", "list", "--state", "open", "--limit", "100",
                  "--json", "number,title,headRefName,createdAt,updatedAt,isDraft,labels,author"], cwd=path)
        try: prs = json.loads(out) if out else []
        except Exception: prs = []
        out = sh(["gh", "issue", "list", "--state", "open", "--label", "ready-for-agent",
                  "--limit", "50", "--json", "number,title,createdAt,updatedAt,labels"], cwd=path)
        try: issues = json.loads(out) if out else []
        except Exception: issues = []
        nwo = sh(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd=path)
        if nwo:
            out = sh(["gh", "api", "-X", "GET",
                      f"search/issues?q=repo:{nwo}+is:issue+is:open&per_page=1",
                      "--jq", ".total_count"], cwd=path)
            try: issue_count = int(out) if out else 0
            except Exception: issue_count = 0

    return {
        "name": name, "present": True, "path": path,
        "current_branch": cur,
        "modified": modified, "untracked": untracked, "unpushed": unpushed,
        "open_issue_count": issue_count,
        "branches": branches, "stashes": stashes,
        "recent_main_commits": recent,
        "open_prs": prs,
        "ready_for_agent_issues": issues,
    }

result = {
    "scanned_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    "repos": [scan_repo(MIRA_DIR, "MIRA"), scan_repo(FL_DIR, "factorylm")],
}
with open(OUT, "w") as f:
    json.dump(result, f, indent=2)
print(f"scan complete: {OUT}")
print(f"MIRA_DIR={MIRA_DIR}")
print(f"FACTORYLM_DIR={FL_DIR}")
for r in result["repos"]:
    if r["present"]:
        print(f"  {r['name']}: branches={len(r['branches'])} stashes={len(r['stashes'])} "
              f"recent_main={len(r['recent_main_commits'])} prs={len(r['open_prs'])} "
              f"ready_issues={len(r['ready_for_agent_issues'])} open_issues={r['open_issue_count']}")
PYEOF
