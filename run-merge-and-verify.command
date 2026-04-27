#!/bin/bash
# /Users/charlienode/MIRA/run-merge-and-verify.command
#
# Double-click this from Finder to merge both prepared hub-UX branches into
# main, then start a dev server for browser verification. Pauses between
# batches so Claude (in Cowork) can verify via Chrome MCP.
#
# Safe to abort with Ctrl+C at any time.

set -e
cd /Users/charlienode/MIRA

# ── Color helpers ──────────────────────────────────────────────────────────────
banner() { printf "\n\033[1;36m═══ %s ═══\033[0m\n" "$*"; }
ok()     { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
err()    { printf "\033[1;31m  ✗ %s\033[0m\n" "$*"; }
hint()   { printf "\033[1;33m  → %s\033[0m\n" "$*"; }
trap 'err "Script aborted at line $LINENO"; echo; echo "Press Ctrl+C to close, or any key to leave window open."; read -n 1' ERR

# ── Pre-flight ─────────────────────────────────────────────────────────────────
banner "Pre-flight"

if ! command -v gh >/dev/null 2>&1; then
  err "gh CLI not installed on this Mac. Install: brew install gh"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  err "gh not authenticated. Run: gh auth login --web"
  exit 1
fi
ok "gh authenticated"

for br in tech-debt/hub-ux-fixes-2026-04-26 tech-debt/hub-ux-batch-2-2026-04-26; do
  if ! git rev-parse --verify "refs/heads/$br" >/dev/null 2>&1; then
    err "Branch $br not found locally. Aborting."
    exit 1
  fi
done
ok "Both branches present locally"

if ! command -v node >/dev/null 2>&1; then
  err "node not on PATH. Install Node.js then retry."
  exit 1
fi
ok "node available: $(node --version)"

# ── PHASE 1: Batch 1 ───────────────────────────────────────────────────────────
banner "PHASE 1 — push + PR + merge tech-debt/hub-ux-fixes-2026-04-26"

git push -u origin tech-debt/hub-ux-fixes-2026-04-26 2>&1 | tail -5
ok "Branch pushed"

# Open the PR (skip if it already exists)
if ! gh pr view tech-debt/hub-ux-fixes-2026-04-26 >/dev/null 2>&1; then
  gh pr create \
    --base main \
    --head tech-debt/hub-ux-fixes-2026-04-26 \
    --title "tech-debt(hub) batch 1: 5 UX fixes — #688 #719 #720 #721 #722" \
    --body "Closes #688, closes #719, closes #720, closes #721, closes #722.
See HANDOFF.md on the branch for the per-fix breakdown + reproduce commands."
fi
PR1=$(gh pr view tech-debt/hub-ux-fixes-2026-04-26 --json number -q .number)
ok "PR #$PR1 → https://github.com/Mikecranesync/MIRA/pull/$PR1"

banner "Merging PR #$PR1 (--merge, preserves granular commits)"
gh pr merge $PR1 --merge --delete-branch=false || {
  err "gh pr merge failed. Possible causes: required CI not passing, branch protection, or you've already merged it."
  hint "Check the PR in browser, then re-run this script — it'll skip the create step."
  exit 1
}
ok "Batch 1 merged"

# ── PHASE 2: Verification worktree + dev server ────────────────────────────────
banner "PHASE 2 — verification worktree + dev server"

git fetch origin main
WT_VERIFY=".claude/worktrees/verify-merged-2026-04-26"
if [ -e "$WT_VERIFY/.git" ]; then
  echo "  Verify worktree exists, fast-forwarding to origin/main"
  (cd "$WT_VERIFY" && git fetch origin && git reset --hard origin/main)
else
  git worktree add "$WT_VERIFY" origin/main
fi
ok "Verify worktree at $WT_VERIFY"

cd "$WT_VERIFY/mira-hub"

# If the main checkout has node_modules and the package-lock matches, hardlink them — saves the install time.
MAIN_NM="/Users/charlienode/MIRA/mira-hub/node_modules"
if [ ! -d node_modules ] && [ -d "$MAIN_NM" ]; then
  if cmp -s ../package-lock.json /Users/charlienode/MIRA/mira-hub/package-lock.json 2>/dev/null \
     || cmp -s package-lock.json /Users/charlienode/MIRA/mira-hub/package-lock.json 2>/dev/null; then
    echo "  Hardlinking node_modules from main checkout (instant)..."
    cp -al "$MAIN_NM" node_modules 2>/dev/null && ok "Hardlinked node_modules" || true
  fi
fi

if [ ! -d node_modules ]; then
  echo "  Running npm install (1-3 min)..."
  npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3
  ok "Dependencies installed"
fi

# Kill any pre-existing dev server on :3000
PORT_PIDS=$(lsof -ti :3000 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
  hint "Port 3000 in use — killing PIDs: $PORT_PIDS"
  echo "$PORT_PIDS" | xargs kill 2>/dev/null || true
  sleep 2
fi

echo "  Starting dev server (next dev) in background..."
npm run dev > /tmp/mira-hub-dev.log 2>&1 &
DEV_PID=$!
echo "  PID: $DEV_PID  log: /tmp/mira-hub-dev.log"
echo "  Waiting up to 40s for dev server to come up..."
for i in $(seq 1 40); do
  RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
  if [ "$RESP" != "000" ]; then
    ok "Dev server up after ${i}s (status $RESP)"
    break
  fi
  sleep 1
done
RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
if [ "$RESP" = "000" ]; then
  err "Dev server didn't come up. Last 30 log lines:"
  tail -30 /tmp/mira-hub-dev.log
  err "Aborting — fix and re-run."
  exit 1
fi

echo
printf "\033[1;33m═══════════════════════════════════════════════════════════════════\033[0m\n"
printf "\033[1;33m   READY for batch 1 visual verification.\033[0m\n"
printf "\033[1;33m   Dev server: http://localhost:3000\033[0m\n"
printf "\033[1;33m   \033[0m\n"
printf "\033[1;33m   → Switch back to Cowork now. Claude will navigate Chrome\033[0m\n"
printf "\033[1;33m     and check each of the 5 fixes (workorders, knowledge,\033[0m\n"
printf "\033[1;33m     assets, upload picker).\033[0m\n"
printf "\033[1;33m═══════════════════════════════════════════════════════════════════\033[0m\n"
echo

read -p "When you're back from Cowork verification, press Enter to merge batch 2: " _

# ── PHASE 3: Batch 2 ───────────────────────────────────────────────────────────
banner "PHASE 3 — push + PR + merge tech-debt/hub-ux-batch-2-2026-04-26"
cd /Users/charlienode/MIRA

git push -u origin tech-debt/hub-ux-batch-2-2026-04-26 2>&1 | tail -5
ok "Branch pushed"

if ! gh pr view tech-debt/hub-ux-batch-2-2026-04-26 >/dev/null 2>&1; then
  gh pr create \
    --base main \
    --head tech-debt/hub-ux-batch-2-2026-04-26 \
    --title "tech-debt(hub) batch 2: 4 UX fixes + CHANGELOG — #717 #724 #725 #705-partial" \
    --body "Closes #717, closes #724, closes #725, closes #705 (partial).
#716 explicitly deferred per HANDOFF.md (product decision needed — see branch).
Companion to tech-debt/hub-ux-fixes-2026-04-26."
fi
PR2=$(gh pr view tech-debt/hub-ux-batch-2-2026-04-26 --json number -q .number)
ok "PR #$PR2 → https://github.com/Mikecranesync/MIRA/pull/$PR2"

banner "Merging PR #$PR2 (will produce a 3-way merge if locale-file conflicts)"
gh pr merge $PR2 --merge --delete-branch=false || {
  err "gh pr merge failed — likely a locale-file conflict (en.json / es.json / hi.json / zh.json)."
  hint "On Mac: pull both branches into a local main, resolve by keeping both sets of new keys, then push."
  exit 1
}
ok "Batch 2 merged"

# ── PHASE 4: Refresh dev server ───────────────────────────────────────────────
banner "PHASE 4 — refresh dev server with batch 2"

echo "  Killing old dev server (PID $DEV_PID)..."
kill $DEV_PID 2>/dev/null || true
sleep 3
PORT_PIDS=$(lsof -ti :3000 2>/dev/null || true)
[ -n "$PORT_PIDS" ] && echo "$PORT_PIDS" | xargs kill -9 2>/dev/null || true

cd "/Users/charlienode/MIRA/$WT_VERIFY"
git fetch origin main
git reset --hard origin/main
cd mira-hub

# Refresh node_modules if package-lock changed
if [ -f /Users/charlienode/MIRA/mira-hub/package-lock.json ] \
   && ! cmp -s package-lock.json /Users/charlienode/MIRA/mira-hub/package-lock.json 2>/dev/null; then
  echo "  package-lock changed; running npm install --prefer-offline..."
  npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3 || true
fi

echo "  Restarting dev server..."
npm run dev > /tmp/mira-hub-dev.log 2>&1 &
DEV_PID=$!
echo "  PID: $DEV_PID"
echo "  Waiting up to 40s..."
for i in $(seq 1 40); do
  RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
  [ "$RESP" != "000" ] && { ok "Dev server up after ${i}s (status $RESP)"; break; }
  sleep 1
done

echo
printf "\033[1;33m═══════════════════════════════════════════════════════════════════\033[0m\n"
printf "\033[1;33m   READY for batch 2 visual verification.\033[0m\n"
printf "\033[1;33m   → Switch to Cowork. Claude will verify the new pages\033[0m\n"
printf "\033[1;33m     (usage chart, channels disabled-reason, conversations).\033[0m\n"
printf "\033[1;33m═══════════════════════════════════════════════════════════════════\033[0m\n"
echo

read -p "When done, press Enter to clean up: " _

# ── PHASE 5: Cleanup ───────────────────────────────────────────────────────────
banner "PHASE 5 — cleanup"

kill $DEV_PID 2>/dev/null || true
PORT_PIDS=$(lsof -ti :3000 2>/dev/null || true)
[ -n "$PORT_PIDS" ] && echo "$PORT_PIDS" | xargs kill 2>/dev/null || true
ok "Dev server stopped"

echo
ok "Both branches merged to main."
echo "  Branches NOT deleted (review trail intact). Delete when satisfied:"
echo "    gh pr view $PR1 --web   # batch 1 review"
echo "    gh pr view $PR2 --web   # batch 2 review"
echo "    git push origin :tech-debt/hub-ux-fixes-2026-04-26  # delete remote"
echo "    git push origin :tech-debt/hub-ux-batch-2-2026-04-26"
echo
echo "  Verify worktree left at $WT_VERIFY for further poking. Remove with:"
echo "    git worktree remove --force $WT_VERIFY"
echo
echo "Done. You can close this window."
