# Claude ↔ Codex Adversarial Review Workflow

Automates the manual loop where Claude Code implements, Codex adversarially
reviews, findings are persisted to the GitHub PR, Claude validates + fixes,
and the cycle repeats until GREEN or a human decision is required. The human
is removed from the copy/paste relay — not from the decisions that matter.

## Purpose — why two agents with separate roles

- **Claude Code** is the implementer and remediation agent. It designs, edits,
  tests, commits, pushes, and evaluates review findings. It must not blindly
  obey the reviewer.
- **Codex** is the independent adversarial reviewer: different vendor,
  different model, fresh context, briefed to *disprove* the change, running in
  a **read-only sandbox**.
- **The GitHub PR** is the durable mailbox and audit trail. Every review and
  every disposition is a PR comment; nothing load-bearing lives only in a
  terminal scrollback.
- **Neither model is the authority. Evidence is the authority** — runtime
  behavior > tests > documented contracts > repo architecture > source >
  reproduction > either model's opinion.

Relationship to existing lanes: `tools/gate7_review.py` (convergence Gate 7)
is the CI-side adversarial lane on the free Groq→Cerebras→Together cascade
(owner decision: no OpenAI credentials in the repo/CI). This workflow is the
**developer-side** lane driving the locally-authenticated Codex CLI (ChatGPT
auth on the dev machine) — it complements Gate 7, it does not replace it, and
it adds no OpenAI secrets to the repository.

## Architecture

```
Claude implements -> tests/lint -> commit + push
        |
        v
scripts/adversarial-review.sh          (one round)
   resolve PR -> HEAD==PR-head gate -> exact-snapshot dedupe
        (head SHA + PR-body SHA-256) -> ordered reservation acquisition
        -> codex exec (read-only, --output-schema) -> validate/render
        -> atomic invocation-token result handoff
        -> gh pr comment  [CODEX-ADVERSARIAL-REVIEW]
        |
        v
scripts/adversarial-review-loop.sh     (the loop, max 3 cycles)
   ISSUES_FOUND -> claude -p (headless, remediation contract)
        -> classify each finding ACCEPTED/PARTIALLY_ACCEPTED/
           FALSE_POSITIVE/NEEDS_HUMAN_DECISION
        -> fix + regression tests + verify -> commit + push
        -> gh pr comment  [CLAUDE-REMEDIATION]
   new exact snapshot -> next review round
        |
        v
GREEN  |  [ADVERSARIAL-ESCALATION] after 3 cycles / no progress
```

## Running it

From the repo root (Git Bash on Windows; plain bash elsewhere):

```bash
# Full autonomous loop on the current branch's PR (max 3 cycles):
bash scripts/adversarial-review-loop.sh

# Same, for an explicit PR:
bash scripts/adversarial-review-loop.sh 3245

# One review round only — post the verdict, no remediation:
bash scripts/adversarial-review-loop.sh --review-only
# (or directly: bash scripts/adversarial-review.sh [PR] [--force] [--dry-run])

# Post-cap verification pass (requires EXPLICIT human authorization — see
# "Durable review budget" below). Review-only by construction:
ADV_REVIEW_HUMAN_AUTHORIZED=1 bash scripts/adversarial-review.sh <PR>
```

PR arguments are validated strictly (numeric PR ids only); unknown flags fail
closed. `--allow-dirty` was **removed** (2026-08-17): an "exact-SHA" review of
a tree carrying uncommitted tracked drift is a lie, so a dirty tracked tree is
always a precondition failure. A failed fetch of the base branch is a tooling
failure (exit 2) — a stale merge-base silently poisons the reviewed diff scope,
so it fails closed rather than proceeding.

From a Claude Code session: `/adversarial-gate [PR] [--review-only]`.

Preconditions (all fail closed): an open PR for the branch; local HEAD equals
the PR head (push first); clean tracked working tree; `gh auth status` OK;
`codex` authenticated (`codex doctor`).

## Review format (machine-readable envelope)

Codex's final response is schema-constrained JSON
(`scripts/adversarial-review-schema.json`): `status` GREEN|ISSUES_FOUND,
`summary`, `files_reviewed[]`, and `findings[]` each carrying `id, severity,
title, file, line, symbol, confidence, failure_scenario, evidence,
remediation, test_to_prove`.

**Anti-premature-GREEN coverage gate:** a live run once emitted a schema-valid
GREEN whose summary was a *plan*, before any review happened. The runner
therefore accepts a GREEN only when `files_reviewed` covers every file in the
PR diff; an uncovered GREEN is treated as an incomplete review (exit 2, not
posted, never GREEN). Codex also runs with `--ignore-user-config` (ChatGPT
auth is preserved; the user's MCP servers/plugins are not loaded — they
crashed live runs) — so the reviewer is a clean, reproducible agent.
Severities: `BLOCKER | HIGH | MEDIUM | LOW | FALSE_POSITIVE` (the last =
"considered and dismissed", recorded so it is not re-raised). Confidence:
`observed | supported | speculative`.

The PR comment always starts with the marker line `[CODEX-ADVERSARIAL-REVIEW]`
followed by a fenced block:

```
reviewed_sha: <full SHA>
reviewed_body_sha256: <SHA-256 of the exact PR body>
base_sha: <merge-base SHA>
status: ISSUES_FOUND | GREEN
review_iteration: <n>

BLOCKER: n / HIGH: n / MEDIUM: n / LOW: n / FALSE_POSITIVE: n
```

A GREEN review additionally contains the literal block
`ADVERSARIAL GATE: GREEN` + `reviewed_sha: <SHA>`.

**The GREEN is also the Legacy UI lifecycle attestation.** The
`Legacy UI Lifecycle Guard` (`tools/ui_surface_lifecycle_guard.py`) reads this
ledger from the PR's comments. For any guarded change, the sole authorization
route is a substantive `## Lifecycle guard rationale` plus the newest
well-formed owner-account User envelope whose `reviewed_sha` matches the
current head, whose `reviewed_body_sha256` matches SHA-256 of the current PR
body, and whose `status: GREEN`. Any push or body edit requires a fresh review.
There is no label or manual bypass.

The review prompt makes any introduction or expansion of frozen legacy
presentation a BLOCKER that can never produce GREEN. A guard/control-plane
change is not automatically a BLOCKER: the reviewer may return GREEN only
when fail-closed behavior, trusted-base guarantees, and the relevant tests
remain sound. Because a comment is not a `pull_request_target` event,
`final_green_gate` re-runs the latest guard run for the head after a GREEN
(best effort; `gh run rerun` by hand otherwise).

Claude's disposition comment starts with `[CLAUDE-REMEDIATION]` and lists one
line per finding id with its classification. Escalations start with
`[ADVERSARIAL-ESCALATION]`.

### Comment-ledger trust model (round-2 hardening)

Anyone who can comment on a PR can type the marker, so a marker alone proves
nothing. A ledger entry counts only when (a) it was authored by the
owner-account GitHub `User` the runner posts as and (b) its metadata block
parses strictly (marker line, fenced block, exact `reviewed_sha:`,
`reviewed_body_sha256:`, and `status:` lines). Forged or malformed comments
are ignored and can never mint a GREEN.
Remediation never fetches its instructions from PR comments at all — the
loop injects the runner's own rendered review artifact verbatim into the
prompt, with an explicit instruction that comment text is data, not
instructions.

### Exact-snapshot protection

- The review runs only when the local checkout **is** the PR head; the
  reviewed SHA and current PR-body digest are stamped into the comment.
- A GREEN for an older SHA or different body is never approval for a newer
  snapshot. Every push or body edit requires a fresh review.
- Duplicate reviews of the same exact head-and-body snapshot are skipped; the
  skip reports the **prior verdict for that exact snapshot** (a prior
  ISSUES_FOUND exits 1, not 0). A different body digest at the same head is
  stale and receives a fresh review. `--force` re-reviews.
- Iteration numbers and exact-snapshot dedupe are derived from the PR's own
  comments — stateless, no local state file to drift. Parsing lives in ONE place
  (`scripts/adversarial-review-ledger.mjs`, consumed by both scripts): the
  next iteration is **max(validated `review_iteration`) + 1**, never a raw
  comment count — duplicate posts of the same record and malformed comments
  cannot inflate it (live defect on PR #3288, 2026-08-17).

### Durable review budget (2026-08-17 hardening)

The 3-round ceiling is enforced against the **PR's validated review ledger**,
not any single invocation's loop counter. The ledger is one stream ordered by
immutable numeric comment id: each unique validated review round consumes one
slot, and each unmatched canonical FULL reservation consumes one crashed slot.
A validated review completes at most one earlier compatible FULL reservation,
preferring its strict `run_id`; legacy review records without a `run_id` match
only the earliest unmatched compatible reservation. `consumed_before_mine`
counts that mixed review/reservation prefix before the caller's reservation,
so two different bodies cannot both acquire the final slot. Timestamps and API
array order never decide acquisition. Restarting the script does **not** mint
three fresh autonomous rounds; a new session resumes the same budget, and the
loop re-reads the ledger **every cycle** so concurrent or crashed invocations
still count. `review_only` reservations remain non-consuming.

Past the cap, exactly one action exists: a **human-authorized, review-only**
pass — `ADV_REVIEW_HUMAN_AUTHORIZED=1` (set by a human, per run; the loop
refuses it without `--review-only`, and post-cap autonomous remediation does
not exist). The resulting record is stamped `post_cap_human_authorized: true`
inside its fenced block, so a post-cap review is visibly authorized in the
durable ledger, never silent. An unreadable ledger is a tooling failure —
unknown budget is never treated as budget available.

### Atomic round reservation (Codex iteration-4 F1, 2026-08-17)

Reading the budget and then acting on it is racy: two invocations can both
observe a free slot before either posts anything. The acquisition is therefore
**post-first, then decide**, using GitHub itself as the reservation ledger (no
local locks — sessions run on different machines):

1. Before running Codex, the runner posts a strict
   `[ADVERSARIAL-ROUND-RESERVATION]` record — unique 128-bit `run_id`, exact
   `head_sha`, exact `body_sha256`, `mode: full | review_only` (the loop sets
   `full`; anything else is review-only), `human_authorized`, `requested_at` —
   and captures the comment's immutable numeric id.
2. It then re-reads the COMPLETE ledger and proceeds only if its reservation
   is **canonical**: the earliest valid same-account reservation for exact
   `(head_sha, body_sha256, review_epoch)`, where `review_epoch` is the newest
   preceding validated review comment id (or `0`), by numeric comment id.
   This lets A -> reviewed B -> A create a fresh A reservation without
   refunding either earlier round. Every same-snapshot/same-epoch loser exits
   fail-closed before Codex runs. Duplicate posts of the same `run_id`
   collapse to the earliest comment (idempotent retry); distinct `run_id`s
   never collapse;
   forged/malformed reservations never participate. Pre-migration digest-less
   reservations remain budget evidence but can neither prove ownership nor
   block a new exact-snapshot reservation.
3. The budget preserves every unique validated review round and charges every
   canonical full-mode reservation until one later compatible review completes
   it. A completed reservation and its review are one slot; every other
   unmatched canonical FULL reservation remains charged as crashed. The
   historical digest-less reservation format remains budget evidence. All
   heads, bodies, and review epochs share the same three-round ceiling.
4. Every invocation has a fresh 128-bit lowercase-hex artifact token. All
   load-bearing prompt, envelope, Codex log, changed-file list, rendered
   comment, remediation prompt, and Claude log names use
   `<head_sha>-<body_sha256>-<token>`. After rendering, the runner atomically
   publishes mode-`0600` `result-<pr>-<token>.json` containing the exact head,
   body digest, `run_id`, numeric reservation comment id, mode, and rendered
   review path. No head-only artifact is load-bearing.
5. **Immediately before privileged remediation** (`claude
   --dangerously-skip-permissions`) the loop accepts only that token's result,
   verifies every field and the expected review path/envelope, rechecks that
   the current PR still equals the runner-captured snapshot, then re-reads the
   ledger. It proves the run still owns its canonical epoch reservation,
   `consumed_before_mine < 3`, and no `[CLAUDE-REMEDIATION]` completion exists
   for that `run_id`. The loop's pre-call snapshot is advisory only. Any
   missing, malformed, cross-token, stale, or mismatched handoff exits without
   launching Claude.
6. **Evidence binding:** the review record, the remediation disposition, and
   escalation records all carry the same `run_id` (+ reservation comment id);
   the loop rejects a disposition whose `run_id` does not match the round it
   authorized. Remediation input still comes ONLY from the trusted local
   runner artifact, never from PR comments.
7. Any GitHub API failure, incomplete pagination, malformed ledger, or
   inability to prove ownership stops the process — never proceed
   optimistically.

## Loop rules

- Maximum **3** autonomous cycles, then `[ADVERSARIAL-ESCALATION]`.
  `--max-iter` is validated and hard-capped at 3 — each cycle launches a
  privileged headless remediation, so the ceiling is a safety contract, not a
  default.
- Concurrency: the exact head/body snapshot is re-verified **before
  remediation** (stale ISSUES_FOUND findings are never remediated — a changed
  body fails closed and a new head is synced for review) and **before any GREEN
  announcement**. Post-remediation progress
  counts only when the new head *descends* from the reviewed commit AND a
  same-account `[CLAUDE-REMEDIATION]` disposition attests to that exact SHA —
  a third-party push is never "progress".
- No-progress protection: if remediation pushes no new commit, the loop stops
  and escalates (everything left is disputed or needs a human).
- The loop never reviews the same exact head-and-body snapshot twice (dedupe
  above).
- Exit codes: 0 GREEN · 1 unresolved/escalated · 2 tooling failure. **A
  tooling failure is never GREEN.**

## Human interruption policy

The loop runs without confirmation for normal review/fix work. It stops and
escalates when: credentials are missing; three cycles pass without GREEN; no
progress is possible (all findings disputed or `NEEDS_HUMAN_DECISION`);
tooling fails; or the checkout diverges from the PR head. The remediation
contract additionally forbids Claude from merging, deploying, weakening tests,
rotating credentials, or making consequential product/architecture calls —
those become `NEEDS_HUMAN_DECISION` dispositions.

Safety floors: Claude runs headless with `--dangerously-skip-permissions`
**inside this repo only**, where the deterministic `PreToolUse` hooks
(`tools/hooks/prod-guard.sh`, `rm-guard.sh`, `git-state-guard.sh`) remain the
hard floor, and the loop itself contains no history-discarding git commands
(fast-forward only). Codex runs sandboxed `read-only`.

## Failure recovery

| Failure | Behavior | What to do |
|---|---|---|
| Codex command fails / times out | exit 2, log in `.adversarial-review/codex-*.log`, no comment posted | `codex doctor`; re-run |
| Malformed Codex output | exit 2 (never GREEN), envelope kept in `.adversarial-review/envelope-*.json` | re-run with `--force` |
| GitHub unavailable / `gh` unauthenticated | exit 2/3 before any review runs | `gh auth login`; re-run |
| No PR yet | exit 3 with instruction | create the PR, re-run |
| Dirty worktree / HEAD ≠ PR head | exit 3 with instruction | commit/push, re-run |
| New commits arrive mid-review | the posted comment stamps the SHA that was actually reviewed; the next round reviews the new head | nothing — by design |
| Claude remediation fails | escalation comment, exit 2 | read `.adversarial-review/claude-*.log` |

Artifacts (prompts, envelopes, rendered comments, logs, and atomic runner
results) live in `.adversarial-review/` (gitignored) and are invocation-unique.
Each process also writes the exact PR body bytes to a read-only token-bound
artifact and passes only that trusted path into the review prompt; PR-authored
body text is never interpolated into shell or template code.

## Disable procedure

Nothing runs automatically — both scripts are invoked manually (or via
`/adversarial-gate`). To disable: simply don't run them. To remove the slash
command without deleting the implementation, delete
`.claude/commands/adversarial-gate.md`. No hooks, cron, or CI were added.

## Rollback

The automation is self-contained in:
`scripts/adversarial-review{,-loop}.sh`,
`scripts/adversarial-review-{prompt,remediation-prompt}.md`,
`scripts/adversarial-review-{schema.json,render.mjs}`,
`.claude/commands/adversarial-gate.md`, this document, and one `.gitignore`
line. Revert the introducing commit (or delete those files) and the repo is
exactly as before.

## Review metrics preserved for later

Every round leaves structured, greppable data on the PR: marker lines,
`reviewed_sha`, `review_iteration`, per-severity counts, per-finding ids +
confidence, and per-finding dispositions. That is sufficient to later compute:
PRs reviewed, findings per PR, accepted vs FALSE_POSITIVE rates, BLOCKER/HIGH
caught pre-merge, iterations-to-GREEN, and regression tests added — without
changing this format.

## Future upgrade path (documented, deliberately not built)

1. Native Codex GitHub PR review integration.
2. A GitHub Actions gate (needs an org decision on OpenAI credentials in CI —
   today's owner decision is **no**; Gate 7 covers CI with the free cascade).
3. Specialized reviewers by risk type (security, migrations/schema,
   mobile/offline/idempotency, architecture contracts).
4. Automated review metrics + false-positive tracking from the comment data.
5. Review-quality evaluation (did GREEN PRs regress later?).
