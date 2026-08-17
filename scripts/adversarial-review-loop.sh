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

# Codex F3 (round 2): the 3-cycle ceiling is the documented safety contract —
# each cycle launches privileged headless remediation, so the bound is hard.
if ! [[ "$MAX_ITER" =~ ^[1-3]$ ]]; then
  echo "ERROR: --max-iter must be an integer between 1 and 3 (got: ${MAX_ITER})." >&2
  echo "       The 3-cycle ceiling is the safety contract (docs/adversarial-review-workflow.md)." >&2
  exit 2
fi

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

  if [ "$RC" -eq 0 ] || [ "$RC" -eq 4 ]; then
    # F1 (PR #3279 round 1): a GREEN is terminal only if the PR head is STILL
    # the reviewed SHA — a push landing mid-review must trigger another cycle,
    # never an announcement of GREEN for an unreviewed head.
    CUR_HEAD="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid 2>/dev/null || echo "")"
    if [ "$RC" -eq 0 ] && [ -n "$CUR_HEAD" ] && [ "$CUR_HEAD" = "$PRE_SHA" ]; then
      echo "ADVERSARIAL GATE: GREEN (PR #$PR_NUMBER @ ${PRE_SHA:0:12})"
      exit 0
    fi
    if [ -z "$CUR_HEAD" ]; then
      escalate "could not re-verify the PR head after a GREEN review — NOT green"
      exit 2
    fi
    echo "PR head advanced to ${CUR_HEAD:0:12} during the review — syncing and continuing."
    git fetch origin -q || true
    if ! git merge --ff-only "$CUR_HEAD" 2>/dev/null; then
      escalate "local checkout diverged from advanced PR head ${CUR_HEAD:0:12} at cycle $CYCLE — manual sync required"
      exit 2
    fi
    continue
  elif [ "$RC" -ne 1 ]; then
    escalate "review tooling failed (rc=$RC) at cycle $CYCLE — NOT green"
    exit 2
  fi

  if [ "$REVIEW_ONLY" -eq 1 ]; then
    echo "--review-only: issues found; stopping before remediation."
    exit 1
  fi
  if [ "$CYCLE" -ge "$MAX_ITER" ]; then
    break # findings exist and no cycles left for a fix+re-review
  fi

  # ── Pre-remediation head check (Codex F2, round 2) ───────────────────────
  # The ISSUES_FOUND we hold is for PRE_SHA. If the PR head advanced while
  # Codex ran, those findings are stale — remediating them wastes a privileged
  # run and can push conflicts. Sync and review the new head instead.
  CUR_HEAD="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid 2>/dev/null || echo "")"
  if [ -z "$CUR_HEAD" ]; then
    escalate "could not re-verify the PR head before remediation at cycle $CYCLE"
    exit 2
  fi
  if [ "$CUR_HEAD" != "$PRE_SHA" ]; then
    echo "PR head advanced to ${CUR_HEAD:0:12} during the ISSUES_FOUND review — skipping stale remediation, reviewing the new head."
    git fetch origin -q || true
    if ! git merge --ff-only "$CUR_HEAD" 2>/dev/null; then
      escalate "local checkout diverged from advanced PR head ${CUR_HEAD:0:12} at cycle $CYCLE — manual sync required"
      exit 2
    fi
    continue
  fi

  # ── Claude remediation (headless) ─────────────────────────────────────────
  # The review content is injected VERBATIM from the runner's own artifact
  # (Codex F1, round 2): remediation must never fetch its instructions from
  # PR comments, which any account can forge.
  REM_PROMPT="$OUT_DIR/remediation-$PR_NUMBER-$PRE_SHA.md"
  REVIEW_ARTIFACT="$OUT_DIR/comment-$PR_NUMBER-$PRE_SHA.md"
  if [ ! -s "$REVIEW_ARTIFACT" ]; then
    escalate "trusted review artifact missing for ${PRE_SHA:0:12} — cannot hand remediation untrusted input"
    exit 2
  fi
  node -e '
    const fs=require("fs");
    const [tpl,out,pr,sha,iter,reviewFile]=process.argv.slice(1);
    let s=fs.readFileSync(tpl,"utf8");
    const review=fs.readFileSync(reviewFile,"utf8");
    for(const [k,v] of Object.entries({PR_NUMBER:pr,REVIEWED_SHA:sha,ITERATION:iter,REVIEW_CONTENT:review}))
      s=s.split("{{"+k+"}}").join(v);
    fs.writeFileSync(out,s);
  ' "$ROOT/scripts/adversarial-review-remediation-prompt.md" "$REM_PROMPT" \
    "$PR_NUMBER" "$PRE_SHA" "$CYCLE" "$REVIEW_ARTIFACT"

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

  # ── Progress check (Codex F2, round 2): "the head moved" is NOT proof the
  #    remediation moved it — a third-party push must not count as progress. ──
  git fetch origin -q || true
  NEW_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)"
  if [ "$NEW_SHA" = "$PRE_SHA" ]; then
    # No new commit. If the disposition says everything was FALSE_POSITIVE /
    # NEEDS_HUMAN_DECISION that is a legitimate terminal state -> escalate to
    # the human either way (nothing further is autonomously fixable).
    escalate "no code progress after remediation at cycle $CYCLE (all findings disputed or need a human)"
    exit 1
  fi
  # (a) The new head must DESCEND from the reviewed commit (fast-forward
  # lineage — not an unrelated force-push or rebase), and (b) a disposition
  # comment from OUR OWN account must attest to remediating exactly PRE_SHA.
  if ! git merge-base --is-ancestor "$PRE_SHA" "$NEW_SHA" 2>/dev/null; then
    escalate "new PR head ${NEW_SHA:0:12} does not descend from the reviewed ${PRE_SHA:0:12} — not remediation progress"
    exit 2
  fi
  # Strictly-parsed attestation (Codex round 3 F2): the disposition must bind
  # BOTH ends — remediated_review_sha == the reviewed commit AND new_head_sha
  # == the head we are about to accept. An older disposition (attesting some
  # earlier head) can never satisfy a later cycle.
  DISPO_OK="$(gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const arr=JSON.parse("["+d.replace(/\]\s*\[/g,",").replace(/^\s*\[|\]\s*$/g,"")+"]");
      const [viewer,sha,newSha]=process.argv.slice(1);
      const RE=/^\[CLAUDE-REMEDIATION\]\r?\n\r?\n```\r?\nremediated_review_sha: ([0-9a-f]{40})\r?\nnew_head_sha: ([0-9a-f]{40}|none)\r?\n/;
      const ok=arr.some(c=>{
        if(typeof c.body!=="string"||!c.user||c.user.login!==viewer) return false;
        const m=c.body.match(RE);
        return !!m && m[1]===sha && m[2]===newSha;
      });
      process.stdout.write(ok?"1":"0");
    });
  ' "$(gh api user --jq .login 2>/dev/null || echo '?')" "$PRE_SHA" "$NEW_SHA" || echo 0)"
  if [ "$DISPO_OK" != "1" ]; then
    escalate "PR head advanced to ${NEW_SHA:0:12} without a disposition attesting exactly (${PRE_SHA:0:12} -> ${NEW_SHA:0:12}) — not counting as remediation progress"
    exit 2
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
