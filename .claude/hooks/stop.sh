#!/usr/bin/env bash
# .claude/hooks/stop.sh
# Auto-appends a session entry to docs/context/PROGRESS.md when a Claude Code
# session ends. Captures: branch, what changed, what's WIP.
#
# Wire-up: add to .claude/settings.json under hooks.Stop:
#   { "type": "command", "command": "bash .claude/hooks/stop.sh" }
#
# Conventions
#   - This script never fails the session — every step is best-effort.
#   - Writes are append-only between the <!-- BEGIN AUTOLOG --> /
#     <!-- END AUTOLOG --> markers.
#   - Branches whose name starts with "release/" are skipped on shared
#     environments to avoid noisy churn (override with FORCE_LOG=1).

set -u

# Auto-log target. Gitignored — see .gitignore + docs/context/PROGRESS.local.md.
# Previously wrote to docs/context/PROGRESS.md, which polluted git status every
# session and blocked branch switches during merge cleanup.
PROGRESS_FILE="docs/context/PROGRESS.local.md"

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

if [ ! -f "$PROGRESS_FILE" ]; then
  mkdir -p "$(dirname "$PROGRESS_FILE")"
  cat > "$PROGRESS_FILE" <<'EOF'
# Session auto-log (gitignored)

Auto-appended by `.claude/hooks/stop.sh` on every Claude Code Stop event.
Gitignored — never enters version control. To disable, remove the Stop entry
from `.claude/settings.json`.

<!-- BEGIN AUTOLOG -->
<!-- END AUTOLOG -->
EOF
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
TS="$(date -u +'%Y-%m-%d %H:%M UTC')"

case "$BRANCH" in
  release/*) [ "${FORCE_LOG:-0}" = "1" ] || exit 0 ;;
esac

BASE="$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || echo HEAD)"
CHANGED_FILE="$(mktemp)"
WIP_FILE="$(mktemp)"
git diff --name-only "$BASE" HEAD 2>/dev/null | head -20 > "$CHANGED_FILE" || true
git status --porcelain 2>/dev/null | head -20 > "$WIP_FILE" || true
LAST_SUBJ="$(git log -1 --pretty='%h %s' 2>/dev/null || echo 'no commits yet')"

PROGRESS_FILE="$PROGRESS_FILE" \
TS="$TS" \
BRANCH="$BRANCH" \
LAST_SUBJ="$LAST_SUBJ" \
CHANGED_FILE="$CHANGED_FILE" \
WIP_FILE="$WIP_FILE" \
python3 - <<'PY' || true
import os, pathlib
path     = pathlib.Path(os.environ["PROGRESS_FILE"])
ts       = os.environ["TS"]
branch   = os.environ["BRANCH"]
last     = os.environ["LAST_SUBJ"]
changed  = pathlib.Path(os.environ["CHANGED_FILE"]).read_text().strip()
wip      = pathlib.Path(os.environ["WIP_FILE"]).read_text().strip()

def block(label, body, empty):
    if not body:
        return f"**{label}:** {empty}"
    bullets = "\n".join(f"- {line}" for line in body.splitlines() if line.strip())
    return f"**{label}:**\n{bullets}"

entry = "\n".join([
    "",
    f"### {ts} — `{branch}`",
    f"**Last commit:** {last}",
    block("Changed (vs. fork point)", changed, "(no committed diff vs. base)"),
    block("Working tree", wip, "clean"),
    "**Next:** _set by next session_",
    "",
])

src = path.read_text()
begin = "<!-- BEGIN AUTOLOG -->"
end   = "<!-- END AUTOLOG -->"
if begin not in src or end not in src:
    raise SystemExit(0)
head, rest      = src.split(begin, 1)
body, tail      = rest.split(end, 1)
new = f"{head}{begin}{body}{entry}{end}{tail}"
path.write_text(new)
PY

rm -f "$CHANGED_FILE" "$WIP_FILE"
exit 0
