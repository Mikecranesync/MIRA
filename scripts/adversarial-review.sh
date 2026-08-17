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
#      CURRENT PR head at exit; a GREEN is authoritative only for a head that
#      is still the reviewed SHA
#   1  ISSUES_FOUND (review posted)
#   2  tooling failure (codex/gh/parse) — NEVER interpreted as GREEN
#   3  precondition failure (no PR, dirty tree, HEAD mismatch, bad arguments,
#      or the durable review budget is exhausted without human authorization)
#   4  stale GREEN — the review is GREEN for the reviewed SHA, but the PR head
#      advanced while Codex ran; the new head is unreviewed
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
# ADV_REVIEW_HUMAN_AUTHORIZED (post-cap override, human-set only).

set -euo pipefail

MARKER='[CODEX-ADVERSARIAL-REVIEW]'
RESERVATION_MARKER='[ADVERSARIAL-ROUND-RESERVATION]'
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_TIMEOUT_SECS="${CODEX_TIMEOUT_SECS:-2400}"
MAX_TOTAL_ROUNDS=3

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
OUT_DIR="${ADV_REVIEW_OUT_DIR:-$ROOT/.adversarial-review}"
mkdir -p "$OUT_DIR"

# ── Preconditions ────────────────────────────────────────────────────────────
if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi
if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: no PR found for the current branch and none given. Create the PR first." >&2
  exit 3
fi

PR_JSON="$(gh pr view "$PR_NUMBER" --json number,title,baseRefName,headRefOid,headRefName)" || {
  echo "ERROR: gh could not read PR #$PR_NUMBER" >&2; exit 2; }
PR_TITLE="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).title))')"
BASE_REF="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).baseRefName))')"
HEAD_SHA="$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).headRefOid))')"

LOCAL_SHA="$(git rev-parse HEAD)"
if [ "$LOCAL_SHA" != "$HEAD_SHA" ]; then
  echo "ERROR: local HEAD ($LOCAL_SHA) != PR head ($HEAD_SHA)." >&2
  echo "       Push your work (or pull the PR head) so the reviewed tree matches GitHub." >&2
  exit 3
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: working tree has uncommitted tracked changes — the review would not match $HEAD_SHA." >&2
  echo "       Commit/push first. (--allow-dirty was removed: an exact-SHA review of a dirty tree is a lie.)" >&2
  exit 3
fi

# Fail CLOSED: a stale origin/$BASE_REF silently yields a wrong merge-base,
# which poisons the reviewed diff scope and the coverage gate.
git fetch origin "$BASE_REF" -q || {
  echo "ERROR: could not fetch origin/$BASE_REF — refusing to compute a merge-base from stale state." >&2
  exit 2
}
MERGE_BASE="$(git merge-base "origin/$BASE_REF" HEAD)"

# ── Ledger: iteration + dedupe + durable budget (PR comments are the ledger) ─
#
# TRUST BOUNDARY (Codex F1, round 2): anyone who can comment on the PR can
# type the marker. adversarial-review-ledger.mjs is the single validated-record
# parser: same-account author + strict envelope, or the comment is ignored.
# Iteration derives from the MAX validated review_iteration (duplicate posts
# cannot inflate it); the budget counts DISTINCT validated records and
# survives restarts (Mike, 2026-08-17).
VIEWER="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "$VIEWER" ]; then
  echo "ERROR: could not resolve the authenticated GitHub user (gh api user)" >&2
  exit 2
fi
# Per-process cache ($$): two concurrent invocations sharing OUT_DIR must
# never truncate each other's ledger snapshot mid-read (found by the
# two-process race test).
COMMENTS_FILE="$OUT_DIR/comments-$PR_NUMBER-$$.json"
gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$COMMENTS_FILE" || {
  echo "ERROR: could not list PR comments" >&2; exit 2; }
LEDGER_JSON="$(node "$ROOT/scripts/adversarial-review-ledger.mjs" "$COMMENTS_FILE" "$VIEWER" --sha "$HEAD_SHA")" || {
  echo "ERROR: could not parse the PR comment ledger" >&2; exit 2; }
ITERATION="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).next_iteration)))')"
ALREADY="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).already)))')"
PRIOR_STATUS="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).prior_status))')"
CONSUMED="$(printf '%s' "$LEDGER_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).consumed)))')"
if [ -z "${PRIOR_STATUS:-}" ] || [ -z "${ITERATION:-}" ] || [ -z "${CONSUMED:-}" ]; then
  echo "ERROR: could not parse the PR comment ledger" >&2
  exit 2
fi

# A GREEN — fresh OR deduplicated — is authoritative only if the reviewed SHA
# is STILL the PR head at exit (Codex round 3 F1: the dedupe early-exit used
# to skip this, silently re-approving a head that advanced mid-run).
final_green_gate() {
  local cur
  cur="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid 2>/dev/null || echo "")"
  if [ -z "$cur" ]; then
    echo "WARNING: could not re-verify the PR head — treating the GREEN as stale." >&2
    exit 4
  fi
  if [ "$cur" != "$HEAD_SHA" ]; then
    echo "STALE: PR head advanced to ${cur:0:12} — this GREEN applies only to the reviewed ${HEAD_SHA:0:12}." >&2
    exit 4
  fi
  exit 0
}

if [ "$ALREADY" = "1" ] && [ "$FORCE" -eq 0 ]; then
  echo "Already reviewed at $HEAD_SHA (prior status: $PRIOR_STATUS). Use --force to re-review."
  case "$PRIOR_STATUS" in
    GREEN) final_green_gate ;;
    ISSUES_FOUND) exit 1 ;;
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
# run's reservation is CANONICAL (earliest valid reservation for this head by
# immutable numeric comment id) AND within the durable budget. Every loser
# exits fail-closed BEFORE Codex runs; a crashed winner conservatively keeps
# its slot consumed. Mode is review_only unless the full loop set
# ADV_REVIEW_MODE=full (only full-mode canonical reservations consume
# autonomous slots — review records remain the conservative floor).
RUN_ID=""
RESERVATION_ID=""
MODE="${ADV_REVIEW_MODE:-review_only}"
if [ "$MODE" != "full" ] && [ "$MODE" != "review_only" ]; then
  echo "ERROR: ADV_REVIEW_MODE must be 'full' or 'review_only' (got: '$MODE')." >&2
  exit 3
fi
if [ "$DRY_RUN" -eq 0 ]; then
  RUN_ID="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  HA_FLAG=false
  if [ "$HUMAN_AUTHORIZED" -eq 1 ]; then HA_FLAG=true; fi
  # Per-process ($$): two invocations racing the same head must never share a
  # body file, or one's run_id silently replaces the other's before posting
  # (found by the two-process race test).
  RES_FILE="$OUT_DIR/reservation-body-$PR_NUMBER-$HEAD_SHA-$$.md"
  {
    printf '%s\n\n' "$RESERVATION_MARKER"
    printf '```\n'
    printf 'run_id: %s\n' "$RUN_ID"
    printf 'head_sha: %s\n' "$HEAD_SHA"
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
      --sha "$HEAD_SHA" --run-id "$RUN_ID")" || {
    echo "ERROR: could not parse the ledger after reserving — cannot prove ownership." >&2
    exit 2
  }
  # The single-quoted JS below intentionally contains JS template literals.
  # shellcheck disable=SC2016
  read -r MINE_FOUND MINE_ID CANONICAL FULL_BEFORE < <(printf '%s' "$ACQ_JSON" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);
      process.stdout.write(`${j.mine_found} ${j.mine_comment_id} ${j.mine_is_canonical_for_its_sha} ${j.canonical_full_before_mine}\n`);
    });')
  if [ "${MINE_FOUND:-0}" != "1" ] || [ "$MINE_ID" != "$RESERVATION_ID" ]; then
    echo "ERROR: this run's reservation ($RUN_ID) is not the earliest comment carrying its" >&2
    echo "       run_id — duplicated or forged; failing closed without reviewing." >&2
    exit 3
  fi
  if [ "${CANONICAL:-0}" != "1" ]; then
    echo "LOST RESERVATION RACE: an earlier reservation owns head ${HEAD_SHA:0:12} on PR #$PR_NUMBER." >&2
    echo "Exiting fail-closed without reviewing (run_id $RUN_ID, comment $RESERVATION_ID)." >&2
    exit 3
  fi
  if [ "$MODE" = "full" ] && [ "${FULL_BEFORE:-$MAX_TOTAL_ROUNDS}" -ge "$MAX_TOTAL_ROUNDS" ]; then
    echo "ERROR: durable budget exhausted at acquisition ($FULL_BEFORE canonical full" >&2
    echo "       reservations ahead of this one >= $MAX_TOTAL_ROUNDS). Failing closed." >&2
    exit 3
  fi
  # Trusted local artifact binding this round to its reservation — the loop's
  # pre-privileged recheck consumes THIS, never PR-comment content.
  printf '{"run_id":"%s","reservation_comment_id":%s,"mode":"%s","head_sha":"%s"}\n' \
    "$RUN_ID" "$RESERVATION_ID" "$MODE" "$HEAD_SHA" \
    > "$OUT_DIR/reservation-$PR_NUMBER-$HEAD_SHA.json"
  echo "Round reserved: run_id $RUN_ID (comment $RESERVATION_ID, mode $MODE)."
fi

# Prior-round context: pass the last review's finding ids so Codex can confirm
# fixes and avoid re-litigating documented FALSE_POSITIVEs. Written to a REAL
# file — node is a native Windows binary and cannot read MSYS /dev/fd paths,
# so bash process substitution must never be passed to it as a filename.
PRIOR_FILE="$OUT_DIR/prior-$PR_NUMBER-$HEAD_SHA.md"
node -e '
  const fs=require("fs");
  const [commentsFile,marker,outFile,viewer]=process.argv.slice(1);
  const raw=fs.readFileSync(commentsFile,"utf8");
  const arr=JSON.parse("["+raw.replace(/\]\s*\[/g,",").replace(/^\s*\[|\]\s*$/g,"")+"]");
  // Same trust gate as the dedupe: only OUR OWN prior reviews feed the next
  // prompt — a third-party comment must never become reviewer instructions.
  const reviews=arr.filter(c=>typeof c.body==="string"
    && c.body.startsWith(marker)
    && c.user && c.user.login===viewer);
  const text=reviews.length
    ? "A previous round exists. Verify its findings were actually fixed at the new SHA; do not re-raise its FALSE_POSITIVE entries without new evidence. Previous review (may be truncated):\n\n"+reviews[reviews.length-1].body.slice(0,6000)
    : "This is the first review of this PR.";
  fs.writeFileSync(outFile,text);
' "$COMMENTS_FILE" "$MARKER" "$PRIOR_FILE" "$VIEWER"

# ── Build the prompt ─────────────────────────────────────────────────────────
PROMPT_FILE="$OUT_DIR/prompt-$PR_NUMBER-$HEAD_SHA.md"
node -e '
  const fs=require("fs");
  const [tpl,out,pr,title,base,mb,sha,iter,priorFile]=process.argv.slice(1);
  const prior=fs.readFileSync(priorFile,"utf8");
  let s=fs.readFileSync(tpl,"utf8");
  const sub={PR_NUMBER:pr,PR_TITLE:title,BASE_REF:base,MERGE_BASE:mb,HEAD_SHA:sha,ITERATION:iter,PRIOR_CONTEXT:prior};
  for(const [k,v] of Object.entries(sub)) s=s.split("{{"+k+"}}").join(v);
  fs.writeFileSync(out,s);
' "$ROOT/scripts/adversarial-review-prompt.md" "$PROMPT_FILE" \
  "$PR_NUMBER" "$PR_TITLE" "$BASE_REF" "$MERGE_BASE" "$HEAD_SHA" "$ITERATION" \
  "$PRIOR_FILE"

# ── Run Codex (read-only, ephemeral, schema-constrained) ─────────────────────
ENVELOPE="$OUT_DIR/envelope-$PR_NUMBER-$HEAD_SHA.json"
CODEX_LOG="$OUT_DIR/codex-$PR_NUMBER-$HEAD_SHA.log"
# --ignore-user-config: auth still comes from CODEX_HOME, but the user's MCP
# servers / plugins / skills are NOT loaded — reviews run in a clean,
# reproducible agent (user-config MCP servers crashed live runs, 2026-08-16).
CODEX_ARGS=(exec --ephemeral --ignore-user-config -s read-only -C "$ROOT"
  --output-schema "$ROOT/scripts/adversarial-review-schema.json"
  --output-last-message "$ENVELOPE" --color never)
if [ -n "${CODEX_MODEL:-}" ]; then CODEX_ARGS+=(-m "$CODEX_MODEL"); fi

echo "Running Codex adversarial review of PR #$PR_NUMBER @ ${HEAD_SHA:0:12} (iteration $ITERATION)…"
set +e
if command -v timeout >/dev/null 2>&1; then
  timeout -k 30 "$CODEX_TIMEOUT_SECS" "$CODEX_BIN" "${CODEX_ARGS[@]}" - < "$PROMPT_FILE" > "$CODEX_LOG" 2>&1
else
  "$CODEX_BIN" "${CODEX_ARGS[@]}" - < "$PROMPT_FILE" > "$CODEX_LOG" 2>&1
fi
CODEX_RC=$?
set -e
if [ "$CODEX_RC" -ne 0 ] || [ ! -s "$ENVELOPE" ]; then
  echo "ERROR: codex failed (rc=$CODEX_RC) or produced no envelope. Log: $CODEX_LOG" >&2
  echo "A tooling failure is NOT a GREEN gate." >&2
  exit 2
fi

# ── Validate + render (fail-safe: malformed => exit 2, never GREEN) ──────────
RENDER_ARGS=(--sha "$HEAD_SHA" --base "$MERGE_BASE" --iteration "$ITERATION")
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
if [ "${STATUS_LINE%% *}" = "GREEN" ]; then
  CHANGED_FILE_LIST="$OUT_DIR/changed-$PR_NUMBER-$HEAD_SHA.txt"
  git diff --name-only "$MERGE_BASE"..HEAD > "$CHANGED_FILE_LIST"
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
BODY_FILE="$OUT_DIR/comment-$PR_NUMBER-$HEAD_SHA.md"
node "$ROOT/scripts/adversarial-review-render.mjs" "$ENVELOPE" \
  "${RENDER_ARGS[@]}" > "$BODY_FILE"

STATUS="${STATUS_LINE%% *}"
echo "Review result: $STATUS_LINE"

# ── Post to the PR ───────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  echo "--dry-run: not posting. Rendered comment at $BODY_FILE"
else
  gh pr comment "$PR_NUMBER" --body-file "$BODY_FILE" >/dev/null || {
    echo "ERROR: failed to post the review comment (review preserved at $BODY_FILE)" >&2; exit 2; }
  echo "Posted review to PR #$PR_NUMBER."
fi

if [ "$STATUS" != "GREEN" ]; then
  exit 1
fi
# Rounds 1+3: fresh and deduplicated GREENs share ONE final head verification.
final_green_gate
