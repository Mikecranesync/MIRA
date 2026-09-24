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
TRUSTED_BASE_SHA="${ADV_REVIEW_TRUSTED_BASE_SHA:-}"
REMEDIATION_ROOT="${ADV_REVIEW_REMEDIATION_WORKTREE:-}"
HEAD_REF="${ADV_REVIEW_HEAD_REF:-}"
if ! [[ "$TRUSTED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || [ -z "$REMEDIATION_ROOT" ]; then
  echo "ERROR: candidate-local loop invocation is non-authoritative; use the trusted-base entrypoint." >&2
  exit 2
fi
if ! git check-ref-format --branch "$HEAD_REF" >/dev/null 2>&1; then
  echo "ERROR: malformed trusted candidate head ref." >&2
  exit 2
fi
if [ "$(git rev-parse HEAD)" != "$TRUSTED_BASE_SHA" ] || [ ! -d "$REMEDIATION_ROOT" ]; then
  echo "ERROR: malformed trusted-base/remediation worktree context." >&2
  exit 2
fi
# shellcheck source=scripts/adversarial-review-lock.sh
source "$ROOT/scripts/adversarial-review-lock.sh"
adversarial_review_lock_acquire || exit 2

OUT_DIR="${ADV_REVIEW_OUT_DIR:-$ROOT/.adversarial-review}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: no PR for the current branch and none given." >&2
  exit 2
fi

escalate() { # $1 = reason
  local sha; sha="$(current_snapshot_fields 2>/dev/null | awk '{print $1}')"
  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then sha="unknown"; fi
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
current_snapshot_fields() {
  # The single-quoted JavaScript contains a JS template literal, not shell
  # interpolation.
  # shellcheck disable=SC2016
  gh pr view "$PR_NUMBER" --json headRefOid,body 2>/dev/null | node -e '
    const crypto=require("node:crypto");
    let d="";
    process.stdin.on("data",c=>d+=c).on("end",()=>{
      const pr=JSON.parse(d);
      const body=pr.body ?? "";
      if(!/^[0-9a-f]{40}$/.test(pr.headRefOid) || typeof body!=="string") process.exit(1);
      const digest=crypto.createHash("sha256").update(body,"utf8").digest("hex");
      process.stdout.write(`${pr.headRefOid} ${digest}\n`);
    });'
}

consumed_rounds() {
  local viewer comments snapshot snapshot_sha snapshot_body_sha
  viewer="$(gh api user --jq .login 2>/dev/null)" || return 1
  snapshot="$(current_snapshot_fields)" || return 1
  read -r snapshot_sha snapshot_body_sha <<< "$snapshot"
  [[ "$snapshot_sha" =~ ^[0-9a-f]{40}$ && "$snapshot_body_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  comments="$OUT_DIR/loop-comments-$PR_NUMBER-$$.json"
  gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$comments" || return 1
  node "$ROOT/scripts/adversarial-review-ledger.mjs" "$comments" "$viewer" \
      --sha "$snapshot_sha" --body-sha256 "$snapshot_body_sha" 2>/dev/null | node -e '
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

  PRE_SNAPSHOT="$(current_snapshot_fields)" || {
    escalate "could not read the exact PR head/body snapshot before review"
    exit 2
  }
  read -r PRE_REMOTE_SHA _ <<< "$PRE_SNAPSHOT"
  PRE_SHA="$(git -C "$REMEDIATION_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [ "$PRE_REMOTE_SHA" != "$PRE_SHA" ]; then
    escalate "local head ${PRE_SHA:0:12} does not match PR head ${PRE_REMOTE_SHA:0:12} before review"
    exit 2
  fi
  # The runner posts the round RESERVATION (atomic acquisition at the GitHub
  # ledger) — mode=full announces that a privileged remediation may follow.
  if [ "$REVIEW_ONLY" -eq 1 ]; then LOOP_MODE=review_only; else LOOP_MODE=full; fi
  ARTIFACT_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  RESULT_FILE="$OUT_DIR/result-$PR_NUMBER-$ARTIFACT_TOKEN.json"
  set +e
  ADV_REVIEW_MODE="$LOOP_MODE" ADV_REVIEW_ARTIFACT_TOKEN="$ARTIFACT_TOKEN" \
    ADV_REVIEW_CANDIDATE_SHA="$PRE_SHA" \
    "$ROOT/scripts/adversarial-review.sh" "$PR_NUMBER"
  RC=$?
  set -e

  # Open each handoff artifact once with O_NOFOLLOW, validate the opened fd,
  # and build the remediation prompt from those already-verified review bytes.
  # No trusted pathname is reopened after validation.
  set +e
  # The single-quoted JavaScript contains JS template literals.
  # shellcheck disable=SC2016
  RESULT_FIELDS="$(node -e '
    const crypto=require("node:crypto");
    const fs=require("node:fs");
    const path=require("node:path");
    const [resultFile,outDir,pr,expectedHead,expectedMode,token,tpl,iteration,runnerRc,remediationRoot]=process.argv.slice(1);
    const safeOpen=(file)=>{
      let fd;
      try {
        fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
      } catch { process.exit(1); }
      const st=fs.fstatSync(fd);
      if(!st.isFile()){ fs.closeSync(fd); process.exit(1); }
      return {fd,st};
    };
    const resultOpen=safeOpen(resultFile);
    if((resultOpen.st.mode & 0o777)!==0o600){ fs.closeSync(resultOpen.fd); process.exit(1); }
    let j;
    try { j=JSON.parse(fs.readFileSync(resultOpen.fd,"utf8")); }
    catch { fs.closeSync(resultOpen.fd); process.exit(1); }
    fs.closeSync(resultOpen.fd);
    if(!j || typeof j!=="object" || Array.isArray(j)
      || !["fresh_review","deduplicated"].includes(j.kind)
      || !["GREEN","ISSUES_FOUND"].includes(j.status)
      || !/^[0-9a-f]{40}$/.test(j.head_sha)
      || !/^[0-9a-f]{64}$/.test(j.body_sha256)
      || !["full","review_only"].includes(j.mode)
      || j.head_sha!==expectedHead || j.mode!==expectedMode) process.exit(1);
    const expectedStatus=runnerRc==="0" || runnerRc==="4" ? "GREEN"
      : runnerRc==="1" ? "ISSUES_FOUND" : null;
    if(j.status!==expectedStatus) process.exit(1);
    if(j.kind==="deduplicated") {
      if(j.run_id!==null || j.reservation_comment_id!==null
        || j.review_artifact!==null || j.review_artifact_sha256!==null) process.exit(1);
      process.stdout.write(`${j.kind} ${j.status} ${j.head_sha} ${j.body_sha256} - 0 ${j.mode} -\n`);
      process.exit(0);
    }
    if(!/^[0-9a-f]{32}$/.test(j.run_id)
      || !Number.isInteger(j.reservation_comment_id) || j.reservation_comment_id < 1
      || typeof j.review_artifact!=="string" || j.review_artifact.length===0
      || !/^[0-9a-f]{64}$/.test(j.review_artifact_sha256)) process.exit(1);
    const artifactKey=`${j.head_sha}-${j.body_sha256}-${token}`;
    const expectedArtifact=path.join(outDir,`comment-${pr}-${artifactKey}.md`);
    if(j.review_artifact!==expectedArtifact) process.exit(1);
    const reviewOpen=safeOpen(expectedArtifact);
    let reviewBytes;
    try { reviewBytes=fs.readFileSync(reviewOpen.fd); }
    catch { fs.closeSync(reviewOpen.fd); process.exit(1); }
    fs.closeSync(reviewOpen.fd);
    const digest=crypto.createHash("sha256").update(reviewBytes).digest("hex");
    if(digest!==j.review_artifact_sha256) process.exit(1);
    const review=reviewBytes.toString("utf8");
    const re=/^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nreviewed_body_sha256: ([0-9a-f]{64})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: [0-9]+\r?\n(?:post_cap_human_authorized: true\r?\n)?run_id: ([0-9a-f]{32})\r?\nreservation_comment_id: ([1-9][0-9]*)\r?\n\r?\nBLOCKER: ([0-9]+)\r?\nHIGH: ([0-9]+)\r?\nMEDIUM: ([0-9]+)\r?\nLOW: ([0-9]+)\r?\nFALSE_POSITIVE: ([0-9]+)\r?\n```(?:\r?\n|$)/;
    const match=review.match(re);
    if(!match || match[1]!==j.head_sha || match[2]!==j.body_sha256
      || match[3]!==j.status || match[4]!==j.run_id
      || match[5]!==String(j.reservation_comment_id)) process.exit(1);
    if(j.status==="GREEN" && match.slice(6,10).some(v=>Number(v)!==0)) process.exit(1);
    if(j.status==="ISSUES_FOUND") {
      let prompt=fs.readFileSync(tpl,"utf8");
      for(const [k,v] of Object.entries({PR_NUMBER:pr,REVIEWED_SHA:j.head_sha,
        ITERATION:iteration,REVIEW_CONTENT:review,RUN_ID:j.run_id,
        RESERVATION_ID:String(j.reservation_comment_id),WORKTREE_PATH:remediationRoot,
        HEAD_REF:process.env.ADV_REVIEW_HEAD_REF}))
        prompt=prompt.split("{{"+k+"}}").join(v);
      const promptFile=path.join(outDir,`remediation-${pr}-${artifactKey}.md`);
      fs.writeFileSync(promptFile,prompt,{encoding:"utf8",mode:0o600,flag:"wx"});
      fs.chmodSync(promptFile,0o600);
    }
    process.stdout.write(`${j.kind} ${j.status} ${j.head_sha} ${j.body_sha256} ${j.run_id} ${j.reservation_comment_id} ${j.mode} ${artifactKey}\n`);
  ' "$RESULT_FILE" "$OUT_DIR" "$PR_NUMBER" "$PRE_SHA" "$LOOP_MODE" \
    "$ARTIFACT_TOKEN" "$ROOT/scripts/adversarial-review-remediation-prompt.md" "$CYCLE" "$RC" "$REMEDIATION_ROOT")"
  RESULT_READ_RC=$?
  set -e
  if [ "$RESULT_READ_RC" -ne 0 ]; then
    escalate "required runner result or rendered review is missing, malformed, replaced, or digest-mismatched — refusing local handoff"
    exit 2
  fi
  read -r RESULT_KIND RESULT_STATUS REVIEWED_SHA REVIEWED_BODY_SHA256 RUN_ID \
    RESERVATION_ID RES_MODE ARTIFACT_KEY <<< "$RESULT_FIELDS"
  if [ "$RESULT_KIND" = "fresh_review" ]; then
    REM_PROMPT="$OUT_DIR/remediation-$PR_NUMBER-$ARTIFACT_KEY.md"
  fi

  if [ "$RC" -eq 0 ] || [ "$RC" -eq 4 ]; then
    # F1 (PR #3279 round 1): a GREEN is terminal only if the PR head is STILL
    # the reviewed SHA — a push landing mid-review must trigger another cycle,
    # never an announcement of GREEN for an unreviewed head.
    CUR_SNAPSHOT="$(current_snapshot_fields || echo "")"
    read -r CUR_HEAD CUR_BODY_SHA256 <<< "$CUR_SNAPSHOT"
    if [ "$RC" -eq 0 ] && [ "$CUR_HEAD" = "$REVIEWED_SHA" ] \
        && [ "$CUR_BODY_SHA256" = "$REVIEWED_BODY_SHA256" ]; then
      echo "ADVERSARIAL GATE: GREEN (PR #$PR_NUMBER @ ${REVIEWED_SHA:0:12})"
      exit 0
    fi
    if [ -z "$CUR_HEAD" ]; then
      escalate "could not re-verify the PR head after a GREEN review — NOT green"
      exit 2
    fi
    if [ "$CUR_HEAD" = "$REVIEWED_SHA" ]; then
      echo "PR body changed during the review — continuing with the new exact snapshot."
      continue
    fi
    echo "PR head advanced to ${CUR_HEAD:0:12} during the review — syncing and continuing."
    git fetch origin -q || {
      escalate "git fetch origin failed at cycle $CYCLE — refusing to proceed on stale refs (fail closed)"
      exit 2
    }
    if ! git -C "$REMEDIATION_ROOT" merge --ff-only "$CUR_HEAD" 2>/dev/null; then
      escalate "local checkout diverged from advanced PR head ${CUR_HEAD:0:12} at cycle $CYCLE — manual sync required"
      exit 2
    fi
    continue
  elif [ "$RC" -ne 1 ]; then
    escalate "review tooling failed (rc=$RC) at cycle $CYCLE — NOT green"
    exit 2
  fi

  if [ "$RESULT_KIND" = "deduplicated" ] && [ "$RESULT_STATUS" = "ISSUES_FOUND" ]; then
    escalate "deduplicated ISSUES_FOUND has no trusted local review artifact — refusing privileged remediation"
    exit 1
  fi

  if [ "$REVIEW_ONLY" -eq 1 ]; then
    echo "--review-only: issues found; stopping before remediation."
    exit 1
  fi
  if [ "$CYCLE" -ge "$MAX_ITER" ]; then
    break # findings exist and no cycles left for a fix+re-review
  fi

  # ── Pre-remediation snapshot check (Codex F2, round 2) ───────────────────
  # The ISSUES_FOUND tuple comes only from the validated runner result. The
  # loop's pre-call snapshot is advisory and never selects an artifact or
  # authorizes privileged remediation.
  CUR_SNAPSHOT="$(current_snapshot_fields || echo "")"
  read -r CUR_HEAD CUR_BODY_SHA256 <<< "$CUR_SNAPSHOT"
  if [ -z "$CUR_HEAD" ]; then
    escalate "could not re-verify the PR head/body before remediation at cycle $CYCLE"
    exit 2
  fi
  if [ "$CUR_HEAD" != "$REVIEWED_SHA" ]; then
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
  if [ "$CUR_BODY_SHA256" != "$REVIEWED_BODY_SHA256" ]; then
    escalate "PR body changed during the ISSUES_FOUND review — refusing stale privileged remediation"
    exit 2
  fi

  # ── Pre-privileged reservation recheck (Codex iteration-4 F1) ─────────────
  # Immediately before launching privileged remediation, re-prove ownership
  # from the DURABLE ledger: this run still owns the canonical reservation for
  # the reviewed head/body, its run_id matches the trusted local artifact, the
  # reservation is within the autonomous budget, and no remediation completion
  # already exists for it. Any failure exits WITHOUT launching Claude.
  if [ "$RES_MODE" != "full" ]; then
    escalate "runner result is not a full-mode reservation for exact snapshot ${REVIEWED_SHA:0:12}/$REVIEWED_BODY_SHA256 — refusing privileged remediation"
    exit 2
  fi
  RECHECK_COMMENTS="$OUT_DIR/recheck-comments-$PR_NUMBER-$ARTIFACT_KEY.json"
  gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$RECHECK_COMMENTS" || {
    escalate "could not re-read the ledger before privileged remediation — refusing to launch Claude"
    exit 2
  }
  RECHECK_VIEWER="$(gh api user --jq .login 2>/dev/null)" || {
    escalate "could not resolve the posting account before privileged remediation"
    exit 2
  }
  RECHECK_JSON="$(node "$ROOT/scripts/adversarial-review-ledger.mjs" "$RECHECK_COMMENTS" "$RECHECK_VIEWER" \
      --sha "$REVIEWED_SHA" --body-sha256 "$REVIEWED_BODY_SHA256" --run-id "$RUN_ID")" || {
    escalate "ledger unusable at the pre-privileged recheck — refusing to launch Claude"
    exit 2
  }
  RECHECK_OK="$(printf '%s' "$RECHECK_JSON" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);
      const ok = j.mine_found===1
        && j.mine_comment_id===Number(process.argv[2])
        && j.mine_is_canonical_for_its_snapshot===1
        && j.canonical_run_id_for_snapshot===process.argv[1]
        && j.consumed_before_mine < 3
        && j.remediation_completed_for_run_id===0;
      process.stdout.write(ok?"1":"0");
    });' "$RUN_ID" "$RESERVATION_ID")"
  if [ "$RECHECK_OK" != "1" ]; then
    escalate "pre-privileged recheck failed for run_id $RUN_ID (ownership lost, budget exceeded, or remediation already completed) — Claude NOT launched"
    exit 2
  fi

  # ── Claude remediation (headless) ─────────────────────────────────────────
  # The review content was injected VERBATIM from the runner artifact during
  # the single fd-based validation read above. It is never reopened by path or
  # fetched from PR comments before privileged execution.

  # Remote PR state and durable ledger ownership are necessary but not enough:
  # Claude runs in this worktree. Re-prove the local executable snapshot at the
  # final boundary after every other authorization check and prompt build.
  LOCAL_REMEDIATION_SHA="$(git -C "$REMEDIATION_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [ "$LOCAL_REMEDIATION_SHA" != "$REVIEWED_SHA" ]; then
    escalate "local HEAD changed after review (${LOCAL_REMEDIATION_SHA:-unknown} != $REVIEWED_SHA) — Claude NOT launched"
    exit 2
  fi
  if ! LOCAL_TRACKED_STATUS="$(git -C "$REMEDIATION_ROOT" status --porcelain --untracked-files=all --ignored=matching)"; then
    escalate "git status failed at the final local snapshot gate — Claude NOT launched"
    exit 2
  fi
  if [ -n "$LOCAL_TRACKED_STATUS" ]; then
    escalate "local remediation worktree has tracked, untracked, or ignored drift after review — Claude NOT launched"
    exit 2
  fi

  echo "Invoking Claude for remediation (cycle $CYCLE, run_id $RUN_ID)…"
  set +e
  # --dangerously-skip-permissions: required for unattended operation; the
  # repo's deterministic hooks (prod-guard, rm-guard, git-state-guard) remain
  # the hard floor underneath. See docs/adversarial-review-workflow.md.
  # shellcheck disable=SC2086
  "$CLAUDE_BIN" -p --dangerously-skip-permissions ${CLAUDE_EXTRA_ARGS:-} \
    < "$REM_PROMPT" > "$OUT_DIR/claude-$PR_NUMBER-$ARTIFACT_KEY.log" 2>&1
  CLAUDE_RC=$?
  set -e
  if [ "$CLAUDE_RC" -ne 0 ]; then
    escalate "Claude remediation failed (rc=$CLAUDE_RC) at cycle $CYCLE"
    exit 2
  fi

  if ! POST_CLAUDE_STATUS="$(git -C "$REMEDIATION_ROOT" status --porcelain --untracked-files=all --ignored=matching)"; then
    escalate "git status failed after Claude remediation — refusing progress"
    exit 2
  fi
  if [ -n "$POST_CLAUDE_STATUS" ]; then
    escalate "Claude left tracked, untracked, or ignored remediation worktree drift — refusing progress"
    exit 2
  fi

  # ── Progress check (Codex F2, round 2): "the head moved" is NOT proof the
  #    remediation moved it — a third-party push must not count as progress. ──
  git fetch origin -q || {
    escalate "git fetch origin failed after remediation at cycle $CYCLE — refusing to judge progress on stale refs (fail closed)"
    exit 2
  }
  NEW_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)"
  if [ "$NEW_SHA" = "$REVIEWED_SHA" ]; then
    # No new commit. If the disposition says everything was FALSE_POSITIVE /
    # NEEDS_HUMAN_DECISION that is a legitimate terminal state -> escalate to
    # the human either way (nothing further is autonomously fixable).
    escalate "no code progress after remediation at cycle $CYCLE (all findings disputed or need a human)"
    exit 1
  fi
  # (a) The new head must DESCEND from the reviewed commit (fast-forward
  # lineage — not an unrelated force-push or rebase), and (b) a disposition
  # comment from OUR OWN account must attest to remediating exactly PRE_SHA.
  if ! git merge-base --is-ancestor "$REVIEWED_SHA" "$NEW_SHA" 2>/dev/null; then
    escalate "new PR head ${NEW_SHA:0:12} does not descend from the reviewed ${REVIEWED_SHA:0:12} — not remediation progress"
    exit 2
  fi
  if [ "$(git -C "$REMEDIATION_ROOT" rev-parse HEAD 2>/dev/null || true)" != "$NEW_SHA" ]; then
    escalate "Claude's local committed HEAD does not equal the exact pushed PR head — refusing progress"
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
  ' "$(gh api user --jq .login 2>/dev/null || echo '?')" "$REVIEWED_SHA" "$NEW_SHA" "$RUN_ID" || echo 0)"
  if [ "$DISPO_OK" != "1" ]; then
    escalate "PR head advanced to ${NEW_SHA:0:12} without a disposition attesting exactly (${REVIEWED_SHA:0:12} -> ${NEW_SHA:0:12}) — not counting as remediation progress"
    exit 2
  fi
  # Sync the local checkout to the pushed head for the next review round.
  # Fast-forward ONLY — this loop never runs a history-discarding command; a
  # divergence means something else pushed to the branch mid-loop, which is a
  # human problem, not one to bulldoze (.claude/rules/dangerous-commands-safety.md).
  if ! git -C "$REMEDIATION_ROOT" merge --ff-only "$NEW_SHA" 2>/dev/null; then
    escalate "local checkout diverged from pushed PR head ${NEW_SHA:0:12} at cycle $CYCLE — manual sync required"
    exit 2
  fi
done

escalate "unresolved findings after $MAX_ITER cycles"
exit 1
