#!/usr/bin/env bash
# Smoke test for tools/wiki_raw_ingest.py.
# Builds a throwaway git repo + drop folder, runs the ingest script
# against it, asserts the expected files / commits / log lines.
#
# Run from anywhere: bash tools/wiki_raw_ingest.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INGEST="$SCRIPT_DIR/wiki_raw_ingest.py"

WORK="$(mktemp -d -t wiki-raw-ingest.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

REPO="$WORK/repo"
DROP="$WORK/drop"
LOG="$WORK/ingest.log"
TODAY="$(date +%F)"

mkdir -p "$REPO" "$DROP"
git -C "$REPO" -c init.defaultBranch=main init -q
git -C "$REPO" config user.email "smoke@test.local"
git -C "$REPO" config user.name "smoke-test"
mkdir -p "$REPO/wiki/raw"
touch "$REPO/wiki/raw/.gitkeep"
git -C "$REPO" add wiki/raw/.gitkeep
git -C "$REPO" commit -q -m "init"

export MIRA_DROP_DIR="$DROP"
export REPO_ROOT="$REPO"
export MIRA_WIKI_INGEST_LOG="$LOG"
export MIRA_WIKI_ALLOWED_BRANCHES="main"

run_ingest() { python3 "$INGEST"; }

fail() { echo "FAIL: $*" >&2; echo "--- log ---"; cat "$LOG" 2>/dev/null || true; exit 1; }
pass() { echo "  pass: $*"; }

# -- Test 1: happy path move + commit ----------------------------------------
echo "[1] happy path"
echo "# hello $(date +%s%N)" > "$DROP/note-1.md"
run_ingest
[ -f "$REPO/wiki/raw/$TODAY/note-1.md" ] || fail "note-1.md not in wiki/raw/$TODAY/"
[ -f "$DROP/note-1.md" ] && fail "source not removed from drop"
git -C "$REPO" log -1 --oneline | grep -q "raw ingest note-1.md" || fail "no raw-ingest commit"
pass "moved + committed"

# -- Test 2: dedupe identical content ----------------------------------------
echo "[2] dedupe"
existing="$(cat "$REPO/wiki/raw/$TODAY/note-1.md")"
echo "$existing" > "$DROP/note-1-copy.md"
before=$(git -C "$REPO" rev-list --count HEAD)
run_ingest
after=$(git -C "$REPO" rev-list --count HEAD)
[ "$before" = "$after" ] || fail "duplicate content created a new commit (before=$before after=$after)"
[ -f "$DROP/note-1-copy.md" ] && fail "duplicate left behind in drop"
grep -q "dedup-skipped note-1-copy.md" "$LOG" || fail "no dedup-skipped log line"
pass "duplicate skipped, no commit"

# -- Test 3: branch guard refuses on non-main --------------------------------
echo "[3] branch guard"
git -C "$REPO" checkout -q -b junk
echo "# guarded" > "$DROP/should-not-land.md"
run_ingest
[ -f "$DROP/should-not-land.md" ] || fail "branch guard removed the file anyway"
[ -f "$REPO/wiki/raw/$TODAY/should-not-land.md" ] && fail "branch guard did not stop the move"
grep -q "branch junk not in allowed" "$LOG" || fail "no branch-guard log line"
pass "refused on junk branch, file preserved"

# -- Test 4: returning to main processes the queued file ---------------------
echo "[4] resume on main"
git -C "$REPO" checkout -q main
run_ingest
[ -f "$REPO/wiki/raw/$TODAY/should-not-land.md" ] || fail "queued file did not land after switch"
pass "queued file processed"

# -- Test 5: sanitize spaces and odd chars in filenames ----------------------
echo "[5] sanitize"
echo "# weird" > "$DROP/Weird Name (v2)!.md"
run_ingest
find "$REPO/wiki/raw/$TODAY" -maxdepth 1 -name 'Weird-Name*' -print -quit | grep -q . \
  || fail "sanitized name not produced"
pass "sanitized basename"

# -- Test 6: collision in same day picks unique name -------------------------
echo "[6] collision"
echo "# unique-A $RANDOM" > "$DROP/dup-name.md"
run_ingest
echo "# unique-B $RANDOM-$RANDOM" > "$DROP/dup-name.md"
run_ingest
count=$(find "$REPO/wiki/raw/$TODAY" -maxdepth 1 -name 'dup-name*.md' | wc -l | tr -d ' ')
[ "$count" -ge 2 ] || fail "collision did not produce a -1 suffixed file (got $count)"
pass "collision handled"

# -- Test 7: empty drop is a no-op -------------------------------------------
echo "[7] empty drop is no-op"
before=$(git -C "$REPO" rev-list --count HEAD)
run_ingest
after=$(git -C "$REPO" rev-list --count HEAD)
[ "$before" = "$after" ] || fail "empty drop produced a commit"
pass "no-op when drop empty"

echo "OK — wiki_raw_ingest smoke passed (workdir: $WORK)"
