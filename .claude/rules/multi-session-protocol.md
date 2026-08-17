# Multi-Session Protocol (repository-wide governance)

Multiple Claude/Codex sessions work this repository concurrently, from
multiple machines. This protocol governs how a session claims work, isolates
it, gets it adversarially reviewed, and hands it off — so parallel sessions
never collide and no gate is quietly skipped. It is **repository-scoped**:
it lives in this repo, applies to work in this repo, and must never be
installed machine-wide (`~/.claude`) or into unrelated repositories.

**Precedence:** system instructions, security constraints, this repository's
other rules (`.claude/rules/`, root `CLAUDE.md`, `docs/environments.md`), and
explicit human authorization take precedence over this protocol. Directory-
level instructions may refine it but must not silently weaken its gates.

## 1. Inspect before editing

Before any edit: inspect the current checkout, branch, HEAD, remotes,
`git worktree list`, open PRs, and the changed-file lists of plausibly-
overlapping PRs. Fetch remote state when safe. Determine whether another PR
or session already owns the work — **check `gh pr list` and search for the
slice by content, not just by title** (see §4). Do not duplicate or overwrite
an existing canonical effort.

## 2. Claim only unclaimed work — with a durable claim

Use the repository's established claim mechanism where one exists (an
assigned GitHub issue, a convergence-unit record under
`docs/architecture/convergence/units/`, or an existing canonical PR).
Otherwise post this marker on an issue or draft PR:

```
[WORK-CLAIM]
Slice:
Convergence unit:
Owner/session:
Branch:
Worktree:
Base SHA:
Expected files/systems:
Status: ACTIVE | BLOCKED | RELEASED | COMPLETE
Last updated:
```

Do not create an empty/noisy PR when an assigned issue or existing canonical
PR already provides an adequate claim. A PR that carries the actual work is
itself a valid claim.

**Claim acquisition is check-then-act and therefore racy — the winner is
decided by a post-claim reread, not by the pre-check.** After posting your
claim, RE-READ the claim namespace (open PRs + issues + markers for the
slice). If another ACTIVE claim overlapping your slice exists with an
earlier GitHub creation time/event id, **you lost**: set your claim's Status
to RELEASED and coordinate on the winner's thread instead of editing.
Earliest-created ACTIVE claim wins, deterministically. Only after the reread
confirms yours is the earliest may editing begin. The pre-push overlap check
(§4) remains as defense in depth, not as the primary collision control.

**Handoff and stale claims.** A claim names a slice, not a person: to hand a
slice to another session, the current owner (or the human) updates the claim's
`Owner/session:` and `Last updated:` — a resumed session under the same claim
is a continuation, not a takeover. An ACTIVE claim goes **stale** when BOTH
its claim record and its branch have been idle for 24+ hours; a stale claim
may be taken over only by posting a takeover note on the claim's own thread
citing the idle evidence (last commit time, last claim update) and updating
the claim — **never silently, and never while the branch is moving**.
`RELEASED` and `COMPLETE` free the slice immediately. When in doubt whether
an owner is dead or just slow, ask the human instead of taking over.

## 3. Isolate; never touch another session's work

- Parallel efforts are isolated by worktree, branch, scope, and PR. Use an
  isolated worktree and dedicated branch unless the current environment is
  demonstrably isolated and clean (`.claude/rules/subagent-worktree-isolation.md`
  — including its teardown obligations).
- **Never modify another session's branch, worktree, or dirty checkout.**
  Foreign WIP, foreign stashes, and foreign worktrees are off-limits
  (`.claude/rules/session-discipline.md` §3).
- Record a rollback point (branch + base SHA, or the repo's R0 mechanism for
  architecture work) **before** substantial changes.

## 4. Check actual overlap — before claiming AND again before pushing

PR titles are not evidence. Inspect changed-file lists, commits, schemas,
APIs, convergence units, and architectural ownership
(`docs/architecture/convergence/REGISTRY.yaml`) before claiming, and recheck
remote state and open PRs immediately before pushing. A collision discovered
late is resolved by coordination (comment on the canonical PR / release the
claim), never by force-push or silent overwrite.

## 5. Substantial work (definition)

Substantial: architecture, shared contracts, migrations, schema changes,
security, authentication, authorization, tenant isolation, concurrency,
idempotency, data integrity, reliability, production automation,
cross-cutting refactors, multi-service changes, and any change whose failure
could cause data loss, exposure, outage, or difficult rollback.

Normally non-substantial: typographical corrections, mechanical formatting,
narrow test maintenance, genuinely isolated low-risk fixes.

**When uncertain, classify as substantial and record the reasoning in the
PR. Changes to this governance protocol are substantial.** Substantial work
requires the rollback point (§3), the adversarial gate (§6), and the session
closeout (§9).

## 6. Adversarial review gate (roles, staleness, fail-closed)

The mechanized lane — `scripts/adversarial-review.sh`,
`scripts/adversarial-review-loop.sh`, `scripts/adversarial-review-ledger.mjs`,
and `docs/adversarial-review-workflow.md` — is **committed on the default
branch and mandatory as-committed there** (merged via PR #3279,
`6fe5fff84658`). Run it from the branch under review after rebasing onto
current `main`; never casually copy, fork, or reimplement it in another PR,
and never source it from a mutable branch name — a moved branch can silently
swap the reviewer out from under you. If those paths are ever absent, broken,
or unauthorized at the HEAD you are working from, that is the
missing-tooling case: **fail closed** per the invariant below — do not
resurrect old pins or ad-hoc copies.

**The review ledger is durable and GitHub-backed.** Budget rounds, round
reservations (run_ids), verdicts, and remediation dispositions are counted
from validated, same-account, strictly-parsed PR comments — never from local
state or terminal output. Restarting a session, crashing, or re-invoking the
runner **never resets the budget**: a crashed reservation stays consumed
(there is no takeover — recovery is a new head), and duplicate posts of the
same run_id collapse instead of double-charging.

The **invariants below bind in all cases, tooling or no tooling**:

- **Claude implements and remediates. Codex reviews read-only** and produces
  evidence-backed findings; it must not edit the implementation branch during
  review. Claude independently investigates each finding and implements only
  accepted remediation — neither model is the authority: runtime behavior,
  tests, contracts, architecture, reproduction, and source evidence outrank
  either model's opinion.
- **GitHub is the durable store** for claims, findings, remediation
  dispositions, and evidence — never only a terminal scrollback.
- **GREEN applies only to the exact reviewed commit.** Any HEAD change makes
  a previous GREEN stale. A broken, interrupted, malformed, timed-out, or
  unavailable review is **never** GREEN.
- **Maximum three autonomous review/remediation rounds**, then escalate to a
  human with the unresolved findings.
- **Fail closed on missing tooling:** if required review tooling is missing,
  broken, unauthorized, malformed, timed out, or unavailable, do not simulate
  the review and do not silently skip it. Preserve the implementation and
  test evidence, then report PARTIAL or BLOCKED naming the exact dependency.

## 7. Hard human gates

Never merge, deploy production, bypass CI, weaken gates or tests, rewrite
shared history, or destroy data without explicit human authorization
(`docs/environments.md`, `.claude/rules/dangerous-commands-safety.md`).
Whenever required gates are incomplete, report **PARTIAL** or **BLOCKED** —
never dress an incomplete state as done.

## 8. Bounded continuation

After completing the assigned slice, identify the next unclaimed slice **for
the closeout report**. Begin it only when the user, an assigned issue, the
project workflow (e.g., the convergence queue), or an explicit standing
instruction authorizes continued implementation. Otherwise stop after
reporting it. Do not invent new scope to remain active.

## 9. Session closeout (required for substantial work)

```
SESSION CLOSEOUT

Status: GREEN | PARTIAL | BLOCKED
Owned slice:
Worktree:
Branch:
PR:
Base SHA:
HEAD SHA:
Protocol location:
CLAUDE.md integration:
Changes:
Validation/tests:
CI:
Adversarial review:
Reviewed SHA:
Unresolved findings:
Rollback:
Collision check:
Next unclaimed slice:
Authorization to begin next slice: YES | NO
Human action required: NONE | <specific action>
```

(Lines that don't apply to a given slice — e.g. "Protocol location" outside
governance changes — may read `n/a`, never be omitted.)

## Cross-references

- `.claude/rules/session-discipline.md` — single-session discipline this
  protocol layers multi-session coordination onto
- `.claude/rules/subagent-worktree-isolation.md` — worktree isolation +
  teardown obligations
- `.claude/rules/dangerous-commands-safety.md` — destructive-command floor
- `docs/environments.md` — dev/staging/prod promotion; merge/deploy gating
- `docs/adversarial-review-workflow.md` — review-loop mechanics (committed;
  merged via PR #3279)
- `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` — R0
  rollback points + gated workflow for architecture-affecting work
