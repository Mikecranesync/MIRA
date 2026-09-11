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

**An adjudication that is not on the PR thread does not exist.** Automation and
other sessions read the thread; they do not read your peer messages or the
human's chat. On 2026-09-08 two reviewers agreed in peer messages that a finding
was deferred, left it there for two hours, and the Foreman — which *does* read
the thread each wake — dispatched a P0 work order from the stale finding text.
The resulting push broke the surface and cost a revert. Post the conclusion to
the thread **when you reach it**, not when a collision forces you to.

**No push to a branch under active review without a posted `[WORK-CLAIM]`.**
Two unclaimed pushes landed on one PR that night; one required a revert, one
improved the branch, and the difference was luck rather than process. An
unclaimed push is revertible on sight regardless of its quality — the shared
Git identity means the commit itself cannot tell anyone who wrote it, which is
exactly what the claim exists to supply. If you must push without a claim,
post `[WORK-CLAIM] … Status: COMPLETE` with the exact 40-character SHA
immediately after, and say which session you are.

**Never run `gh pr merge --delete-branch` from the shared checkout.** When the
PR branch exists locally, `gh` checks it out, resets it, merges, then switches
to the base branch — silently rewriting `HEAD` in a working tree another session
may be using. It reads as a purely remote operation and is not one. Use a
throwaway detached worktree, or omit `--delete-branch` and delete the remote
branch separately.

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

> **⏳ TIME-BOXED CARVE-OUT — Codex unavailable, 2026-09-07 → 2026-09-13.**
> Codex is out of usage until **2026-09-13**. That is exactly the "unavailable"
> condition above, whose prescribed answer is to report BLOCKED rather than
> appoint a substitute. Mike has decided otherwise for this window: **Claude
> implements, a DIFFERENT Claude reviews, and CI must be green.** Three
> conditions on it, all binding:
>
> 1. **Every review run this way is labelled PARTIAL** in its own text, naming
>    the degraded lane. A verdict that does not record which lane produced it is
>    indistinguishable from a full one within a week.
> 2. **It expires 2026-09-13.** On that date this block is deleted and the rule
>    above governs again unamended. If Codex has not returned, the expiry is
>    re-decided by a human — it does not roll over by default.
> 3. **It does not weaken any other gate.** Green CI, exact-SHA review, the
>    three-round cap and the human merge gate all still apply.
>
> **Why this is a carve-out and not a replacement.** The value of
> Codex-reviews-Claude is *provider* independence — a different model with
> different blind spots. Two Claude sessions share training, priors and failure
> modes. Evidence from the night this was written cuts both ways: cross-Claude
> review caught six real defects that the author missed, so it is plainly not
> worthless — but every one of them was a governance or wiring defect, the class
> both sessions were already tuned to hunt. Whether a second Claude catches what
> the first missed in the classes *neither* hunts is precisely what the
> substitution assumes away. So this is the best option available, not a
> like-for-like fallback, and calling it "the review lane" would overstate it.
>
> Raised by `fleet-001-review-e9`; decided by Mike 2026-09-07; discussion at
> #3653.

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
