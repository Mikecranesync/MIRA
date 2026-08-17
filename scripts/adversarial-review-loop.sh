#!/usr/bin/env bash
# adversarial-review-loop.sh — autonomous Codex-review -> Claude-remediation loop.
#
#   scripts/adversarial-review-loop.sh [PR_NUMBER] [--review-only] [--max-iter N]
#
# Each cycle: Codex adversarial review (scripts/adversarial-review.sh) ->
# if ISSUES_FOUND, invoke Claude Code headless with the remediation contract ->
# Claude validates findings, fixes real ones, commits+pushes, posts a
# [CLAUDE-REMEDIATION] disposition -> loop reviews the NEW SHA. Stops on GREEN,
# on no-progress, on tooling failure, or when the review budget is exhausted,
# then posts an [ADVERSARIAL-ESCALATION] comment if not GREEN.
#
# THE BUDGET IS DURABLE (Mike, 2026-08-17): the 3-round ceiling is counted
# from the PR's validated review ledger, not from this invocation's loop
# counter — restarting the script does NOT mint three fresh autonomous
# cycles. --max-iter can only lower the bound for one invocation. Past the
# cap, the ONLY permitted action is a human-authorized REVIEW-ONLY pass
# (ADV_REVIEW_HUMAN_AUTHORIZED=1 with --review-only); post-cap autonomous
# remediation does not exist.
#
# Exit codes: 0 GREEN · 1 stopped with unresolved findings (escalated) ·
# 2 tooling failure. A tooling failure is NEVER a GREEN gate.
#
# Env overrides: CLAUDE_BIN (default claude; point at a stub to test plumbing),
# CLAUDE_EXTRA_ARGS, plus everything adversarial-review.sh honors.

set -euo pipefail

MAX_TOTAL_ROUNDS=3
MAX_ITER=3
REVIEW_ONLY=0
PR_NUMBER=""
EXPECT_MAX_ITER=0
for a in "$@"; do
  if [ "$EXPECT_MAX_ITER" -eq 1 ]; then
    MAX_ITER="$a"; EXPECT_MAX_ITER=0; continue
  fi
  case "$a" in
    --review-only) REVIEW_ONLY=1 ;;
    --max-iter) EXPECT_MAX_ITER=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    -*) echo "ERROR: unknown flag: $a" >&2; exit 2 ;;
    *)
      if [ -n "$PR_NUMBER" ]; then
        echo "ERROR: multiple PR arguments given ('$PR_NUMBER' and '$a')." >&2; exit 2
      fi
      if ! [[ "$a" =~ ^[0-9]+$ ]]; then
        echo "ERROR: PR argument must be a numeric PR id (got: '$a')." >&2; exit 2
      fi
      PR_NUMBER="$a" ;;
  esac
done
if [ "$EXPECT_MAX_ITER" -eq 1 ]; then
  echo "ERROR: --max-iter requires a value." >&2; exit 2
fi

# Codex F3 (round 2): the 3-cycle ceiling is the documented safety contract —
# each cycle launches privileged headless remediation, so the bound is hard.
if ! [[ "$MAX_ITER" =~ ^[1-3]$ ]]; then
  echo "ERROR: --max-iter must be an integer between 1 and 3 (got: ${MAX_ITER})." >&2
  echo "       The 3-cycle ceiling is the safety contract (docs/adversarial-review-workflow.md)." >&2
  exit 2
fi

# The post-cap human override is REVIEW-ONLY by definition. Refuse to even
# start an autonomous remediation loop under it.
if [ "${ADV_REVIEW_HUMAN_AUTHORIZED:-0}" = "1" ] && [ "$REVIEW_ONLY" -ne 1 ]; then
  echo "ERROR: ADV_REVIEW_HUMAN_AUTHORIZED=1 permits a REVIEW-ONLY pass — combine it with --review-only." >&2
  echo "       Post-cap autonomous remediation does not exist (docs/adversarial-review-workflow.md)." >&2
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
run_id: ${RUN_ID:-none}
reservation_comment_id: ${RESERVATION_ID:-none}
cycles_run: ${CYCLE:-0} (max $MAX_ITER this invocation; durable cap $MAX_TOTAL_ROUNDS)
\`\`\`

The autonomous review/fix loop stopped without reaching GREEN. A human
decision is required. See the latest [CODEX-ADVERSARIAL-REVIEW] and
[CLAUDE-REMEDIATION] comments above for the unresolved findings."
  gh pr comment "$PR_NUMBER" --body "$body" >/dev/null 2>&1 || \
    echo "WARNING: could not post the escalation comment" >&2
  echo "ESCALATED: $1" >&2
}

# Durable rounds already consumed, from the validated PR ledger (never a local
# counter — a restarted loop resumes the SAME budget). Prints a number, or
# returns non-zero on any failure (callers fail closed: unknown budget is
# never treated as budget available).
consumed_rounds() {
  local viewer comments
  viewer="$(gh api user --jq .login 2>/dev/null)" || return 1
  comments="$OUT_DIR/loop-comments-$PR_NUMBER-$$.json"
  gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$comments" || return 1
  node "$ROOT/scripts/adversarial-review-ledger.mjs" "$comments" "$viewer" 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{process.stdout.write(String(JSON.parse(d).consumed));}catch(e){process.exit(1);}
    });'
}

CYCLE=0
while [ "$CYCLE" -lt "$MAX_ITER" ]; do
  # ── Durable budget gate (re-read EVERY cycle: reviews posted by this loop,
  # a concurrent session, or a previous crashed invocation all count) ────────
  CONSUMED="$(consumed_rounds)" || {
    escalate "could not read the durable review ledger — unknown budget is NOT budget"
    exit 2
  }
  if [ "$CONSUMED" -ge "$MAX_TOTAL_ROUNDS" ] && [ "${ADV_REVIEW_HUMAN_AUTHORIZED:-0}" != "1" ]; then
    escalate "durable review budget exhausted ($CONSUMED validated rounds >= $MAX_TOTAL_ROUNDS) — post-cap requires a human-authorized review-only pass"
    exit 1
  fi

  CYCLE=$((CYCLE + 1))
  echo "── Cycle $CYCLE/$MAX_ITER (durable rounds consumed: $CONSUMED/$MAX_TOTAL_ROUNDS) ──"

  PRE_SHA="$(git rev-parse HEAD)"
  # The runner posts the round RESERVATION (atomic acquisition at the GitHub
  # ledger) — mode=full announces that a privileged remediation may follow.
  if [ "$REVIEW_ONLY" -eq 1 ]; then LOOP_MODE=review_only; else LOOP_MODE=full; fi
  set +e
  ADV_REVIEW_MODE="$LOOP_MODE" "$ROOT/scripts/adversarial-review.sh" "$PR_NUMBER"
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
    git fetch origin -q || {
      escalate "git fetch origin failed at cycle $CYCLE — refusing to proceed on stale refs (fail closed)"
      exit 2
    }
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
    git fetch origin -q || {
      escalate "git fetch origin failed at cycle $CYCLE — refusing to proceed on stale refs (fail closed)"
      exit 2
    }
    if ! git merge --ff-only "$CUR_HEAD" 2>/dev/null; then
      escalate "local checkout diverged from advanced PR head ${CUR_HEAD:0:12} at cycle $CYCLE — manual sync required"
      exit 2
    fi
    continue
  fi

  # ── Pre-privileged reservation recheck (Codex iteration-4 F1) ─────────────
  # Immediately before launching privileged remediation, re-prove ownership
  # from the DURABLE ledger: this run still owns the canonical reservation for
  # the reviewed head, its run_id matches the trusted local artifact, the
  # reservation is within the autonomous budget, and no remediation completion
  # already exists for it. Any failure exits WITHOUT launching Claude.
  RES_ARTIFACT="$OUT_DIR/reservation-$PR_NUMBER-$PRE_SHA.json"
  if [ ! -s "$RES_ARTIFACT" ]; then
    escalate "trusted reservation artifact missing for ${PRE_SHA:0:12} — refusing privileged remediation without proven round ownership"
    exit 2
  fi
  # The single-quoted JS below intentionally contains JS template literals.
  # shellcheck disable=SC2016
  read -r RUN_ID RESERVATION_ID RES_MODE RES_HEAD < <(node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write(`${j.run_id} ${j.reservation_comment_id} ${j.mode} ${j.head_sha}\n`);
  ' "$RES_ARTIFACT")
  if [ "$RES_MODE" != "full" ] || [ "$RES_HEAD" != "$PRE_SHA" ]; then
    escalate "reservation artifact is not a full-mode reservation for ${PRE_SHA:0:12} (mode=$RES_MODE head=${RES_HEAD:0:12}) — refusing privileged remediation"
    exit 2
  fi
  RECHECK_COMMENTS="$OUT_DIR/recheck-comments-$PR_NUMBER-$$.json"
  gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$RECHECK_COMMENTS" || {
    escalate "could not re-read the ledger before privileged remediation — refusing to launch Claude"
    exit 2
  }
  RECHECK_VIEWER="$(gh api user --jq .login 2>/dev/null)" || {
    escalate "could not resolve the posting account before privileged remediation"
    exit 2
  }
  RECHECK_JSON="$(node "$ROOT/scripts/adversarial-review-ledger.mjs" "$RECHECK_COMMENTS" "$RECHECK_VIEWER" \
      --sha "$PRE_SHA" --run-id "$RUN_ID")" || {
    escalate "ledger unusable at the pre-privileged recheck — refusing to launch Claude"
    exit 2
  }
  RECHECK_OK="$(printf '%s' "$RECHECK_JSON" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);
      const ok = j.mine_found===1
        && j.mine_is_canonical_for_its_sha===1
        && j.canonical_run_id_for_sha===process.argv[1]
        && j.canonical_full_before_mine < 3
        && j.remediation_completed_for_run_id===0;
      process.stdout.write(ok?"1":"0");
    });' "$RUN_ID")"
  if [ "$RECHECK_OK" != "1" ]; then
    escalate "pre-privileged recheck failed for run_id $RUN_ID (ownership lost, budget exceeded, or remediation already completed) — Claude NOT launched"
    exit 2
  fi

  # ── Claude remediation (headless) ─────────────────────────────────────────
  # The review content is injected VERBATIM from the runner's own artifact
  # (Codex F1, round 2): remediation must never fetch its instructions from
  # PR comments, which any account can forge. The reservation identity rides
  # into the disposition so completion evidence binds to this exact round.
  REM_PROMPT="$OUT_DIR/remediation-$PR_NUMBER-$PRE_SHA.md"
  REVIEW_ARTIFACT="$OUT_DIR/comment-$PR_NUMBER-$PRE_SHA.md"
  if [ ! -s "$REVIEW_ARTIFACT" ]; then
    escalate "trusted review artifact missing for ${PRE_SHA:0:12} — cannot hand remediation untrusted input"
    exit 2
  fi
  node -e '
    const fs=require("fs");
    const [tpl,out,pr,sha,iter,reviewFile,runId,resId]=process.argv.slice(1);
    let s=fs.readFileSync(tpl,"utf8");
    const review=fs.readFileSync(reviewFile,"utf8");
    for(const [k,v] of Object.entries({PR_NUMBER:pr,REVIEWED_SHA:sha,ITERATION:iter,REVIEW_CONTENT:review,RUN_ID:runId,RESERVATION_ID:resId}))
      s=s.split("{{"+k+"}}").join(v);
    fs.writeFileSync(out,s);
  ' "$ROOT/scripts/adversarial-review-remediation-prompt.md" "$REM_PROMPT" \
    "$PR_NUMBER" "$PRE_SHA" "$CYCLE" "$REVIEW_ARTIFACT" "$RUN_ID" "$RESERVATION_ID"

  echo "Invoking Claude for remediation (cycle $CYCLE, run_id $RUN_ID)…"
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
  git fetch origin -q || {
    escalate "git fetch origin failed after remediation at cycle $CYCLE — refusing to judge progress on stale refs (fail closed)"
    exit 2
  }
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
  # Strictly-parsed attestation (Codex round 3 F2 + iteration-4 F1): the
  # disposition must bind THREE ends — remediated_review_sha == the reviewed
  # commit, new_head_sha == the head we are about to accept, AND run_id == this
  # round's reservation. An older disposition (attesting some earlier head or
  # another run's round) can never satisfy this cycle.
  DISPO_OK="$(gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const arr=JSON.parse("["+d.replace(/\]\s*\[/g,",").replace(/^\s*\[|\]\s*$/g,"")+"]");
      const [viewer,sha,newSha,runId]=process.argv.slice(1);
      const RE=/^\[CLAUDE-REMEDIATION\]\r?\n\r?\n```\r?\nremediated_review_sha: ([0-9a-f]{40})\r?\nnew_head_sha: ([0-9a-f]{40}|none)\r?\nrun_id: ([0-9a-f]{32})\r?\n/;
      const ok=arr.some(c=>{
        if(typeof c.body!=="string"||!c.user||c.user.login!==viewer) return false;
        const m=c.body.match(RE);
        return !!m && m[1]===sha && m[2]===newSha && m[3]===runId;
      });
      process.stdout.write(ok?"1":"0");
    });
  ' "$(gh api user --jq .login 2>/dev/null || echo '?')" "$PRE_SHA" "$NEW_SHA" "$RUN_ID" || echo 0)"
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
