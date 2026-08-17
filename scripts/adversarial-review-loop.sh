#!/usr/bin/env bash
# adversarial-review-loop.sh — autonomous Codex-review -> Claude-remediation loop.
#
#   scripts/adversarial-review-loop.sh [PR_NUMBER] [--review-only] [--max-iter N]
#
# Each cycle: Codex adversarial review (scripts/adversarial-review.sh) ->
# if ISSUES_FOUND, invoke Claude Code headless with the remediation contract ->
# Claude validates findings, fixes real ones, commits+pushes, posts a
# [CLAUDE-REMEDIATION] disposition -> loop reviews the NEW SHA. Stops on GREEN,
# on no-progress, on tooling failure, or after --max-iter cycles (default 3),
# then posts an [ADVERSARIAL-ESCALATION] comment if not GREEN.
#
# Exit codes: 0 GREEN · 1 stopped with unresolved findings (escalated) ·
# 2 tooling failure. A tooling failure is NEVER a GREEN gate.
#
# Env overrides: CLAUDE_BIN (default claude; point at a stub to test plumbing),
# CLAUDE_EXTRA_ARGS, plus everything adversarial-review.sh honors.

set -euo pipefail

MAX_ITER=3
REVIEW_ONLY=0
PR_NUMBER=""
for a in "$@"; do
  case "$a" in
    --review-only) REVIEW_ONLY=1 ;;
    --max-iter) : ;; # value handled below
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *)
      if [ "${PREV:-}" = "--max-iter" ]; then MAX_ITER="$a"; else PR_NUMBER="$a"; fi ;;
  esac
  PREV="$a"
done

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
OUT_DIR="${ADV_REVIEW_OUT_DIR:-$ROOT/.adversarial-review}"
mkdir -p "$OUT_DIR"

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: no PR for the current branch and none given." >&2
  exit 2
fi

escalate() { # $1 = reason
  local sha; sha="$(git rev-parse HEAD)"
  local body="[ADVERSARIAL-ESCALATION]

\`\`\`
head_sha: $sha
reason: $1
cycles_run: ${CYCLE:-0} (max $MAX_ITER)
\`\`\`

The autonomous review/fix loop stopped without reaching GREEN. A human
decision is required. See the latest [CODEX-ADVERSARIAL-REVIEW] and
[CLAUDE-REMEDIATION] comments above for the unresolved findings."
  gh pr comment "$PR_NUMBER" --body "$body" >/dev/null 2>&1 || \
    echo "WARNING: could not post the escalation comment" >&2
  echo "ESCALATED: $1" >&2
}

CYCLE=0
while [ "$CYCLE" -lt "$MAX_ITER" ]; do
  CYCLE=$((CYCLE + 1))
  echo "── Cycle $CYCLE/$MAX_ITER ──────────────────────────────────────────"

  PRE_SHA="$(git rev-parse HEAD)"
  set +e
  "$ROOT/scripts/adversarial-review.sh" "$PR_NUMBER"
  RC=$?
  set -e

  case "$RC" in
    0) echo "ADVERSARIAL GATE: GREEN (PR #$PR_NUMBER @ ${PRE_SHA:0:12})"; exit 0 ;;
    1) : ;; # issues found — remediate below
    *) escalate "review tooling failed (rc=$RC) at cycle $CYCLE — NOT green"; exit 2 ;;
  esac

  if [ "$REVIEW_ONLY" -eq 1 ]; then
    echo "--review-only: issues found; stopping before remediation."
    exit 1
  fi
  if [ "$CYCLE" -ge "$MAX_ITER" ]; then
    break # findings exist and no cycles left for a fix+re-review
  fi

  # ── Claude remediation (headless) ─────────────────────────────────────────
  REM_PROMPT="$OUT_DIR/remediation-$PR_NUMBER-$PRE_SHA.md"
  node -e '
    const fs=require("fs");
    const [tpl,out,pr,sha,iter]=process.argv.slice(1);
    let s=fs.readFileSync(tpl,"utf8");
    for(const [k,v] of Object.entries({PR_NUMBER:pr,REVIEWED_SHA:sha,ITERATION:iter}))
      s=s.split("{{"+k+"}}").join(v);
    fs.writeFileSync(out,s);
  ' "$ROOT/scripts/adversarial-review-remediation-prompt.md" "$REM_PROMPT" \
    "$PR_NUMBER" "$PRE_SHA" "$CYCLE"

  echo "Invoking Claude for remediation (cycle $CYCLE)…"
  set +e
  # --dangerously-skip-permissions: required for unattended operation; the
  # repo's deterministic hooks (prod-guard, rm-guard, git-state-guard) remain
  # the hard floor underneath. See docs/adversarial-review-workflow.md.
  # shellcheck disable=SC2086
  "$CLAUDE_BIN" -p --dangerously-skip-permissions ${CLAUDE_EXTRA_ARGS:-} \
    < "$REM_PROMPT" > "$OUT_DIR/claude-$PR_NUMBER-cycle$CYCLE.log" 2>&1
  CLAUDE_RC=$?
  set -e
  if [ "$CLAUDE_RC" -ne 0 ]; then
    escalate "Claude remediation failed (rc=$CLAUDE_RC) at cycle $CYCLE"
    exit 2
  fi

  # ── Progress check: remediation must move the PR head (or have disposed
  #    every finding as FALSE_POSITIVE / NEEDS_HUMAN_DECISION) ───────────────
  git fetch origin -q || true
  NEW_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)"
  if [ "$NEW_SHA" = "$PRE_SHA" ]; then
    # No new commit. If the disposition says everything was FALSE_POSITIVE /
    # NEEDS_HUMAN_DECISION that is a legitimate terminal state -> escalate to
    # the human either way (nothing further is autonomously fixable).
    escalate "no code progress after remediation at cycle $CYCLE (all findings disputed or need a human)"
    exit 1
  fi
  # Sync the local checkout to the pushed head for the next review round.
  # Fast-forward ONLY — this loop never runs a history-discarding command; a
  # divergence means something else pushed to the branch mid-loop, which is a
  # human problem, not one to bulldoze (.claude/rules/dangerous-commands-safety.md).
  if ! git merge --ff-only "$NEW_SHA" 2>/dev/null; then
    escalate "local checkout diverged from pushed PR head ${NEW_SHA:0:12} at cycle $CYCLE — manual sync required"
    exit 2
  fi
done

escalate "unresolved findings after $MAX_ITER cycles"
exit 1
