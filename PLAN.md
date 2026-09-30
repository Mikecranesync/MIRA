# Autonomous Run Plan — Complete interaction capture (#3939)

**Date:** 2026-09-23 · **Branch:** `feat/turn-capture-lifecycle`
**Base SHA (rollback point R0):** `41539edfa` (= `origin/main` at start)
**Worktree:** `.claude/worktrees/capture-split`
**Issue:** #3939 (claim updated to this branch) · findings #3962, #3963
**Supersedes for this run:** the contract PLAN in `.claude/worktrees/mira-contract-night`
(that is PR #3959, a separate slice, blocked on two human gates).

## Why this branch and not #3959

#3959 is 77 files, BEHIND main, and blocked on a maintainer-applied
`legacy-ui-exception` label plus an independent-review-lane decision. Capture work
does not depend on the persona contract, so it must not be held hostage by it.
The three lifecycle commits were cherry-picked onto `origin/main`; the single
conflict was contract-only (SAFETY PAUSE) and was resolved to main's behaviour,
keeping just `lifecycleOutcome = "safety_stop"`. `coverage/route.ts` lost its
`miraContractEnabled()` readout for the same reason.

Second benefit: `retrieval-acceptance.yml` checks out the DEFAULT branch, so a
main-based branch is the only one its live acceptance job can actually validate.

## Objective

Every accepted turn is durably recorded from start to terminal outcome, that
record is reconstructable, and coverage is measured by something that is **not**
the recorder. Prove it live on staging and on a real Pixel 9a — not in unit tests.

## IN SCOPE — numbered, with success criteria

1. **Durable, idempotent attempt lifecycle through terminal outcome.**
   Covers rejection, refusal, timeout, cancellation, cascade exhaustion, retries,
   crashes. `endRoot` cannot guarantee closure ⇒ a **sweeper** appends `abandoned`
   to stale starts; closure is never assumed from process liveness.
   *Done when:* every exit path of the chat route sets a terminal outcome; a
   killed process leaves a start row that the sweeper closes; re-running the same
   idempotency key does not duplicate; `decision_traces` stays append-only.

2. **Independent reconciliation.** A missing start row **cannot** appear in a
   query of the ledger, so coverage needs a second counter that is not the
   recorder: an ingress-side count written before any processing.
   *Done when:* coverage reports ingress vs ledger separately; accepted turns and
   pre-accept rejections have **separate denominators**; missing starts,
   unfinished turns, write/export failures, duplicates and incomplete packets are
   each detectable; limits stated honestly.

3. **Correlation + client acknowledgement.** upload/LOOK → question → recalled
   evidence → retrieval → assembled model inputs → provider/tool calls → gates →
   generated vs persisted answer → client ack. Distinguish generated / sent /
   received. Bounded offline retry, dedup, backpressure, visible unrecoverable
   failure.
   *Done when:* one trace id joins all hops; client ack is a distinct recorded
   fact; a dropped client event retries within a bound and then surfaces.

4. **Reconstructable inputs/outputs.** Tenant-scoped content references, access
   control, redaction, retention/deletion, integrity checks. No credentials, no
   private chain-of-thought.
   *Done when:* either implemented behind tenant-scoped storage, or delivered as
   a design + explicit approval ask. **No new third-party content export.**

5. **#3962 and #3963.**
   - #3963: port the all-zero exemption from `a0318b21b` into
     `ungroundedUnitClaim()` in `anomalies.ts`; re-measure the fire rate on the
     same 40-turn window before claiming a fix.
   - #3962: anchor the recalled observation in the prompt AND add a **versioned
     mismatch assessment** recorded on the packet. It is an assessment, not a
     verdict about internal reasoning, and must not rest on noun overlap alone.
   *Done when:* #3963 fire rate re-measured and reported; #3962 shows repeated
   bearing-photo follow-ups that stay on the bearing, with the assessment
   recorded either way.

6. **Environment/build indicator + Copy diagnostics + exporter-outage proof.**
   *Done when:* the surface shows which backend/build it is on without raw JSON;
   an exporter outage preserves durable records and replays with **no duplicate
   turns**.

7. **Jev evaluation (#3957/#3958).** For every improvement above, evaluate Jev's
   actual API. Record **adopt / defer / reject** with measured benefit, cost,
   latency, privacy impact. Shadow-test first.
   *Done when:* a decision table exists with measurements, not opinions. Jev never
   replaces a deterministic safety, authorization or release gate.

8. **Acceptance.** Real browser against `app-staging.factorylm.com` AND a real
   Pixel 9a on the **staging flavor** (`com.factorylm.mira.staging`), covering
   photo, follow-up, failed upload, timeout, cancel, reconnect, process crash,
   exporter outage. Every attempt pre-registered with a client-generated id so
   never-sent is distinguishable from never-recorded. Automated deployment
   acceptance pinned to the **deployed** SHA, not the default branch.

## OUT OF SCOPE — do not touch

- **Production deploy, production flag enable, production migration apply.**
  Prepare migration/config/deploy/rollback; execute only on explicit approval.
- **Fault injection against production.** Never.
- **New third-party content export** (incl. `contentCapture: true` to Langfuse)
  without separate written approval.
- **Jev promotion out of shadow.** Do not edit Jev gating; do not let a
  probabilistic judgment gate safety, authorization or release.
- **PR #3959's persona-contract code.** Different slice, different PR.
- **OT / PLC / fieldbus writes** of any kind.
- Review/gate bypasses (`MIRA_SKIP_STOP_GATE`, `MIRA_ALLOW_PROD`, `--force`).
- Deleting any existing protection to make a test pass.
- Editing `VERSION`, `CHANGELOG.md`, `wiki/hot.md` directly.

## Coordination

- #3957 / #3958 (Jev shadow, both DRAFT) touch the same `chat/route.ts`. My edits
  are the recorder/lifecycle seam, not the Jev seam. Whoever merges second
  rebases. Do not touch their Jev code.
- #3959 touches the same file in the prompt-composition/mode-selection region.
- Claim on #3939 to be updated to this branch/worktree before the first push.

## Budget

Paid evaluation spend **≤ $1.00**, declared per lane, hard-stop at the bound.
Live staging turns use the existing free cascade.

## Rollback

R0 = `41539edfa`. Every commit pushed to the branch. Staging rollback = redeploy
the previous staging SHA. Migrations 091/092 are additive and append-only;
091 is already applied and its bytes are immutable.

## Stop conditions

All PLAN rows done · >70% budget · >200 turns · 5 turns on one failing test ·
architecture/security/privacy decision needed · any OUT-of-scope path required ·
isolation/privacy/data-loss/safety risk · remaining work human-gated → write
HANDOFF **once** and stop.
