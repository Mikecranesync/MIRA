#!/usr/bin/env bash
# adversarial-review.sh — one Codex adversarial review round, persisted to the PR.
#
#   scripts/adversarial-review.sh [PR_NUMBER] [--force] [--dry-run] [--allow-dirty]
#
# Flow: resolve PR -> verify local HEAD == PR head (never review unpushed or
# stale state) -> dedupe by reviewed SHA against existing PR comments -> run
# `codex exec` (read-only sandbox, JSON output schema) -> validate + render ->
# `gh pr comment`. See docs/adversarial-review-workflow.md.
#
# Exit codes:
#   0  GREEN (or already reviewed GREEN at this SHA) — re-verified against the
#      CURRENT PR head at exit; a GREEN is authoritative only for a head that
#      is still the reviewed SHA
#   1  ISSUES_FOUND (review posted)
#   2  tooling failure (codex/gh/parse) — NEVER interpreted as GREEN
#   3  precondition failure (no PR, dirty tree, HEAD mismatch)
#   4  stale GREEN — the review is GREEN for the reviewed SHA, but the PR head
#      advanced while Codex ran; the new head is unreviewed
#
# Env overrides: CODEX_BIN, CODEX_TIMEOUT_SECS (default 2400), CODEX_MODEL,
# ADV_REVIEW_OUT_DIR (default .adversarial-review/, gitignored).

set -euo pipefail

MARKER='[CODEX-ADVERSARIAL-REVIEW]'
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_TIMEOUT_SECS="${CODEX_TIMEOUT_SECS:-2400}"

FORCE=0
DRY_RUN=0
ALLOW_DIRTY=0
PR_NUMBER=""
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) PR_NUMBER="$a" ;;
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
if [ "$ALLOW_DIRTY" -eq 0 ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: working tree has uncommitted tracked changes — the review would not match $HEAD_SHA." >&2
  echo "       Commit/push first, or pass --allow-dirty if you accept the contamination." >&2
  exit 3
fi

git fetch origin "$BASE_REF" -q || true
MERGE_BASE="$(git merge-base "origin/$BASE_REF" HEAD)"

# ── Dedupe + iteration number (stateless — PR comments are the ledger) ──────
#
# TRUST BOUNDARY (Codex F1, round 2): anyone who can comment on the PR can
# type the marker. A ledger entry counts ONLY if (a) it was authored by the
# SAME GitHub account this runner posts as, and (b) the metadata block parses
# strictly (marker line, fenced block, exact `reviewed_sha:`/`status:` lines).
# Forged or malformed comments are ignored — they can never mint a GREEN.
VIEWER="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "$VIEWER" ]; then
  echo "ERROR: could not resolve the authenticated GitHub user (gh api user)" >&2
  exit 2
fi
COMMENTS_FILE="$OUT_DIR/comments-$PR_NUMBER.json"
gh api "repos/{owner}/{repo}/issues/$PR_NUMBER/comments" --paginate > "$COMMENTS_FILE" || {
  echo "ERROR: could not list PR comments" >&2; exit 2; }
# The single-quoted JS below intentionally contains a JS template literal.
# shellcheck disable=SC2016
read -r ITERATION ALREADY PRIOR_STATUS < <(node -e '
  const fs=require("fs");
  const raw=fs.readFileSync(process.argv[1],"utf8");
  // --paginate can emit concatenated arrays: "][", normalize.
  const arr=JSON.parse("["+raw.replace(/\]\s*\[/g,",").replace(/^\s*\[|\]\s*$/g,"")+"]");
  const marker=process.argv[2], sha=process.argv[3], viewer=process.argv[4];
  // Strict envelope: marker line, blank line, fenced block whose first lines
  // are exact reviewed_sha/status fields. startsWith+includes is forgeable
  // by ANY commenter; this shape plus the author check is the trust gate.
  const HEAD_RE=/^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\n/;
  const reviews=arr.filter(c=>typeof c.body==="string"
    && c.body.startsWith(marker)
    && c.user && c.user.login===viewer);
  const parsed=reviews.map(c=>{const m=c.body.match(HEAD_RE);return m?{sha:m[1],status:m[2]}:null;});
  const atSha=parsed.filter(p=>p&&p.sha===sha);
  let prior="NONE";
  if(atSha.length) prior=atSha[atSha.length-1].status;
  else if(reviews.length&&parsed.some((p,i)=>p===null&&reviews[i].body.includes("reviewed_sha: "+sha))) prior="MALFORMED";
  process.stdout.write(`${reviews.length+1} ${atSha.length?1:0} ${prior}\n`);
' "$COMMENTS_FILE" "$MARKER" "$HEAD_SHA" "$VIEWER")
if [ -z "${PRIOR_STATUS:-}" ]; then
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
if ! STATUS_LINE="$(node "$ROOT/scripts/adversarial-review-render.mjs" "$ENVELOPE" \
      --sha "$HEAD_SHA" --base "$MERGE_BASE" --iteration "$ITERATION" --check-only)"; then
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
  --sha "$HEAD_SHA" --base "$MERGE_BASE" --iteration "$ITERATION" > "$BODY_FILE"

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
