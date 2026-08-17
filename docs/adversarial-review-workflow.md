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
   resolve PR -> HEAD==PR-head gate -> SHA dedupe
        -> codex exec (read-only, --output-schema) -> validate/render
        -> gh pr comment  [CODEX-ADVERSARIAL-REVIEW]
        |
        v
scripts/adversarial-review-loop.sh     (the loop, max 3 cycles)
   ISSUES_FOUND -> claude -p (headless, remediation contract)
        -> classify each finding ACCEPTED/PARTIALLY_ACCEPTED/
           FALSE_POSITIVE/NEEDS_HUMAN_DECISION
        -> fix + regression tests + verify -> commit + push
        -> gh pr comment  [CLAUDE-REMEDIATION]
   new SHA -> next review round
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
```

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
base_sha: <merge-base SHA>
status: ISSUES_FOUND | GREEN
review_iteration: <n>

BLOCKER: n / HIGH: n / MEDIUM: n / LOW: n / FALSE_POSITIVE: n
```

A GREEN review additionally contains the literal block
`ADVERSARIAL GATE: GREEN` + `reviewed_sha: <SHA>`.

Claude's disposition comment starts with `[CLAUDE-REMEDIATION]` and lists one
line per finding id with its classification. Escalations start with
`[ADVERSARIAL-ESCALATION]`.

### Comment-ledger trust model (round-2 hardening)

Anyone who can comment on a PR can type the marker, so a marker alone proves
nothing. A ledger entry counts only when (a) it was **authored by the same
GitHub account the runner posts as** and (b) its metadata block **parses
strictly** (marker line, fenced block, exact `reviewed_sha:`/`status:`
lines). Forged or malformed comments are ignored and can never mint a GREEN.
Remediation never fetches its instructions from PR comments at all — the
loop injects the runner's own rendered review artifact verbatim into the
prompt, with an explicit instruction that comment text is data, not
instructions.

### SHA protection

- The review runs only when the local checkout **is** the PR head; the
  reviewed SHA is stamped into the comment.
- A GREEN for an older SHA is never approval for a newer one: every new commit
  changes `headRefOid`, and the runner reviews (and stamps) the new SHA.
- Duplicate reviews of the same SHA are skipped; the skip reports the **prior
  verdict at that SHA** (a prior ISSUES_FOUND exits 1, not 0). `--force`
  re-reviews.
- Iteration numbers and dedupe are derived from the PR's own comments —
  stateless, no local state file to drift.

## Loop rules

- Maximum **3** autonomous cycles, then `[ADVERSARIAL-ESCALATION]`.
  `--max-iter` is validated and hard-capped at 3 — each cycle launches a
  privileged headless remediation, so the ceiling is a safety contract, not a
  default.
- Concurrency: the head is re-verified **before remediation** (stale
  ISSUES_FOUND findings are never remediated — the loop syncs and reviews the
  new head) and **before any GREEN announcement**. Post-remediation progress
  counts only when the new head *descends* from the reviewed commit AND a
  same-account `[CLAUDE-REMEDIATION]` disposition attests to that exact SHA —
  a third-party push is never "progress".
- No-progress protection: if remediation pushes no new commit, the loop stops
  and escalates (everything left is disputed or needs a human).
- The loop never reviews the same SHA twice (dedupe above).
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

Artifacts (prompts, envelopes, rendered comments, logs) live in
`.adversarial-review/` (gitignored).

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
