#!/usr/bin/env bash
# adversarial-review.sh — one Codex adversarial review round, persisted to the PR.
#
#   scripts/adversarial-review.sh [PR_NUMBER] [--force] [--dry-run]
#
# Flow: resolve PR -> verify local HEAD == PR head (never review unpushed or
# stale state) -> parse the validated review ledger (iteration + durable
# budget) -> run `codex exec` (read-only sandbox, JSON output schema) ->
# validate + render -> `gh pr comment`. See docs/adversarial-review-workflow.md.
#
# Exit codes:
#   0  GREEN (or already reviewed GREEN at this SHA) — re-verified against the
#      CURRENT PR head and body at exit; a GREEN is authoritative only while
#      both still match the reviewed snapshot
#   1  ISSUES_FOUND (review posted)
#   2  tooling failure (codex/gh/parse) — NEVER interpreted as GREEN
#   3  precondition failure (no PR, dirty tree, HEAD mismatch, bad arguments,
#      or the durable review budget is exhausted without human authorization)
#   4  stale GREEN — the review is GREEN for the reviewed head/body snapshot,
#      but the PR head or body changed while Codex ran; the current snapshot
#      is unreviewed
#
# Durable budget (Mike, 2026-08-17): a PR gets at most MAX_TOTAL_ROUNDS (3)
# validated review rounds ACROSS ITS WHOLE HISTORY — counted from the PR
# comment ledger, so a restarted script cannot mint fresh rounds. Past the
# cap, a review runs ONLY with ADV_REVIEW_HUMAN_AUTHORIZED=1 (an explicit,
# per-run human authorization; this runner is review-only by construction),
# and the posted record carries `post_cap_human_authorized: true`.
#
# Env overrides: CODEX_BIN, CODEX_TIMEOUT_SECS (default 2400), CODEX_MODEL,
# ADV_REVIEW_OUT_DIR (default .adversarial-review/, gitignored),
# ADV_REVIEW_HUMAN_AUTHORIZED (post-cap override, human-set only),
# ADV_REVIEW_ARTIFACT_TOKEN (optional 32-char lowercase-hex invocation token).

set -euo pipefail

MARKER='[CODEX-ADVERSARIAL-REVIEW]'
RESERVATION_MARKER='[ADVERSARIAL-ROUND-RESERVATION]'
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_TIMEOUT_SECS="${CODEX_TIMEOUT_SECS:-2400}"
MAX_TOTAL_ROUNDS=3
if ! [[ "$CODEX_TIMEOUT_SECS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: CODEX_TIMEOUT_SECS must be a positive integer." >&2
  exit 3
fi

FORCE=0
DRY_RUN=0
PR_NUMBER=""
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    -*)
      # --allow-dirty was deliberately REMOVED (it let a review claim an
      # exact SHA while the tree contained uncommitted drift). Unknown flags
      # fail closed rather than being silently swallowed into PR_NUMBER.
      echo "ERROR: unknown flag: $a" >&2; exit 3 ;;
    *)
      if [ -n "$PR_NUMBER" ]; then
        echo "ERROR: multiple PR arguments given ('$PR_NUMBER' and '$a')." >&2; exit 3
      fi
      if ! [[ "$a" =~ ^[0-9]+$ ]]; then
        echo "ERROR: PR argument must be a numeric PR id (got: '$a')." >&2; exit 3
      fi
      PR_NUMBER="$a" ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
# shellcheck source=scripts/adversarial-review-lock.sh
source "$ROOT/scripts/adversarial-review-lock.sh"
adversarial_review_lock_acquire || exit 2
OUT_DIR="${ADV_REVIEW_OUT_DIR:-$ROOT/.adversarial-review}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"

ARTIFACT_TOKEN="${ADV_REVIEW_ARTIFACT_TOKEN:-}"
if [ -n "$ARTIFACT_TOKEN" ] && ! [[ "$ARTIFACT_TOKEN" =~ ^[0-9a-f]{32}$ ]]; then
  echo "ERROR: ADV_REVIEW_ARTIFACT_TOKEN must be exactly 32 lowercase hexadecimal characters." >&2
  exit 3
fi
if [ -z "$ARTIFACT_TOKEN" ]; then
  ARTIFACT_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
fi
MODE="${ADV_REVIEW_MODE:-review_only}"
if [ "$MODE" != "full" ] && [ "$MODE" != "review_only" ]; then
  echo "ERROR: ADV_REVIEW_MODE must be 'full' or 'review_only' (got: '$MODE')." >&2
  exit 3
fi

# ── Preconditions ────────────────────────────────────────────────────────────
if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: no PR found for the current branch and none given. Create the PR first." >&2
  exit 3
fi

# Reserve the caller-supplied invocation namespace before creating any of its
# artifacts. The durable claim is intentionally never removed: a token is a
# one-shot capability and must not be reusable after a crash or partial run.
TOKEN_CLAIM="$OUT_DIR/token-$PR_NUMBER-$ARTIFACT_TOKEN.claim"
# The single-quoted JavaScript contains a JavaScript template literal.
# shellcheck disable=SC2016
node -e '
  const fs=require("node:fs");
  const [claim]=process.argv.slice(1);
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
  const fd=fs.openSync(claim,flags,0o600);
  try {
    fs.writeFileSync(fd,`pid=${process.ppid}\n`,"utf8");
    fs.fchmodSync(fd,0o600);
  }
  finally { fs.closeSync(fd); }
' "$TOKEN_CLAIM" || {
  echo "ERROR: artifact token $ARTIFACT_TOKEN is already reserved or cannot be claimed." >&2
  exit 2
}

# Publish the only handoff the loop may consume. Both a fresh review and a
# deduplicated terminal verdict produce an exact-snapshot, token-bound result;
# only a fresh result may carry reservation and rendered-review authority.
publish_result() { # kind status head body run_id reservation_id review digest
  local kind="$1" status="$2" head="$3" body="$4" run_id="$5"
  local reservation_id="$6" review_artifact="$7" review_digest="$8"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  local result_file="$OUT_DIR/result-$PR_NUMBER-$ARTIFACT_TOKEN.json"
  local result_tmp="$result_file.tmp.$$"
  node -e '
    const fs=require("node:fs");
    const [tmp,final,kind,status,head,body,runId,reservationId,mode,reviewArtifact,reviewDigest]=process.argv.slice(1);
    if(!["fresh_review","deduplicated"].includes(kind)
      || !["GREEN","ISSUES_FOUND"].includes(status)) process.exit(1);
    const fresh=kind==="fresh_review";
    if(fresh && (!/^[0-9a-f]{32}$/.test(runId)
      || !/^[1-9][0-9]*$/.test(reservationId)
      || reviewArtifact.length===0 || !/^[0-9a-f]{64}$/.test(reviewDigest))) process.exit(1);
    if(!fresh && (runId!=="" || reservationId!=="" || reviewArtifact!=="" || reviewDigest!=="")) process.exit(1);
    const result={kind,status,head_sha:head,body_sha256:body,
      run_id:fresh?runId:null,
      reservation_comment_id:fresh?Number(reservationId):null,
      mode,review_artifact:fresh?reviewArtifact:null,
      review_artifact_sha256:fresh?reviewDigest:null};
    fs.writeFileSync(tmp,JSON.stringify(result)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
    fs.chmodSync(tmp,0o600);
    fs.linkSync(tmp,final);
    fs.unlinkSync(tmp);
  ' "$result_tmp" "$result_file" "$kind" "$status" "$head" "$body" \
    "$run_id" "$reservation_id" "$MODE" "$review_artifact" "$review_digest" || {
    rm -f "$result_tmp"
    echo "ERROR: could not publish the runner result artifact without replacement" >&2
    return 2
  }
}

PR_JSON="$(gh pr view "$PR_NUMBER" --json number,title,body,baseRefName,baseRefOid,headRefOid,headRefName,url)" || {
  echo "ERROR: gh could not read PR #$PR_NUMBER" >&2; exit 2; }
PR_TITLE="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).title))')"
BASE_REF="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).baseRefName))')"
BASE_SHA="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).baseRefOid))')"
HEAD_SHA="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).headRefOid))')"
BASE_REPO_OWNER="$(printf '%s' "$PR_JSON" | node -e '
  let d="";
  process.stdin.on("data",c=>d+=c).on("end",()=>{
    const path=new URL(JSON.parse(d).url).pathname.split("/").filter(Boolean);
    if(path.length < 4 || path[2] !== "pull") process.exit(1);
    process.stdout.write(path[0]);
  });')" || {
  echo "ERROR: could not resolve the base repository owner from PR #$PR_NUMBER" >&2
  exit 2
}
# Derive the immutable invocation key before creating any load-bearing local
# artifact. The token separates concurrent runs even at one exact snapshot.
PR_BODY_SHA256="$(printf '%s' "$PR_JSON" | node -e '
  const crypto=require("node:crypto");
  let d="";
  process.stdin.on("data",c=>d+=c).on("end",()=>{
    const rawBody=JSON.parse(d).body;
    if(rawBody !== null && typeof rawBody !== "string") process.exit(1);
    const body=rawBody ?? "";
    process.stdout.write(crypto.createHash("sha256").update(body,"utf8").digest("hex"));
  });')" || {
  echo "ERROR: could not digest the exact PR body review artifact" >&2
  exit 2
}
ARTIFACT_KEY="$HEAD_SHA-$PR_BODY_SHA256-$ARTIFACT_TOKEN"
PR_BODY_FILE="$OUT_DIR/pr-body-$PR_NUMBER-$ARTIFACT_KEY.md"
printf '%s' "$PR_JSON" | node -e '
  const fs=require("node:fs");
  const [out]=process.argv.slice(1);
  let d="";
  process.stdin.on("data",c=>d+=c).on("end",()=>{
    const rawBody=JSON.parse(d).body;
    if(rawBody !== null && typeof rawBody !== "string") process.exit(1);
    fs.writeFileSync(out,rawBody ?? "",{encoding:"utf8",mode:0o400,flag:"wx"});
    fs.chmodSync(out,0o400);
  });' "$PR_BODY_FILE" || {
  echo "ERROR: could not materialize the exact PR body review artifact" >&2
  exit 2
}

if [ -z "${ADV_REVIEW_TRUSTED_BASE_SHA:-}" ] || [ -z "${ADV_REVIEW_CANDIDATE_SHA:-}" ]; then
  echo "ERROR: candidate-local invocation is non-authoritative; load scripts/adversarial-review-trusted.sh from origin/<current-base>." >&2
  exit 3
fi
if [ "$ADV_REVIEW_TRUSTED_BASE_SHA" != "$BASE_SHA" ] || [ "$ADV_REVIEW_CANDIDATE_SHA" != "$HEAD_SHA" ]; then
  echo "ERROR: trusted execution tuple does not match the current PR base/head." >&2
  exit 3
fi
LOCAL_SHA="$(git rev-parse HEAD)"
if [ "$LOCAL_SHA" != "$BASE_SHA" ]; then
  echo "ERROR: producer HEAD ($LOCAL_SHA) != captured PR base ($BASE_SHA)." >&2
  exit 3
fi
if [[ "$OUT_DIR/" == "$ROOT/"* ]]; then
  echo "ERROR: review artifacts must live outside the trusted-base worktree." >&2
  exit 3
fi
git cat-file -e "$HEAD_SHA^{commit}" 2>/dev/null || {
  echo "ERROR: candidate commit $HEAD_SHA is unavailable as read-only git evidence." >&2
  exit 3
}
assert_local_snapshot() {
  local expected_sha="$1" phase="$2" local_sha local_status
  local_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  if [ "$local_sha" != "$expected_sha" ]; then
    echo "ERROR: local HEAD drifted during $phase ($local_sha != $expected_sha)." >&2
    return 1
  fi
  if ! local_status="$(git status --porcelain --untracked-files=all --ignored=matching)"; then
    echo "ERROR: git status failed during $phase — cannot prove the full worktree is clean." >&2
    return 1
  fi
  if [ -n "$local_status" ]; then
    echo "ERROR: worktree has tracked, untracked, or ignored drift during $phase." >&2
    return 1
  fi
}
assert_local_snapshot "$BASE_SHA" "initial trusted-base snapshot" || exit 3

# Fail CLOSED: a stale origin/$BASE_REF silently yields a wrong merge-base,
# which poisons the reviewed diff scope and the coverage gate.
git fetch origin "$BASE_REF" -q || {
  echo "ERROR: could not fetch origin/$BASE_REF — refusing to compute a merge-base from stale state." >&2
  exit 2
}
if [ "$(git rev-parse "origin/$BASE_REF")" != "$BASE_SHA" ]; then
  echo "ERROR: origin/$BASE_REF no longer equals captured base $BASE_SHA." >&2
  exit 2
fi
MERGE_BASE="$(git merge-base "$BASE_SHA" "$HEAD_SHA")"

# ── Ledger: iteration + dedupe + durable budget (PR comments are the ledger) ─
#
# TRUST BOUNDARY (Codex F1, round 2): anyone who can comment on the PR can
# type the marker. adversarial-review-ledger.mjs is the single validated-record
# parser: base-owner User author + numeric comment id + strict envelope, or
# the review comment is ignored.
# Iteration derives from the MAX validated review_iteration (duplicate posts
# cannot inflate it); the budget counts DISTINCT validated records and
# survives restarts (Mike, 2026-08-17).
VIEWER="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "$VIEWER" ]; then
  echo "ERROR: could not resolve the authenticated GitHub user (gh api user)" >&2
  exit 2
fi
if [ "$VIEWER" != "$BASE_REPO_OWNER" ]; then
  echo "ERROR: authenticated GitHub user '$VIEWER' is not the base repository owner" \
       "'$BASE_REPO_OWNER'; refusing to review or mutate PR #$PR_NUMBER." >&2
  exit 3
fi
# Per-process cache ($$): two concurrent invocations sharing OUT_DIR must
# never truncate each other's ledger snapshot mid-read (found by the
# two-process race test).
COMMENTS_FILE="$OUT_DIR/comments-$PR_NUMBER-$ARTIFACT_KEY.json"
gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$COMMENTS_FILE" || {
  echo "ERROR: could not list PR comments" >&2; exit 2; }
LEDGER_JSON="$(node "$ROOT/scripts/adversarial-review-ledger.mjs" "$COMMENTS_FILE" "$VIEWER" \
    --sha "$HEAD_SHA" --body-sha256 "$PR_BODY_SHA256")" || {
  echo "ERROR: could not parse the PR comment ledger" >&2; exit 2; }
ITERATION="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).next_iteration)))')"
ALREADY="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).already)))')"
PRIOR_STATUS="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).prior_status))')"
CONSUMED="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).consumed)))')"
if [ -z "${PRIOR_STATUS:-}" ] || [ -z "${ITERATION:-}" ] || [ -z "${CONSUMED:-}" ]; then
  echo "ERROR: could not parse the PR comment ledger" >&2
  exit 2
fi

# A GREEN — fresh OR deduplicated — is authoritative only if the reviewed
# head/body snapshot is STILL current at exit (Codex round 3 F1: the dedupe
# early-exit used to skip this, silently re-approving a changed PR).
final_green_gate() {
  local cur_json cur cur_body_sha
  cur_json="$(gh pr view "$PR_NUMBER" --json headRefOid,body 2>/dev/null || echo "")"
  if [ -z "$cur_json" ]; then
    echo "WARNING: could not re-verify the PR head/body — treating the GREEN as stale." >&2
    exit 4
  fi
  read -r cur cur_body_sha < <(printf '%s' "$cur_json" | node -e '
    const crypto=require("node:crypto");
    let d="";
    process.stdin.on("data",c=>d+=c).on("end",()=>{
      const pr=JSON.parse(d);
      const body=pr.body ?? "";
      const digest=crypto.createHash("sha256").update(body,"utf8").digest("hex");
      process.stdout.write(pr.headRefOid + " " + digest + "\n");
    });')
  if [ "$cur" != "$HEAD_SHA" ]; then
    echo "STALE: PR head advanced to ${cur:0:12} — this GREEN applies only to the reviewed ${HEAD_SHA:0:12}." >&2
    exit 4
  fi
  if [ "$cur_body_sha" != "$PR_BODY_SHA256" ]; then
    echo "STALE: PR body changed during review; GREEN is not authoritative." >&2
    exit 4
  fi
  # A new comment does not trigger pull_request_target. Dispatch the workflow
  # freshly from the current trusted base branch; never rerun historical event
  # context whose base policy may be stale. Best effort: dispatch failure does
  # not alter the exact-snapshot review verdict.
  if [ "$DRY_RUN" -eq 0 ]; then
    gh workflow run ui-lifecycle-guard.yml --ref "$BASE_REF" \
      -f "pr_number=$PR_NUMBER" >/dev/null 2>&1 \
      && echo "Dispatched current-base Lifecycle Guard for PR #$PR_NUMBER." \
      || echo "NOTE: could not dispatch the current-base Lifecycle Guard; its status remains blocked, but the review verdict remains GREEN." >&2
  fi
  exit 0
}

if [ "$ALREADY" = "1" ] && [ "$FORCE" -eq 0 ]; then
  echo "Already reviewed at $HEAD_SHA (prior status: $PRIOR_STATUS). Use --force to re-review."
  case "$PRIOR_STATUS" in
    GREEN)
      publish_result deduplicated GREEN "$HEAD_SHA" "$PR_BODY_SHA256" "" "" "" "" || exit 2
      final_green_gate ;;
    ISSUES_FOUND)
      publish_result deduplicated ISSUES_FOUND "$HEAD_SHA" "$PR_BODY_SHA256" "" "" "" "" || exit 2
      exit 1 ;;
    *) echo "Prior review at this SHA is malformed — re-reviewing is required (--force)." >&2; exit 2 ;;
  esac
fi

# ── Durable review budget — advisory precheck (authoritative check is AFTER
# the reservation posts; this only avoids wasting a reservation comment) ─────
HUMAN_AUTHORIZED=0
if [ "$CONSUMED" -ge "$MAX_TOTAL_ROUNDS" ]; then
  if [ "${ADV_REVIEW_HUMAN_AUTHORIZED:-0}" = "1" ]; then
    HUMAN_AUTHORIZED=1
    echo "Post-cap review authorized by a human (ADV_REVIEW_HUMAN_AUTHORIZED=1):" \
         "$CONSUMED validated rounds already recorded on PR #$PR_NUMBER."
  else
    echo "ERROR: the durable review budget for PR #$PR_NUMBER is exhausted" \
         "($CONSUMED validated rounds >= $MAX_TOTAL_ROUNDS, counted from the PR ledger)." >&2
    echo "       A restarted script does NOT reset this budget. Post-cap review requires an" >&2
    echo "       explicit human authorization: ADV_REVIEW_HUMAN_AUTHORIZED=1 (review-only)." >&2
    exit 3
  fi
fi

# ── Atomic round reservation (Codex iteration-4 F1, 2026-08-17) ──────────────
# Check-then-act on the ledger is racy: two invocations can both observe a
# free slot. The fix is post-FIRST, then decide: publish a reservation with a
# unique 128-bit run_id, re-read the COMPLETE ledger, and proceed only if this
# run's reservation is CANONICAL (earliest valid reservation for its exact
# head/body review epoch by immutable numeric comment id) AND within the
# durable ordered budget prefix. Every same-epoch loser exits fail-closed
# BEFORE Codex runs; a crashed winner conservatively keeps its slot consumed.
# Mode is review_only
# unless the full loop set
# ADV_REVIEW_MODE=full (only full-mode canonical reservations consume
# autonomous slots — review records remain the conservative floor).
RUN_ID=""
RESERVATION_ID=""
if [ "$DRY_RUN" -eq 0 ]; then
  RUN_ID="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  HA_FLAG=false
  if [ "$HUMAN_AUTHORIZED" -eq 1 ]; then HA_FLAG=true; fi
  # The artifact key keeps concurrent reservation bodies invocation-unique.
  RES_FILE="$OUT_DIR/reservation-body-$PR_NUMBER-$ARTIFACT_KEY.md"
  {
    printf '%s\n\n' "$RESERVATION_MARKER"
    printf '```\n'
    printf 'run_id: %s\n' "$RUN_ID"
    printf 'head_sha: %s\n' "$HEAD_SHA"
    printf 'body_sha256: %s\n' "$PR_BODY_SHA256"
    printf 'mode: %s\n' "$MODE"
    printf 'human_authorized: %s\n' "$HA_FLAG"
    printf 'requested_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '```\n'
  } > "$RES_FILE"
  RESERVATION_ID="$(gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" \
      -F body=@"$RES_FILE" --jq .id)" || {
    echo "ERROR: could not post the round reservation — refusing to review without one." >&2
    exit 2
  }
  if ! [[ "$RESERVATION_ID" =~ ^[0-9]+$ ]]; then
    echo "ERROR: reservation post returned no numeric comment id — cannot prove ownership." >&2
    exit 2
  fi

  # Re-read the COMPLETE ledger and prove ownership. Any failure here is a
  # stop — never continue optimistically on an unprovable reservation.
  gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$COMMENTS_FILE" || {
    echo "ERROR: could not re-list PR comments after reserving — cannot prove ownership." >&2
    exit 2
  }
  ACQ_JSON="$(node "$ROOT/scripts/adversarial-review-ledger.mjs" "$COMMENTS_FILE" "$VIEWER" \
      --sha "$HEAD_SHA" --body-sha256 "$PR_BODY_SHA256" --run-id "$RUN_ID")" || {
    echo "ERROR: could not parse the ledger after reserving — cannot prove ownership." >&2
    exit 2
  }
  # The single-quoted JS below intentionally contains JS template literals.
  # shellcheck disable=SC2016
  read -r MINE_FOUND MINE_ID CANONICAL CANONICAL_RUN_ID CONSUMED_BEFORE < <(printf '%s' "$ACQ_JSON" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);
      process.stdout.write(`${j.mine_found} ${j.mine_comment_id} ${j.mine_is_canonical_for_its_snapshot} ${j.canonical_run_id_for_snapshot} ${j.consumed_before_mine}\n`);
    });')
  if [ "${MINE_FOUND:-0}" != "1" ] || [ "$MINE_ID" != "$RESERVATION_ID" ]; then
    echo "ERROR: this run's reservation ($RUN_ID) is not the earliest comment carrying its" >&2
    echo "       run_id — duplicated or forged; failing closed without reviewing." >&2
    exit 3
  fi
  if [ "${CANONICAL:-0}" != "1" ]; then
    echo "LOST RESERVATION RACE: an earlier reservation owns snapshot ${HEAD_SHA:0:12}/$PR_BODY_SHA256 on PR #$PR_NUMBER." >&2
    echo "Exiting fail-closed without reviewing (run_id $RUN_ID, comment $RESERVATION_ID)." >&2
    exit 3
  fi
  if [ "$CANONICAL_RUN_ID" != "$RUN_ID" ]; then
    echo "ERROR: canonical reservation identity changed before acquisition completed; failing closed." >&2
    exit 3
  fi
  if [ "$MODE" = "full" ] && [ "${CONSUMED_BEFORE:-$MAX_TOTAL_ROUNDS}" -ge "$MAX_TOTAL_ROUNDS" ]; then
    echo "ERROR: durable budget exhausted at acquisition ($CONSUMED_BEFORE consumed" >&2
    echo "       review/reservation slots ahead of this one >= $MAX_TOTAL_ROUNDS). Failing closed." >&2
    exit 3
  fi
  echo "Round reserved: run_id $RUN_ID (comment $RESERVATION_ID, mode $MODE)."
fi

# Prior-round context: pass the last review's finding ids so Codex can confirm
# fixes and avoid re-litigating documented FALSE_POSITIVEs. Written to a REAL
# file — node is a native Windows binary and cannot read MSYS /dev/fd paths,
# so bash process substitution must never be passed to it as a filename.
PRIOR_FILE="$OUT_DIR/prior-$PR_NUMBER-$ARTIFACT_KEY.md"
node -e '
  const fs=require("fs");
  const [commentsFile,marker,outFile,viewer]=process.argv.slice(1);
  const raw=fs.readFileSync(commentsFile,"utf8");
  const arr=JSON.parse("["+raw.replace(/\]\s*\[/g,",").replace(/^\s*\[|\]\s*$/g,"")+"]");
  // Same trust gate as the dedupe: only numeric, owner-authored User review
  // comments feed the next prompt.
  const reviews=arr.filter(c=>typeof c.body==="string"
    && c.body.startsWith(marker)
    && Number.isInteger(c.id)
    && c.user && c.user.login===viewer && c.user.type==="User");
  const text=reviews.length
    ? "A previous round exists. Verify its findings were actually fixed at the new SHA; do not re-raise its FALSE_POSITIVE entries without new evidence. Previous review (may be truncated):\n\n"+reviews[reviews.length-1].body.slice(0,6000)
    : "This is the first review of this PR.";
  fs.writeFileSync(outFile,text);
' "$COMMENTS_FILE" "$MARKER" "$PRIOR_FILE" "$VIEWER"

# ── Build the prompt ─────────────────────────────────────────────────────────
PROMPT_FILE="$OUT_DIR/prompt-$PR_NUMBER-$ARTIFACT_KEY.md"
node -e '
  const fs=require("fs");
  const [tpl,out,pr,title,base,mb,sha,iter,priorFile,prBodyFile]=process.argv.slice(1);
  const prior=fs.readFileSync(priorFile,"utf8");
  let s=fs.readFileSync(tpl,"utf8");
  const sub={PR_NUMBER:pr,PR_TITLE:title,BASE_REF:base,MERGE_BASE:mb,HEAD_SHA:sha,ITERATION:iter,PRIOR_CONTEXT:prior,PR_BODY_FILE:prBodyFile};
  for(const [k,v] of Object.entries(sub)) s=s.split("{{"+k+"}}").join(v);
  fs.writeFileSync(out,s);
' "$ROOT/scripts/adversarial-review-prompt.md" "$PROMPT_FILE" \
  "$PR_NUMBER" "$PR_TITLE" "$BASE_REF" "$MERGE_BASE" "$HEAD_SHA" "$ITERATION" \
  "$PRIOR_FILE" "$PR_BODY_FILE"

# ── Run Codex (read-only, ephemeral, schema-constrained) ─────────────────────
ENVELOPE="$OUT_DIR/envelope-$PR_NUMBER-$ARTIFACT_KEY.json"
CODEX_LOG="$OUT_DIR/codex-$PR_NUMBER-$ARTIFACT_KEY.log"
# --ignore-user-config: auth still comes from CODEX_HOME, but the user's MCP
# servers / plugins / skills are NOT loaded — reviews run in a clean,
# reproducible agent (user-config MCP servers crashed live runs, 2026-08-16).
CODEX_ARGS=(exec --ephemeral --ignore-user-config -s read-only -C "$ROOT"
  --output-schema "$ROOT/scripts/adversarial-review-schema.json"
  --output-last-message "$ENVELOPE" --color never)
if [ -n "${CODEX_MODEL:-}" ]; then CODEX_ARGS+=(-m "$CODEX_MODEL"); fi

echo "Running Codex adversarial review of PR #$PR_NUMBER @ ${HEAD_SHA:0:12} (iteration $ITERATION)…"
set +e
"$CODEX_BIN" "${CODEX_ARGS[@]}" - < "$PROMPT_FILE" > "$CODEX_LOG" 2>&1 &
CODEX_PID=$!
(
  sleep "$CODEX_TIMEOUT_SECS"
  if kill -0 "$CODEX_PID" 2>/dev/null; then
    kill "$CODEX_PID" 2>/dev/null || true
    sleep 30
    kill -9 "$CODEX_PID" 2>/dev/null || true
  fi
) </dev/null >/dev/null 2>&1 &
WATCHDOG_PID=$!
wait "$CODEX_PID"
CODEX_RC=$?
kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true
set -e
if [ "$CODEX_RC" -ne 0 ] || [ ! -s "$ENVELOPE" ]; then
  echo "ERROR: codex failed (rc=$CODEX_RC) or produced no envelope. Log: $CODEX_LOG" >&2
  echo "A tooling failure is NOT a GREEN gate." >&2
  exit 2
fi

assert_local_snapshot "$BASE_SHA" "post-Codex trusted-base snapshot" || exit 2

# ── Validate + render (fail-safe: malformed => exit 2, never GREEN) ──────────
RENDER_ARGS=(--sha "$HEAD_SHA" --body-sha256 "$PR_BODY_SHA256" --base "$MERGE_BASE" --iteration "$ITERATION")
if [ "$HUMAN_AUTHORIZED" -eq 1 ]; then RENDER_ARGS+=(--human-authorized); fi
# Bind the review record to its reservation (evidence chain: reservation ->
# review -> disposition all carry the same run_id).
if [ -n "$RUN_ID" ]; then
  RENDER_ARGS+=(--run-id "$RUN_ID" --reservation-id "$RESERVATION_ID")
fi
if ! STATUS_LINE="$(node "$ROOT/scripts/adversarial-review-render.mjs" "$ENVELOPE" \
      "${RENDER_ARGS[@]}" --check-only)"; then
  echo "ERROR: Codex envelope is malformed. Envelope: $ENVELOPE  Log: $CODEX_LOG" >&2
  exit 2
fi

# ── Anti-premature-GREEN coverage gate ───────────────────────────────────────
# A live run produced a schema-valid GREEN whose summary was a PLAN ("I'll
# inspect…") emitted before any review happened. A GREEN is accepted only if
# files_reviewed covers EVERY changed file in the diff; otherwise it is an
# incomplete review => tooling failure, never GREEN.
CHANGED_FILE_LIST="$OUT_DIR/changed-$PR_NUMBER-$ARTIFACT_KEY.txt"
git diff --name-only "$MERGE_BASE".."$HEAD_SHA" > "$CHANGED_FILE_LIST"
if [ "${STATUS_LINE%% *}" = "GREEN" ]; then
  if ! node -e '
    const fs=require("fs");
    const env=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const reviewed=new Set((env.files_reviewed||[]).map(s=>s.replace(/\\/g,"/")));
    const changed=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean);
    const missing=changed.filter(f=>!reviewed.has(f));
    if(missing.length){
      console.error("GREEN rejected: files_reviewed does not cover: "+missing.join(", "));
      process.exit(1);
    }
  ' "$ENVELOPE" "$CHANGED_FILE_LIST"; then
    echo "ERROR: GREEN envelope failed the diff-coverage gate (incomplete review). Not posting." >&2
    exit 2
  fi
fi
BODY_FILE="$OUT_DIR/comment-$PR_NUMBER-$ARTIFACT_KEY.md"
BODY_TMP="$(mktemp "$BODY_FILE.tmp.XXXXXX")" || {
  echo "ERROR: could not create a private rendered-review temporary file" >&2
  exit 2
}
if ! node "$ROOT/scripts/adversarial-review-render.mjs" "$ENVELOPE" \
    "${RENDER_ARGS[@]}" > "$BODY_TMP"; then
  rm -f "$BODY_TMP"
  echo "ERROR: could not render the validated review artifact" >&2
  exit 2
fi
# link(2) gives publication atomic no-replace semantics. The same fd used for
# the regular-file check supplies the exact bytes whose digest is handed off.
REVIEW_ARTIFACT_SHA256="$(node -e '
  const crypto=require("node:crypto");
  const fs=require("node:fs");
  const [tmp,final]=process.argv.slice(1);
  const fd=fs.openSync(tmp,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile()) process.exit(1);
    const bytes=fs.readFileSync(fd);
    fs.linkSync(tmp,final);
    fs.unlinkSync(tmp);
    process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));
  } finally { fs.closeSync(fd); }
' "$BODY_TMP" "$BODY_FILE")" || {
  rm -f "$BODY_TMP"
  echo "ERROR: could not publish the rendered review artifact without replacement" >&2
  exit 2
}

STATUS="${STATUS_LINE%% *}"
assert_local_snapshot "$BASE_SHA" "pre-publication trusted-base snapshot" || exit 2
publish_result fresh_review "$STATUS" "$HEAD_SHA" "$PR_BODY_SHA256" "$RUN_ID" \
  "$RESERVATION_ID" "$BODY_FILE" "$REVIEW_ARTIFACT_SHA256" || exit 2
echo "Review result: $STATUS_LINE"

# ── Post to the PR ───────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  echo "--dry-run: not posting. Rendered comment at $BODY_FILE"
else
  assert_local_snapshot "$BASE_SHA" "immediate pre-post trusted-base snapshot" || exit 2
  gh pr comment "$PR_NUMBER" --body-file "$BODY_FILE" >/dev/null || {
    echo "ERROR: failed to post the review comment (review preserved at $BODY_FILE)" >&2; exit 2; }
  echo "Posted review to PR #$PR_NUMBER."
fi

if [ "$STATUS" != "GREEN" ]; then
  exit 1
fi
# Rounds 1+3: fresh and deduplicated GREENs share ONE final head verification.
final_green_gate
