#!/usr/bin/env bash
#
# Executable coverage for .githooks/pre-commit.
#
# WHY THIS EXISTS
# ---------------
# The hook carries eight guards and, until this file, was executed by no CI job
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
GUARDED_FIXTURE="$REPO_ROOT/mira-mobile/src/screens/.precommit lifecycle guard fixture.tsx"
CANONICAL_FIXTURE="$REPO_ROOT/mira-mobile/src/unified/.precommit-lifecycle-guard-fixture.ts"
WORKFLOW_FIXTURE="$REPO_ROOT/.github/workflows/.precommit-approval-fixture.yml"
APPROVAL_RECORDS=()
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
  git reset -q -- "$FIXTURE_DIR" "$GUARDED_FIXTURE" "$CANONICAL_FIXTURE" "$WORKFLOW_FIXTURE" 2>/dev/null || true
  rm -rf "$FIXTURE_DIR"
  rm -f "$GUARDED_FIXTURE" "$CANONICAL_FIXTURE" "$WORKFLOW_FIXTURE"
  # Only the approval records this run wrote; never the store or its audit log.
  local rec
  for rec in "${APPROVAL_RECORDS[@]+"${APPROVAL_RECORDS[@]}"}"; do rm -f "$rec"; done
  APPROVAL_RECORDS=()
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

# Write an approval record for the CURRENT index through the tool's own library
# function — a TEST-HARNESS approval, not a human one (the real `approve`
# requires the owner at a terminal, which this harness deliberately never
# fakes). Optional $1: a JSON object merged over the record to make it stale or
# tampered, or the literal MALFORMED to write unparseable bytes.
write_test_approval() {
  local rec
  rec=$(python3 - "${1:-}" <<'PY'
import json
import sys

sys.path.insert(0, "tools")
import guarded_commit_approval as g

b = g.binding()
path = g.write_record(
    b,
    g.guarded_paths([p for _, p in b["staged"]]),
    approved_by="test-harness (not a human approval)",
    confirmed_via="test-harness",
)
patch = sys.argv[1]
if patch == "MALFORMED":
    path.write_text("{not json", encoding="utf-8")
elif patch:
    record = json.loads(path.read_text(encoding="utf-8"))
    record.update(json.loads(patch))
    path.write_text(json.dumps(record), encoding="utf-8")
print(path)
PY
) || { bad "could not write a test approval record"; return 1; }
  APPROVAL_RECORDS+=("$rec")
}

stage_guarded_fixture() {
  printf 'export const precommitLifecycleGuardFixture = %s;\n' "${1:-true}" > "$GUARDED_FIXTURE"
  git add -- "$GUARDED_FIXTURE"
}

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
RC=$?
assert_eq "$RC" "1" "missing Python blocks when lifecycle policy cannot run"
assert_contains "$OUT" "UI lifecycle policy could not run" "lifecycle check fails closed"
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
# 5. A guarded legacy UI path must be stopped before commit with an actionable
#    route to the canonical shell. This executes the real registry-backed
#    lifecycle classifier through the production hook.
# ---------------------------------------------------------------------------
echo "[5] guarded legacy UI: hook blocks and routes work to canonical adapters"
printf 'export const precommitLifecycleGuardFixture = true;\n' > "$GUARDED_FIXTURE"
git add -- "$GUARDED_FIXTURE"
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                      "hook blocks a guarded legacy UI path"
assert_contains "$OUT" "Guarded legacy UI route staged" "names the lifecycle violation"
assert_contains "$OUT" "mira-mobile/src/screens/.precommit lifecycle guard fixture.tsx" \
  "lists the exact guarded path"
assert_contains "$OUT" "mira-mobile/src/unified/**"      "points mobile work to the canonical adapter"
assert_contains "$OUT" "Automation must not bypass"     "tells agents not to evade the blocker"
assert_contains "$OUT" "no owner approval for this exact staged tree" \
  "unapproved: names the missing owner approval"
assert_contains "$OUT" "guarded_commit_approval.py approve" "points the owner at the supported approval"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 6. The existing mobile unified adapter is canonical and must remain open.
#    A guard that blocks both old and new paths would push agents back toward
#    bypassing it rather than guide them to the intended seam.
# ---------------------------------------------------------------------------
echo "[6] canonical mobile adapter: hook allows the intended route"
printf 'export const precommitLifecycleGuardFixture = true;\n' > "$CANONICAL_FIXTURE"
git add -- "$CANONICAL_FIXTURE"
OUT=$(run_hook); RC=$?
assert_eq "$RC" "0"                                  "hook allows the canonical unified adapter"
assert_contains "$OUT" "No guarded legacy UI paths staged" "reports the lifecycle check passed"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 7–15. Owner approval for one exact guarded commit (tools/guarded_commit_approval.py).
#    The approval must clear ONLY the lifecycle verdict, ONLY for the tree, path
#    list, branch and HEAD it names, and never while another check fails. Each
#    "blocked" case below differs from the approved case [7] in one respect.
# ---------------------------------------------------------------------------
echo "[7] approved: an exact approval clears the lifecycle check"
stage_guarded_fixture
write_test_approval
OUT=$(run_hook); RC=$?
assert_eq "$RC" "0"                                               "hook allows the approved guarded tree"
assert_contains "$OUT" "owner approval bound to this exact tree"  "says the approval was used"
assert_contains "$OUT" "test-harness (not a human approval)"      "names who approved"
cleanup; trap cleanup EXIT
echo

echo "[8] changed content: re-staging after approval voids it"
stage_guarded_fixture
write_test_approval
stage_guarded_fixture false
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                                  "hook blocks a re-staged edit"
assert_contains "$OUT" "no owner approval for this exact staged tree" "the approval does not follow the edit"
cleanup; trap cleanup EXIT
echo

echo "[9] extra staged file: an unapproved addition voids it"
stage_guarded_fixture
write_test_approval
mkdir -p "$FIXTURE_DIR"
printf 'extra\n' > "$FIXTURE_DIR/extra.txt"
git add -- "$FIXTURE_DIR/extra.txt"
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                                  "hook blocks an extra staged file"
assert_contains "$OUT" "no owner approval for this exact staged tree" "the approval covers only its tree"
cleanup; trap cleanup EXIT
echo

echo "[10] stale binding: HEAD moved, branch differs, or approval expired"
stage_guarded_fixture
write_test_approval '{"base": "0000000000000000000000000000000000000000"}'
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks an approval for a different HEAD"
assert_contains "$OUT" "approval is stale: base"     "names the moved HEAD"
cleanup; trap cleanup EXIT
stage_guarded_fixture
write_test_approval '{"branch": "some-other-branch"}'
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks an approval for a different branch"
assert_contains "$OUT" "approval is stale: branch"   "names the branch mismatch"
cleanup; trap cleanup EXIT
stage_guarded_fixture
write_test_approval '{"expires_at": "2000-01-01T00:00:00+00:00"}'
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks an expired approval"
assert_contains "$OUT" "approval expired"            "names the expiry"
cleanup; trap cleanup EXIT
echo

echo "[11] tampered records fail closed"
stage_guarded_fixture
write_test_approval MALFORMED
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks an unparseable record"
assert_contains "$OUT" "unreadable"                  "names the unreadable record"
cleanup; trap cleanup EXIT
stage_guarded_fixture
write_test_approval '{"version": 99}'
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks an unknown record version"
assert_contains "$OUT" "unknown version"             "names the version mismatch"
cleanup; trap cleanup EXIT
stage_guarded_fixture
write_test_approval '{"allowed_paths": []}'
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                  "hook blocks a guarded path the owner did not see"
assert_contains "$OUT" "not covered by the approval" "names the uncovered guarded path"
cleanup; trap cleanup EXIT
echo

echo "[12] approved guarded change + shellcheck failure: still blocked"
make_fixtures
stage_guarded_fixture
write_test_approval
OUT=$(run_hook); RC=$?
assert_eq "$RC" "1"                                               "an approval never clears shellcheck"
assert_contains "$OUT" "owner approval bound to this exact tree"  "the lifecycle verdict alone was cleared"
assert_contains "$OUT" "beta_undefined_ascii"                     "shellcheck still ran and reported"
cleanup; trap cleanup EXIT
echo

echo "[13] approved guarded change + planted secret: still blocked"
if command -v gitleaks >/dev/null 2>&1; then
  # Assembled at runtime so this harness file itself never contains a token.
  TOKEN="gh""p_$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
  printf 'export const precommitLifecycleGuardFixture = "%s";\n' "$TOKEN" > "$GUARDED_FIXTURE"
  git add -- "$GUARDED_FIXTURE"
  write_test_approval
  OUT=$(run_hook); RC=$?
  assert_eq "$RC" "1"                                               "an approval never clears gitleaks"
  assert_contains "$OUT" "owner approval bound to this exact tree"  "the lifecycle verdict alone was cleared"
  assert_contains "$OUT" "gitleaks detected secrets"                "gitleaks still ran and blocked"
else
  echo "  SKIP gitleaks not installed here (CI image installs shellcheck + ripgrep only)"
fi
cleanup; trap cleanup EXIT
echo

echo "[14] approved invalid workflow: actionlint still blocks"
if command -v actionlint >/dev/null 2>&1; then
  printf 'name: approval fixture\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ not.a.context }}\n' \
    > "$WORKFLOW_FIXTURE"
  git add -- "$WORKFLOW_FIXTURE"
  write_test_approval
  OUT=$(run_hook); RC=$?
  assert_eq "$RC" "1"                                               "an approval never clears actionlint"
  assert_contains "$OUT" "owner approval bound to this exact tree"  "the guarded workflow itself was approved"
  assert_contains "$OUT" "actionlint failed"                        "actionlint still ran and blocked"
else
  echo "  SKIP actionlint not installed here (the CI gate is .github/workflows/actionlint.yml)"
fi
cleanup; trap cleanup EXIT
echo

echo "[15] approve refuses without a terminal (an agent cannot self-approve)"
stage_guarded_fixture
OUT=$(python3 tools/guarded_commit_approval.py approve </dev/null 2>&1); RC=$?
if (exec </dev/tty) 2>/dev/null; then
  echo "  SKIP this shell has a controlling terminal; the refusal path is proven in CI"
else
  assert_eq "$RC" "1"                                  "approve exits 1 with no controlling terminal"
  assert_contains "$OUT" "needs the owner at a real terminal" "explains why it refused"
fi
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
# 16–17. The Claude-side PreToolUse layer (tools/hooks/guarded_approval_guard.py).
#    Defence in depth only: it denies the obvious routes around the approval and
#    turns a guarded commit into a visible prompt, but grants nothing.
# ---------------------------------------------------------------------------
claude_hook_decision() {
  printf '%s' "$1" | python3 tools/hooks/guarded_approval_guard.py \
    | python3 -c 'import json,sys; d=sys.stdin.read().strip(); print(json.loads(d)["hookSpecificOutput"]["permissionDecision"] if d else "allow")'
}

echo "[16] Claude hook: denies routes around the approval, allows ordinary work"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}')" "deny" \
  "denies git commit --no-verify"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"git commit -nm x"}}')" "deny" \
  "denies the short -n form inside a flag cluster"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"text mentions -n and --no-verify\""}}')" "allow" \
  "control: the words inside a commit message are not flags"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"echo {} > .git/mira-guarded-approvals/x.json"}}')" "deny" \
  "denies a Bash write into the approval store"
assert_eq "$(claude_hook_decision '{"tool_name":"Write","tool_input":{"file_path":"/r/.git/mira-guarded-approvals/a.json"}}')" "deny" \
  "denies a Write into the approval store"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"script -q /dev/null python3 tools/guarded_commit_approval.py approve"}}')" "deny" \
  "denies faking a terminal around approve"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"python3 tools/guarded_commit_approval.py status"}}')" "allow" \
  "control: reading approval status is allowed"
echo

echo "[17] Claude hook: a commit with guarded paths staged becomes a prompt, never a grant"
stage_guarded_fixture
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}')" "ask" \
  "asks before a commit that includes a guarded path"
cleanup; trap cleanup EXIT
mkdir -p "$FIXTURE_DIR"
printf 'ok\n' > "$FIXTURE_DIR/plain.txt"
git add -- "$FIXTURE_DIR/plain.txt"
assert_eq "$(claude_hook_decision '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}')" "allow" \
  "control: an ordinary commit is not prompted"
cleanup; trap cleanup EXIT
echo

# ---------------------------------------------------------------------------
echo "=== summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
