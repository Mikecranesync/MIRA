# Unblock Context Spine DB Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase and verify PR #2307 (`codex/context-spine-db-integration`) so the bottom of the context-spine stack can merge to `main`.

**Architecture:** Do not rebuild the import/DB harness. Resolve the current `main` drift around `mira-hub/package.json` and `wiki/hot.md`, keep the #2307 integration harness and import-route behavior, then prove the branch with focused unit/integration checks before making the PR ready.

**Tech Stack:** GitHub PR stack, `gh`, Git, PowerShell, Node/npm, Vitest, Neon-backed integration tests through Doppler when available.

## Global Constraints

- Do not introduce a new database or graph store.
- Do not bypass approval gates.
- Preserve read-only/live-control safety; no live write/control paths.
- Keep `main` version metadata when resolving `mira-hub/package.json`.
- Keep PR #2307 as the bottom stack PR into `main`; do not merge #2308 until #2307 is clean.
- Treat `.env`/secrets as Doppler-managed; do not commit secrets.

---

## Current State

- PR #2307: `codex/context-spine-db-integration` -> `main`, draft, `CONFLICTING`.
- PR #2308: `codex/context-spine-readiness-checklist` -> `codex/context-spine-db-integration`, draft, mergeable, check passing.
- PR #2309: merged into `codex/context-spine-readiness-checklist`.
- `git merge-tree` shows real #2307 conflicts in:
  - `mira-hub/package.json`
  - `wiki/hot.md`
- #2307 changed 13 files:
  - `docs/investigations/2026-06-25-context-spine-subagent-audit.md`
  - `docs/plans/2026-06-25-context-spine-unification-plan.md`
  - `docs/superpowers/plans/2026-06-25-hub-db-integration-test-database.md`
  - `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`
  - `mira-hub/package.json`
  - `mira-hub/scripts/run-dev-integration-tests.mjs`
  - `mira-hub/scripts/setup-integration-db.mjs`
  - `mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts`
  - `mira-hub/src/app/api/contextualization/import/__tests__/route.bundle.test.ts`
  - `mira-hub/src/app/api/contextualization/import/import.integration.test.ts`
  - `mira-hub/src/app/api/contextualization/import/route.ts`
  - `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts`
  - `wiki/hot.md`

## File Responsibilities

- `mira-hub/package.json`: keep `main` package version and add DB integration scripts from #2307.
- `wiki/hot.md`: keep the newest `main` hot-cache entry and append/preserve #2307 context-spine DB harness notes without conflict markers.
- `mira-hub/scripts/setup-integration-db.mjs`: disposable integration DB setup and guardrails.
- `mira-hub/scripts/run-dev-integration-tests.mjs`: Doppler/dev guarded integration runner.
- `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`: integration-only CMMS/RLS fixture.
- Contextualization import/review tests and route: prove offline contextualizer bundle import lands in Hub DB spine with idempotent batch/source behavior.

---

### Task 1: Rebase #2307 Onto Current `main`

**Files:**
- Modify: `mira-hub/package.json`
- Modify: `wiki/hot.md`

**Interfaces:**
- Consumes: `origin/main`, `origin/codex/context-spine-db-integration`
- Produces: updated `codex/context-spine-db-integration` branch with conflicts resolved

- [ ] **Step 1: Ensure local state is clean**

Run:

```powershell
git status --short --branch
```

Expected: no tracked modifications. If untracked scratch exists, remove only known local scratch after verifying it is inside the workspace.

- [ ] **Step 2: Switch to the bottom PR branch**

Run:

```powershell
git switch codex/context-spine-db-integration
git fetch origin main codex/context-spine-db-integration
```

Expected: branch is `codex/context-spine-db-integration`.

- [ ] **Step 3: Merge current main**

Run:

```powershell
git merge origin/main
```

Expected: merge stops with conflicts in `mira-hub/package.json` and `wiki/hot.md`.

- [ ] **Step 4: Resolve `mira-hub/package.json`**

Use this policy:

```json
{
  "version": "2.20.0",
  "scripts": {
    "db:integration:setup": "node scripts/setup-integration-db.mjs",
    "test:integration:dev": "node scripts/run-dev-integration-tests.mjs",
    "test:integration:db": "npm run db:integration:setup && npm run test:integration"
  }
}
```

Keep all existing `main` dependencies and scripts. Add the three DB integration scripts next to the existing `test:integration` script. Do not downgrade `version` from `2.20.0` to `2.18.1`.

- [ ] **Step 5: Resolve `wiki/hot.md`**

Keep the current top `main` entry:

```markdown
# Hot Cache — 2026-06-25 — Hub one-board Command Center status view
```

Also preserve the #2307 context-spine entries:

```markdown
# Hot Cache - 2026-06-25 - Context spine unification audit
# Hot Cache - 2026-06-25 - Hub DB integration harness planned and partially implemented
# Hot Cache - 2026-06-25 - Hub DB integration harness proven on disposable Neon
```

Remove all conflict markers. Search for the literal marker prefixes `<<<<<<<`, `=======`, and `>>>>>>>`; none should remain in `wiki/hot.md`.

- [ ] **Step 6: Validate merge resolution**

Run:

```powershell
git diff --check
git status --short
node -e "JSON.parse(require('fs').readFileSync('mira-hub/package.json','utf8')); console.log('package ok')"
```

Expected:
- `git diff --check` has no whitespace/conflict-marker errors.
- `package ok` prints.
- Only intentional resolved files remain staged/modified.

- [ ] **Step 7: Commit merge**

Run:

```powershell
git add mira-hub/package.json wiki/hot.md
git commit
```

Expected: merge commit completes.

---

### Task 2: Re-Prove #2307 Focused Behavior

**Files:**
- Verify: `mira-hub/src/app/api/contextualization/import/route.ts`
- Verify: `mira-hub/src/app/api/contextualization/import/__tests__/route.bundle.test.ts`
- Verify: `mira-hub/src/app/api/contextualization/import/import.integration.test.ts`
- Verify: `mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts`
- Verify: `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts`
- Verify: `mira-hub/scripts/setup-integration-db.mjs`
- Verify: `mira-hub/scripts/run-dev-integration-tests.mjs`

**Interfaces:**
- Consumes: resolved #2307 branch
- Produces: test evidence for PR body/status update

- [ ] **Step 1: Run focused unit test for legacy bundle import**

Run:

```powershell
cd mira-hub
npm test -- src/app/api/contextualization/import/__tests__/route.bundle.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run touched-file ESLint**

Run:

```powershell
npx eslint scripts/setup-integration-db.mjs scripts/run-dev-integration-tests.mjs src/app/api/contextualization/import/route.ts src/app/api/contextualization/import/__tests__/route.bundle.test.ts src/app/api/contextualization/import/import.integration.test.ts "src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts" src/lib/auth/__tests__/rls-deny.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS. Existing Next middleware/Turbopack/GAuth warnings are acceptable if unchanged.

- [ ] **Step 4: Run disposable DB integration path when Neon/Doppler is available**

Run:

```powershell
doppler run --project factorylm --config dev -- npm run test:integration:dev -- src/app/api/contextualization/import/import.integration.test.ts "src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts"
```

Expected: PASS for the contextualization import/review integration slice.

If Doppler/Neon is unavailable, record the exact blocker and do not claim DB integration proof.

- [ ] **Step 5: Run disposable-setup contract check**

Run:

```powershell
npm run test:integration:db
```

Expected: PASS only when a guarded disposable Neon branch/test DB env is configured. If it fails because no guarded test DB is configured, record that as environment-blocked, not code-failed.

- [ ] **Step 6: Do not rely on shared dev for the CMMS RLS deny suite**

Known constraint: shared dev Neon can lack `cmms_areas`/`cmms_sites`, and CMMS `tenant_id` typing differs from KG. Keep `src/lib/auth/__tests__/rls-deny.integration.test.ts` on the disposable branch path unless the shared dev schema is explicitly verified first.

---

### Task 3: Update PR #2307 and Make It Merge-Ready

**Files:**
- No product file changes unless Task 2 exposes a real failure.

**Interfaces:**
- Consumes: resolved/tested `codex/context-spine-db-integration`
- Produces: updated PR #2307, ready to review/merge if verification passes

- [ ] **Step 1: Push the resolved branch**

Run:

```powershell
git push origin codex/context-spine-db-integration
```

Expected: push succeeds and PR #2307 no longer reports conflicts after GitHub refreshes.

- [ ] **Step 2: Refresh PR state**

Run:

```powershell
gh pr view 2307 --json number,state,isDraft,mergeable,statusCheckRollup,url
```

Expected:
- `mergeable` is `MERGEABLE` or temporarily `UNKNOWN` while GitHub recalculates.
- No conflict state remains.

- [ ] **Step 3: Update PR body/comment with verification**

Run:

```powershell
gh pr comment 2307 --body "Merge unblock verification:
- Resolved conflicts with current main.
- Kept mira-hub package version 2.20.0 and added DB integration scripts.
- Preserved context-spine wiki hot-cache entries.
- Focused unit test: <PASS/FAIL details>
- Touched-file ESLint: <PASS/FAIL details>
- Build: <PASS/FAIL details>
- DB integration: <PASS/FAIL/BLOCKED details>"
```

Expected: PR has a clear, dated verification note.

- [ ] **Step 4: Mark ready only if verification is sufficient**

Run only if Task 2 has no unexplained failures:

```powershell
gh pr ready 2307
```

Expected: #2307 is no longer draft.

- [ ] **Step 5: Merge #2307 only after ready state and required checks**

Run only after explicit user approval or existing merge authorization is still current:

```powershell
gh pr merge 2307 --merge --subject "Merge PR #2307: Wire contextualizer imports into Hub DB spine" --body "Merge bottom context-spine DB integration PR into main."
```

Expected: #2307 merges to `main`.

---

### Task 4: Restack #2308 After #2307 Lands

**Files:**
- Usually no code changes.

**Interfaces:**
- Consumes: merged #2307
- Produces: #2308 rebased/retargeted to the correct base

- [ ] **Step 1: Refresh #2308 state**

Run:

```powershell
gh pr view 2308 --json number,state,isDraft,mergeable,baseRefName,headRefName,statusCheckRollup,url
```

Expected: #2308 remains open and mergeable.

- [ ] **Step 2: If #2308 still targets the now-merged branch, retarget or update**

If GitHub does not automatically handle the stacked base after #2307 merges, retarget #2308 to `main`:

```powershell
gh pr edit 2308 --base main
```

Expected: #2308 compares readiness checklist work against `main`.

- [ ] **Step 3: Re-run #2308 verification before merge**

Run the readiness checklist test commands from its PR body/plan, then mark ready and merge only if clean.

---

## Risk Notes

- `mira-hub/package.json` must not downgrade `main` from `2.20.0`.
- `wiki/hot.md` is documentation-only but conflict markers would be embarrassing and noisy; scan explicitly.
- Shared dev Neon is not the same as disposable integration Neon. Treat shared-dev CMMS/RLS failures as environment/schema mismatch unless reproduced on the disposable branch.
- CMMS and KG tenant columns are not interchangeable: KG uses UUID-typed `tenant_id`; CMMS tables may use text-typed `tenant_id` in known Hub visibility paths.

## Self-Review

- Spec coverage: this plan unblocks #2307, proves the DB/import harness, and preserves the current stacked PR order.
- Placeholder scan: no `TBD`, `TODO`, or unspecified test commands remain.
- Type consistency: commands and file paths match the current #2307 diff and current conflict surface.
