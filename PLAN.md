# Autonomous Run Plan — PR governance continuation through midnight

**Date:** 2026-09-18
**Operator authorization:** Mike: “create your own” after the required autonomous-run
worktree/PLAN preflight blocked the shared checkout.
**Branch:** `codex/pr-governance-20260918`
**Worktree:** `C:/Users/hharp/.codex/worktrees/pr-governance-20260918/MIRA`
**Base:** `origin/main` at `392b278f257eb02917eeca7d3ddf1238f581b601`
**Stop time:** midnight America/New_York, or an earlier hard stop below.

## Goal

Safely finish the agent-side governance work for PRs #3829, #3835, and #3837:
preserve immutable-tip evidence, prove whether #3835's new JVM test actually executes,
update #3835 onto current main without overwriting another writer, and prepare human-only
lifecycle decisions against the exact resulting tips and bodies.

**Charter correction made during execution:** `legacy-ui-exception` is explicitly
human-only. References below to applying a label mean preparing and verifying the exact
state for a Maintain/Admin human; this autonomous session never applies that label.

## In scope — numbered, ordered, complete this list and STOP

1. **Re-establish immutable provenance.** Re-read the lifecycle charter/guard, the three
   attestation comments, exact remote heads, changed-file sets, CI rollups, and current labels.
   Confirm #3833 and #3839 remain excluded because Charlie authored them.
2. **Verify #3835's JVM evidence is live.** Trace `MainActivityRecoveryTest.java` through the
   Android/Gradle test configuration and native CI commands. Run the exact local task that CI
   should run. If the test is not selected, do not treat it as evidence; either make the
   smallest collision-free test-wiring correction on #3835 or stop with a precise blocker.
3. **Update #3835 safely.** Rebase `codex/fix-mobile-camera-resume-stability` onto the exact
   current `origin/main` only after a clean-worktree and remote-tip lease check. Resolve only
   conflicts within #3835's two owned files. Push with `--force-with-lease=<branch>:<old-tip>`,
   re-run focused evidence, and wait for required CI.
4. **Refresh #3835's exact-tip review.** Independently run the lifecycle guard and review the
   rebased diff. Add an exact-tip attestation only if the reviewed SHA passes the documented
   category and the JVM proof is real. Record the precise human-only label prerequisite after
   a final unchanged-tip check.
5. **Advance #3829 only on its frozen evidence.** Reconfirm head `c0181074b...`, Charlie's
   exact-tip PASS, changed paths (including `SendError.tsx`), relevant green CI, and lane
   ownership. Prepare the human-only `legacy-ui-exception` decision only if every fact remains
   unchanged.
6. **Disposition #3837 honestly.** Re-run the guard and inspect Charlie's category-3 finding.
   Do not relabel it as migration/removal/adapter work. If the charter permits a complete,
   exact-tip audited exception that this session can independently substantiate, record it;
   otherwise leave it blocked with the exact unmet human/maintainer decision. Never apply the
   human-only label from automation.
7. **Monitor through the stop time.** Recheck any CI triggered by the actions above. Do not
   merge. Write `HANDOFF.md` with row-by-row results, exact SHAs, comments, labels, CI state,
   risks, and commands; commit and push only this governance branch's PLAN/HANDOFF/wiki record.

## Explicitly OUT of scope

- Merging any PR, enabling auto-merge, deploying, publishing OTA, touching production,
  changing branch protection, or using production credentials.
- Any action on #3833 or #3839; Charlie authored both and cannot independently attest them.
- Product-code changes on #3829 or #3837, including `NotebookScreen.tsx`, `SendError.tsx`,
  the shared ChatV2 path, or `packages/factorylm-ui/**`.
- Changes to #3835 outside its existing `MainActivity.java`,
  `MainActivityRecoveryTest.java`, and the narrowest test-discovery configuration if mechanical
  proof shows the test does not execute and no open PR owns that configuration.
- Weakening, bypassing, or redefining the Legacy UI Lifecycle Guard or its charter.
- Refreshing an attestation across a moved tip without a fresh review of the new exact SHA.
- Force-pushing without an explicit SHA lease, or overwriting any concurrent writer.

## Success criteria

| # | Done means |
|---|---|
| 1 | Remote tips, attestations, labels, changed paths, and authorship exclusions are recorded from GitHub at execution time. |
| 2 | The exact Gradle/native-CI task demonstrably selects and passes `MainActivityRecoveryTest`; otherwise #3835 remains blocked with evidence. |
| 3 | #3835 is based on the current main snapshot, its remote update used an explicit old-tip lease, focused tests pass, and the pushed SHA is recorded. |
| 4 | #3835 has an exact-new-tip independent verdict and a precise human-only label prerequisite; no automation applies the label. |
| 5 | #3829 has a fresh verdict bound to head `c0181074b...` and the corrected current body; no automation applies the label. |
| 6 | #3837 is either fully justified under the real category-3 contract or is left blocked without a misleading label. |
| 7 | No merge/deploy occurred; final CI state is reported; PLAN/HANDOFF-only governance branch is committed and pushed. |

## Hard stops

- Any target tip moves unexpectedly or an explicit force-with-lease would fail.
- Another open PR/session claims a file needed for a #3835 correction.
- A lifecycle exception requires a maintainer judgment that cannot be independently supplied.
- A product-code change outside the narrow scope above is required.
- The same gate fails twice, five consecutive turns hit one failure, 200 turns are reached,
  or context usage exceeds 70%.

## Commit / push policy

- Product PR updates go only to their existing branch and only as explicitly scoped above.
- Governance artifacts go only to `codex/pr-governance-20260918`.
- Never push to `main`, `develop`, or `dev`; never merge.

## Execution result

1. **COMPLETE** — live heads, bodies, files, checks, labels, guard behavior, and the three
   inherited attestations were re-read; #3833/#3839 remained excluded from action.
2. **COMPLETE / GAP PROVEN** — the exact Gradle task selected and passed
   `MainActivityRecoveryTest` (1 test, 0 failures), but no PR CI job invokes native Gradle unit
   tests. `.github/workflows/ci.yml` is owned by open PR #3839, so this run did not collide.
3. **COMPLETE** — #3835 rebased from `9088484ff...` onto main `392b278f...`, pushed with an
   explicit old-tip lease, and now sits at `4234b0dd8...`; the stable patch ID is unchanged.
4. **BLOCKED** — #3835's exact-tip code and local JVM evidence pass, but the new test is not CI
   evidence until a native job executes it. Durable review: issue comment `5736631676`.
5. **COMPLETE / HUMAN-GATED** — #3829 body corrected to include `SendError.tsx`; fresh exact
   head/body category-2 PASS posted as issue comment `5736737562`. No label applied.
6. **BLOCKED / HUMAN DECISION** — #3837 remains category 3. Its body now says so and has a
   current rollback SHA; durable review: issue comment `5736737735`. No label applied.
7. **COMPLETE** — final snapshots have no pending checks; ordinary CI is green and only the
   expected unlabeled lifecycle guards fail. No merge, deployment, or exception label occurred.
