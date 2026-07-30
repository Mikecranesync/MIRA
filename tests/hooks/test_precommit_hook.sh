#!/usr/bin/env bash
#
# Executable coverage for .githooks/pre-commit.
#
# WHY THIS EXISTS
# ---------------
# The hook carries seven guards and, until this file, was executed by no CI job
# and no test — the only `githooks` reference under .github/ is a comment in
# code-review.yml, which *reimplements* one section as a backstop rather than
# running the hook. Three live defects were found in it on 2026-07-29, one of
# which had been reporting SUCCESS over a diff it never read:
#
#   1. `rg` absent  -> the debug-artifact scan printed "No debug artifacts found"
#      because the call was wrapped in `2>/dev/null || true`. A silent false pass.
#   2. `python3` resolved to a Windows App Execution Alias stub that satisfies
#      `command -v` and then exits 49, so the symbol check skipped every commit.
#   3. `shellcheck`'s default formatter echoes the offending source line; on a
#      non-UTF-8 ANSI code page that aborts the file at exit 2 and DROPS every
#      later finding. 83/91 tracked .sh files contain non-ASCII.
#
# The unifying defect: the hook decided "is this tool available?" by path
# existence and never by running the tool. Every assertion below is a regression
# test for one of those, and the "dead tool" shims reproduce the alias-stub class
# directly — a tool that exists, is executable, and does not work.
#
# USAGE
#   bash tests/hooks/test_precommit_hook.sh
#
# Runs from the repo root and stages fixtures in a scratch dir so the hook sees a
# realistic index. REFUSES to run against a dirty index/worktree so it can never
# disturb local work-in-progress (see .claude/rules/session-discipline.md).

set -uo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -z "$REPO_ROOT" ]; then
  echo "FATAL: not inside a git repository" >&2
  exit 2
fi
cd "$REPO_ROOT" || exit 2

HOOK="$REPO_ROOT/.githooks/pre-commit"
[ -f "$HOOK" ] || { echo "FATAL: $HOOK not found" >&2; exit 2; }

FIXTURE_DIR="$REPO_ROOT/.precommit-hook-fixtures"
SHIM_DIR=""
PASS=0
FAIL=0

# --- safety: never run over someone's in-flight work ------------------------
# The INDEX must be empty: the hook reads `git diff --cached`, so pre-existing
# staged files would both pollute the assertions and be caught by our cleanup
# `git reset`. Unstaged edits and untracked files are left strictly alone — this
# deliberately does NOT demand a clean worktree, so it stays runnable in the
# shared checkout, which routinely carries other sessions' WIP
# (.claude/rules/session-discipline.md).
if ! git diff --cached --quiet 2>/dev/null; then
  cat >&2 <<'MSG'
FATAL: the index is not empty.

This test stages fixtures and then runs `git reset` on that path. Running it with
files already staged would corrupt the assertions and unstage your work.
Commit or unstage first (`git reset`), then re-run. Unstaged and untracked
changes are fine and are never touched.
MSG
  exit 2
fi

cleanup() {
  cd "$REPO_ROOT" 2>/dev/null || return
  # Only ever touches its own fixture path.
  git reset -q -- "$FIXTURE_DIR" 2>/dev/null || true
  rm -rf "$FIXTURE_DIR"
  [ -n "$SHIM_DIR" ] && rm -rf "$SHIM_DIR"
}
trap cleanup EXIT

ok()   { PASS=$((PASS + 1)); printf '  \033[0;32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[0;31mFAIL\033[0m %s\n' "$1"; }

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  case "$haystack" in
    *"$needle"*) ok "$label" ;;
    *) bad "$label — expected to find: $needle" ;;
  esac
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  case "$haystack" in
    *"$needle"*) bad "$label — should NOT contain: $needle" ;;
    *) ok "$label" ;;
  esac
}

assert_eq() {
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 — expected '$2', got '$1'"; fi
}

# Write the fixtures. The .sh fixture is the load-bearing one: finding #1 sits on
# a line containing a U+2014 em dash, finding #2 on a later pure-ASCII line. The
# pre-fix hook reported only the first and exited 2.
make_fixtures() {
  mkdir -p "$FIXTURE_DIR"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'echo "$alpha_undefined" # em dash \xe2\x80\x94 here\n'
    printf 'echo "$beta_undefined_ascii"\n'
  } > "$FIXTURE_DIR/bad.sh"
  printf 'import os\n\n\ndef f():\n    return os.getcwd()\n' > "$FIXTURE_DIR/probe.py"
  git add -- "$FIXTURE_DIR/bad.sh" "$FIXTURE_DIR/probe.py"
}

# A shim dir holding tools that EXIST and FAIL — the App Execution Alias class.
# 49 is the exact exit code the Windows python3 redirector returns.
make_dead_tool_shims() {
  SHIM_DIR=$(mktemp -d)
  for t in "$@"; do
    printf '#!/usr/bin/env bash\nexit 49\n' > "$SHIM_DIR/$t"
    chmod +x "$SHIM_DIR/$t"
  done
}

run_hook() { bash "$HOOK" 2>&1; }

echo "=== .githooks/pre-commit — executable coverage ==="
echo

# ---------------------------------------------------------------------------
# 1. shellcheck reports EVERY finding and blocks the commit.
#    Regression: the default formatter aborted at the non-ASCII line (exit 2)
#    and silently dropped finding #2.
# ---------------------------------------------------------------------------
echo "[1] shellcheck: all findings reported, commit blocked"
make_fixtures
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                   "hook exits 1 on a lint failure"
assert_contains     "$OUT" "alpha_undefined"          "reports the finding on the non-ASCII line"
assert_contains     "$OUT" "beta_undefined_ascii"     "reports the LATER finding (the dropped one)"
assert_not_contains "$OUT" "commitBuffer"             "no encoding abort"
assert_contains     "$OUT" "bad.sh:2:"                "uses -f gcc file:line:col format"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 2. A dead `rg` must SKIP the debug-artifact scan, never pass it.
#    Regression: the silent false pass.
# ---------------------------------------------------------------------------
echo "[2] dead rg: scan reports SKIPPED, never a pass"
make_fixtures
make_dead_tool_shims rg
OUT=$(PATH="$SHIM_DIR:$PATH" run_hook)
assert_contains     "$OUT" "SKIPPED, not passed"      "says SKIPPED"
assert_not_contains "$OUT" "No debug artifacts found" "does NOT claim a clean scan"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 3. A dead python must SKIP the symbol check, never claim a pass.
#    Regression: the App Execution Alias stub.
# ---------------------------------------------------------------------------
echo "[3] dead python: symbol check reports SKIPPED, never a pass"
make_fixtures
make_dead_tool_shims python3 python py
OUT=$(PATH="$SHIM_DIR:$PATH" run_hook)
assert_contains "$OUT" "symbol check SKIPPED, not passed" "says SKIPPED"
assert_not_contains "$OUT" "verify_agent_symbols: no"     "does NOT report a successful run"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 4. A clean staged set must PASS. Guards that only ever fail are useless, and
#    a false-positive hook gets disabled by the first developer it blocks.
# ---------------------------------------------------------------------------
echo "[4] clean fixtures: hook allows the commit"
mkdir -p "$FIXTURE_DIR"
printf '#!/usr/bin/env bash\nset -euo pipefail\nmain() { echo "ok"; }\nmain "$@"\n' \
  > "$FIXTURE_DIR/good.sh"
git add -- "$FIXTURE_DIR/good.sh"
OUT=$(run_hook); RC=$?
assert_eq "$RC" "0"                        "hook exits 0 on a clean staged set"
assert_not_contains "$OUT" "Failed:   1"   "reports no failures"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
echo "=== summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
