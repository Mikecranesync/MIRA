# HANDOFF — PR governance continuation (2026-09-18)

**Governance branch:** `codex/pr-governance-20260918`

**Base:** `origin/main` `392b278f257eb02917eeca7d3ddf1238f581b601`

**Product branches touched:** #3835 rebase/push only; #3829 and #3837 PR-body corrections only

**Never performed:** merge, deployment, auto-merge, exception-label application, action on #3833/#3839

## Outcome

| PR | Exact head | Verdict | Durable record | Label state |
|---|---|---|---|---|
| #3829 | `c0181074b80933233d3fb040bec804396615a5e3` | **PASS, category 2** on corrected current body | [fresh Codex review](https://github.com/Mikecranesync/MIRA/pull/3829#issuecomment-5736737562) | No labels |
| #3835 | `4234b0dd8c04c57bb946d784704d9793dbd764e9` | **BLOCKED**: code/local JVM test pass, but PR CI never executes the JVM test | [exact-head Codex review](https://github.com/Mikecranesync/MIRA/pull/3835#issuecomment-5736631676) | No labels |
| #3837 | `747c22f8dcc0a0bca24b152f927ae8bbdd79637d` | **BLOCKED, category 3** pending explicit maintainer disposition | [exact-head Codex review](https://github.com/Mikecranesync/MIRA/pull/3837#issuecomment-5736737735) | `bug`, `vision`, `P0`; no exception label |

All three PR base snapshots equal current `main` `392b278f257eb02917eeca7d3ddf1238f581b601`.
At the final snapshot, ordinary CI gates were green, no checks were pending, and the only
failures were expected `Legacy UI Lifecycle Guard` runs caused by the absent human-only label.

## #3835 — rebase and JVM evidence

- Old remote head: `9088484ffdc0b36d141d55f34944bfdd3cbe76b0`.
- Rebased onto exact `origin/main` `392b278f257eb02917eeca7d3ddf1238f581b601`.
- New remote head: `4234b0dd8c04c57bb946d784704d9793dbd764e9`.
- Push used
  `--force-with-lease=codex/fix-mobile-camera-resume-stability:9088484ffdc0b36d141d55f34944bfdd3cbe76b0`.
- Old/new stable patch ID: `fa963ab193bbe3ecade5c5ba674261b6f566847d`.
- Exact post-rebase task:
  `gradlew.bat testDebugUnitTest --tests com.factorylm.mira.MainActivityRecoveryTest --rerun-tasks`.
- Result: 1 selected, 0 skipped, 0 failures, 0 errors. The XML timestamp was
  `2026-09-18T21:48:29.747Z`.
- CI gap: `.github/workflows/ci.yml` runs Bun mobile tests only; the native release workflow
  runs `assembleRelease bundleRelease` but not `testDebugUnitTest`. Open PR #3839 currently owns
  `ci.yml`, so this run did not create a concurrent workflow writer.

## #3829 — corrected record and ownership audit

- The code head never moved.
- The PR body no longer claims `SendError.tsx` was deliberately unchanged. It records that
  checkpoint `4af2fb4a2` changed `hooks.onSend(text)` to `hooks.onSend(text, [])`, and that the
  later attachment-retention repair makes this retry path compose correctly.
- Current body SHA-256:
  `0db48432af50fa140e8028341e50a8218bbf0499627feaa15720ed9b5815b94b`.
- The guard controls pass and the PR needs an exception label. The body has exactly one exception
  section with substantive Reason, Canonical replacement impact, and Rollback fields.
- A repository-wide open-PR inventory corrected the earlier narrower statement: #3815, #3822,
  and held #3690 also touch the indivisible shared-core lane. No competing `ACTIVE` lease was
  found (#3822's prior remount is `COMPLETE`; its new work order has no later `ACTIVE`; #3815 has
  no active claim record; #3690 is held). This establishes current lease exclusivity, not safe
  parallel merging; the integrator must serialize/remount the overlapping branches.
- The PR body edit invalidated Charlie's body-bound review, so a fresh exact-head/exact-body PASS
  was posted. The human-only label remains absent.

## #3837 — honest exception disposition

- The code head never moved.
- The PR body was corrected to say that the change is the charter's controlled audited-exception
  class, not migration/removal/adapter/rollback work. Rollback now references the current
  one-commit head.
- Current body SHA-256:
  `d4e8b069d30278c9511ce3e234340529503a61c83647d0b90d0a8e4029a295aa`.
- During that edit, PowerShell briefly flattened the Markdown. GitHub `userContentEdits` supplied
  the exact pre-edit formatted body; it was immediately restored with only the intended Reason
  and Rollback substitutions. Final structural verification: 55 lines, exactly one exception
  section, and exactly one each of Reason, Canonical replacement impact, and Rollback.
- The implementation still adds copy, fail-closed behavior, and a `lookQuestion` prefix inside
  frozen `NotebookScreen`; ordinary green CI cannot convert it into category 1 or 2.

## Human next actions

1. A Maintain/Admin human may apply `legacy-ui-exception` to #3829 **only** while head
   `c0181074b...` and body SHA-256 `0db48432...` remain unchanged; then verify the new lifecycle
   run. Any push or body edit requires another review and a fresh label event.
2. After #3839 releases `.github/workflows/ci.yml`, add a native PR-CI job that executes
   `testDebugUnitTest`, remount #3835 if main moved, and obtain a new exact-head review before a
   human label decision.
3. For #3837, explicitly choose between accepting the category-3 exception or superseding it by
   moving the trust check into the canonical attachment/server route path. Do not label it as
   category 1 or 2.

## Recheck commands

```powershell
gh pr view 3829 --repo Mikecranesync/MIRA --json headRefOid,body,labels,statusCheckRollup
gh pr view 3835 --repo Mikecranesync/MIRA --json headRefOid,body,labels,statusCheckRollup
gh pr view 3837 --repo Mikecranesync/MIRA --json headRefOid,body,labels,statusCheckRollup
py tools/guard-check.py 3829 3835 3837
```
