#!/usr/bin/env bash
#
# Executable coverage for the guard hooks wired in .claude/settings.json (#4554).
#
# WHY THIS EXISTS
# ---------------
# Claude Code runs a hook in the session's CURRENT directory. Every guard used
# to be invoked by a relative path (`bash tools/hooks/prod-guard.sh`), so after
# any `cd` away from the repo root (mira-hub/, .github/workflows, /tmp) bash
# exited 127: a non-blocking hook error, so the command ran with no prod / rm /
# git-state guard at all. The fix invokes each guard through
# $CLAUDE_PROJECT_DIR, which Claude Code sets to the project root whatever the
# cwd, and blocks (exit 2) if the guard cannot be found.
#
# This runs each hook command EXACTLY as written in .claude/settings.json, from
# outside the repo and from a subdirectory, with the payload a real session
# would send, and checks that the guard still decides.
#
# USAGE
#   bash tests/hooks/test_settings_hook_paths.sh

set -uo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
[ -n "$REPO_ROOT" ] || { echo "FATAL: not inside a git repository" >&2; exit 2; }
SETTINGS="$REPO_ROOT/.claude/settings.json"
[ -f "$SETTINGS" ] || { echo "FATAL: $SETTINGS not found" >&2; exit 2; }

PASS=0
FAIL=0
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

ok()  { PASS=$((PASS + 1)); printf '  \033[0;32mPASS\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[0;31mFAIL\033[0m %s\n' "$1"; }
assert_eq() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 — expected '$2', got '$1'"; fi; }
assert_contains() {
  case "$1" in *"$2"*) ok "$3" ;; *) bad "$3 — expected to find: $2" ;; esac
}
# Guards format their JSON differently (rm_guard.py uses json.dumps spacing).
assert_denied() {
  case "${1// /}" in *'"permissionDecision":"deny"'*) ok "$2" ;; *) bad "$2 — no deny decision in: ${1:0:160}" ;; esac
}

# The hook command whose text mentions $1 (a guard script name), as written.
hook_command() {
  python3 - "$SETTINGS" "$1" <<'PY'
import json
import sys

settings, needle = sys.argv[1], sys.argv[2]
found = [
    h["command"]
    for groups in json.load(open(settings, encoding="utf-8"))["hooks"].values()
    for group in groups
    for h in group.get("hooks", [])
    if needle in h.get("command", "")
]
if len(found) != 1:
    sys.exit(f"expected exactly one hook command mentioning {needle}, found {len(found)}")
print(found[0])
PY
}

# Run hook command $1 from cwd $2 with payload $3 and project dir $4, the way
# Claude Code does: `bash -c`, payload on stdin. Prints stdout, then the exit
# code on the last line.
run_hook() {
  local out rc
  out=$(cd "$2" && printf '%s' "$3" | CLAUDE_PROJECT_DIR="$4" bash -c "$1" 2>"$TMP_DIR/stderr")
  rc=$?
  printf '%s\nRC=%s\n' "$out" "$rc"
}

bash_payload() { printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":"%s"}' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1")" "$2"; }

# A detached-HEAD repo outside the project: git-state-guard must deny a commit there.
DETACHED="$TMP_DIR/detached"
git init -q "$DETACHED"
git -C "$DETACHED" -c user.name=harness -c user.email=harness@example.invalid commit -q --allow-empty -m init
git -C "$DETACHED" checkout -q --detach
SUBDIR="$REPO_ROOT/.github/workflows"

echo "=== .claude/settings.json guard hooks — run from outside the repo root (#4554) ==="
echo

# ---------------------------------------------------------------------------
# 1. No hook reaches a repo file by a cwd-relative path.
# ---------------------------------------------------------------------------
echo "[1] every repo-file reference in a hook command goes through \$CLAUDE_PROJECT_DIR"
RELATIVE=$(python3 - "$SETTINGS" <<'PY'
import json
import re
import sys

pattern = re.compile(r"(?<![\w/$-])(tools/hooks/|\.claude/hooks/)|--config=\\?\"?(?=\.gitleaks\.toml)")
for groups in json.load(open(sys.argv[1], encoding="utf-8"))["hooks"].values():
    for group in groups:
        for h in group.get("hooks", []):
            for m in pattern.finditer(h.get("command", "")):
                if not h["command"][: m.start()].endswith("$CLAUDE_PROJECT_DIR/"):
                    print(h["command"][max(0, m.start() - 30) : m.end() + 20])
PY
)
assert_eq "${RELATIVE:-none}" "none" "no cwd-relative tools/hooks, .claude/hooks or .gitleaks.toml reference"
echo

# ---------------------------------------------------------------------------
# 2–4. Each Bash guard still decides from /tmp and from a repo subdirectory.
# ---------------------------------------------------------------------------
PROD_CMD=$(hook_command prod-guard.sh) || { bad "prod-guard hook not found"; PROD_CMD=false; }
RM_CMD=$(hook_command rm-guard.sh) || { bad "rm-guard hook not found"; RM_CMD=false; }
GIT_CMD=$(hook_command git-state-guard.sh) || { bad "git-state-guard hook not found"; GIT_CMD=false; }
WT_CMD=$(hook_command worktree-file-guard.sh) || { bad "worktree-file-guard hook not found"; WT_CMD=false; }

for CWD in "$TMP_DIR" "$SUBDIR"; do
  echo "[2] prod-guard from $CWD: a mutating SSH command to prod is denied"
  OUT=$(run_hook "$PROD_CMD" "$CWD" "$(bash_payload 'ssh root@40.160.141.61 docker restart mira-hub' "$CWD")" "$REPO_ROOT")
  assert_denied "$OUT" "prod-guard ran and denied"
  assert_contains "$OUT" "RC=0" "prod-guard exited 0 (not 127, the unguarded pass-through)"

  echo "[3] rm-guard from $CWD: rm -rf \$HOME is denied"
  OUT=$(run_hook "$RM_CMD" "$CWD" "$(bash_payload "rm -rf $HOME" "$CWD")" "$REPO_ROOT")
  assert_denied "$OUT" "rm-guard ran and denied"
  assert_contains "$OUT" "RC=0" "rm-guard exited 0 (not 127)"
done

echo "[4] git-state-guard from a detached-HEAD repo outside the project: git commit is denied"
OUT=$(run_hook "$GIT_CMD" "$DETACHED" "$(bash_payload 'git commit -m x' "$DETACHED")" "$REPO_ROOT")
assert_denied "$OUT" "git-state-guard ran and denied"
assert_contains "$OUT" "RC=0" "git-state-guard exited 0 (not 127)"

echo "[4b] control: an ordinary command from /tmp is allowed by every Bash guard"
for CMD in "$PROD_CMD" "$RM_CMD" "$GIT_CMD"; do
  OUT=$(run_hook "$CMD" "$TMP_DIR" "$(bash_payload 'ls' "$TMP_DIR")" "$REPO_ROOT")
  assert_eq "$OUT" "
RC=0" "allowed with no output and exit 0"
done

echo "[5] worktree-file-guard from /tmp runs (exit 0, not 127)"
OUT=$(run_hook "$WT_CMD" "$TMP_DIR" "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP_DIR/x.txt\",\"content\":\"x\"}}" "$REPO_ROOT")
assert_contains "$OUT" "RC=0" "worktree-file-guard exited 0"
echo

# ---------------------------------------------------------------------------
# 6. A guard that cannot be found blocks (exit 2) instead of running unguarded.
# ---------------------------------------------------------------------------
echo "[6] missing guard: a wrong CLAUDE_PROJECT_DIR blocks every guard fail-closed"
for CMD in "$PROD_CMD" "$RM_CMD" "$GIT_CMD" "$WT_CMD"; do
  OUT=$(run_hook "$CMD" "$TMP_DIR" "$(bash_payload 'ls' "$TMP_DIR")" "$TMP_DIR/no-such-project")
  assert_contains "$OUT" "RC=2" "exit 2 (blocks), not 127 (passes through)"
  assert_contains "$(cat "$TMP_DIR/stderr")" "blocked fail-closed" "says why it blocked"
done
echo

echo "=== summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
