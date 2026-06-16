# Auth-sweep — runbook

You're going to apply this in two phases: foundation on #578, then per-branch
codemod runs as each feature branch rebases.

**Estimated work:** 4–6 hours of focused effort. Tests are the slowest part.

---

## Files in this directory

| File | What it is | Lands as |
|---|---|---|
| `00-runbook.md` | this file | not committed |
| `01-route-helpers.ts` | `withSession` / `withSessionAndRole` / `withOptionalSession` wrapper | `mira-hub/src/lib/auth/route-helpers.ts` on **#578** |
| `02-codemod.mjs` | regex-based sweep (refuses on ambiguity) | `tools/auth-sweep/sweep.mjs` on **#578** |
| `03-route-helpers.test.ts` | unit tests for the wrapper | `mira-hub/src/lib/auth/__tests__/route-helpers.test.ts` on **#578** |
| `04-rls-deny.test.ts` | integration tests proving RLS denies cross-tenant | `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts` on **#578** |
| `05-example-conversion.md` | worked before/after for one #574 route | reference only |

---

## Phase 1 — land foundation on #578 (one PR)

This PR doesn't change route behavior. It adds reusable infrastructure that
every other branch will pick up on rebase.

```bash
# from your MIRA worktree
git switch agent/issue-578-multi-tenancy-0445

# 1. Drop in the route helpers (file 01)
cp docs/competitors/auth-sweep/01-route-helpers.ts \
   mira-hub/src/lib/auth/route-helpers.ts

# 2. Drop in the codemod (file 02)
mkdir -p tools/auth-sweep
cp docs/competitors/auth-sweep/02-codemod.mjs \
   tools/auth-sweep/sweep.mjs
chmod +x tools/auth-sweep/sweep.mjs

# 3. Drop in the tests (files 03 + 04)
mkdir -p mira-hub/src/lib/auth/__tests__
cp docs/competitors/auth-sweep/03-route-helpers.test.ts \
   mira-hub/src/lib/auth/__tests__/route-helpers.test.ts
cp docs/competitors/auth-sweep/04-rls-deny.test.ts \
   mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts

# 4. Wire vitest if it isn't already
cd mira-hub
npm install -D vitest @vitest/expect
# Add to package.json scripts:
#   "test": "vitest run",
#   "test:watch": "vitest",
#   "test:integration": "TEST_DATABASE_URL=$TEST_DATABASE_URL vitest run --testTimeout 30000 '**/*.integration.test.ts'"

# 5. Run the unit tests — should pass
npx vitest run src/lib/auth/__tests__/route-helpers.test.ts

# 6. Spin a Postgres for the integration test, apply migrations, run it
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name mira-rls-test postgres:16
sleep 3
psql postgres://postgres:test@localhost:5433/postgres \
  -f db/migrations/2026-04-24-003-asset-hierarchy.sql \
  -f db/migrations/2026-04-24-008-tenants-rls.sql
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
  npx vitest run src/lib/auth/__tests__/rls-deny.integration.test.ts
docker stop mira-rls-test

# 7. ⚠️ One of the rls-deny tests will FAIL: "audit log is append-only".
#    That's deliberate — it's a TODO test for the audit-log immutability fix
#    flagged in pre-merge-review-2026-04-25.md (#578 finding).
#
#    Options:
#      a) Land that fix in this PR — split the tenant_audit_log policy into
#         FOR INSERT WITH CHECK (...) and FOR SELECT USING (...). 30-line edit.
#      b) Skip the test with .skip and file a follow-up issue — NOT recommended,
#         since the test is what proves the fix is correct.

# 8. Commit
cd ..  # back to repo root
git add mira-hub/src/lib/auth/route-helpers.ts \
        mira-hub/src/lib/auth/__tests__/ \
        tools/auth-sweep/
# also commit the audit-log policy split if you went option (a) above
git commit -m "feat(hub): auth-sweep foundation — route helpers + RLS deny test (#578)

Adds:
- src/lib/auth/route-helpers.ts: withSession / withSessionAndRole /
  withOptionalSession wrappers around requireSession + HttpAuthError →
  NextResponse translation.
- tools/auth-sweep/sweep.mjs: regex codemod for converting feature
  branches off the x-tenant-id header stub. Refuses on any ambiguous
  pattern (pool.connect, multi-query handlers) so it can't silently
  mis-rewrite.
- src/lib/auth/__tests__/route-helpers.test.ts: vitest unit tests for
  the wrapper (8 cases).
- src/lib/auth/__tests__/rls-deny.integration.test.ts: integration test
  proving RLS denies cross-tenant SELECT/UPDATE/INSERT and that
  withTenant rolls back on error. The test that should have shipped
  with the original #578."
```

**Verification before opening the PR:**

- [ ] `npx tsc --noEmit -p mira-hub` passes
- [ ] `npx eslint mira-hub/src --max-warnings 0` passes
- [ ] All unit tests pass
- [ ] Integration tests pass (audit-log test passes after the policy split, OR is documented as intentionally skipped pending the fix)
- [ ] `tools/auth-sweep/sweep.mjs --help` (n/a here — but verify the script is executable)
- [ ] `grep -r 'getTenantContext' mira-hub/src` returns 0 hits (the helper isn't on this branch yet — codemod runs per-feature-branch in Phase 2)

---

## Phase 2 — per-feature-branch sweep (run per branch on rebase)

Once Phase 1 is on main (or merged into the feature branches' base), do
this **per branch** in the recommended merge order from
`pre-merge-review-2026-04-25.md` §7:

```bash
# Example for #562 — repeat for each branch
git switch agent/issue-562-asset-hierarchy-0405
git rebase main         # picks up Phase 1's helpers + codemod

# Run the codemod
node tools/auth-sweep/sweep.mjs mira-hub/src/app/api

# Inspect the diff. The codemod is conservative — anything weird went to:
cat tools/auth-sweep/manual-review.txt

# For each file in manual-review.txt, convert by hand using the pattern in
# docs/competitors/auth-sweep/05-example-conversion.md.

# Run static checks
cd mira-hub
npx tsc --noEmit -p .
npx eslint src --max-warnings 0

# Run unit tests
npx vitest run

# Run integration tests against a fresh DB with this branch's migration applied
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name mira-test postgres:16
sleep 3
for m in db/migrations/*.sql; do
  psql postgres://postgres:test@localhost:5433/postgres -f "$m"
done
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
  npx vitest run --testTimeout 30000 '**/*.integration.test.ts'
docker stop mira-test
cd ..

# Commit per-branch
git add -A
git commit -m "chore(hub): apply auth-sweep — replace x-tenant-id stubs with withTenant()

Mechanical conversion via tools/auth-sweep/sweep.mjs. N routes converted,
M files in manual-review.txt converted by hand (see commit body).

Refs #578."

# Open the PR (or update an existing one)
gh pr create --base main --head agent/issue-562-asset-hierarchy-0405 \
  --title "feat(hub): site → area → asset → component hierarchy (#562)" \
  --body-file mira-hub/AGENT_NOTES_562.md
```

---

## Per-branch order (binding — each depends on prior)

From `pre-merge-review-2026-04-25.md` §7. Apply Phase 2 in this order:

1. `agent/issue-562-asset-hierarchy-0405`
2. `agent/issue-568-failure-codes-iso14224-0405` (fix seed idempotency first)
3. `agent/issue-565-wo-lifecycle-0405` (fix force-skip timestamp invariant first)
4. `agent/issue-566-pm-procedures-0405` (`npm install rrule` first)
5. `agent/issue-574-byo-llm-asset-chat-0331` (KEK rotation + SSE cancel + safety NFKC; manually convert chat/route.ts which uses pool.connect)
6. `agent/issue-576-outbound-webhooks-0331` (verify timing-safe cron; replay tenant scope)
7. `agent/issue-579-sso-saml-oidc-0445` (move sso/* libs from #578; add XXE test)
8. `agent/p2-batch-563-564-567-0903`
9. `agent/p2-batch-569-570-571-0903`
10. `agent/p2-batch-572-573-0903`
11. `agent/issue-575-mobile-pwa-0445`
12. `agent/issue-577-api-reference-0445` (docs only — no codemod needed)
13. `agent/issue-580-soc2-kickoff-0903` (docs only — no codemod needed)

---

## What the codemod will NOT touch (manual conversion required)

The codemod is intentionally conservative. It refuses these patterns and
logs them to `tools/auth-sweep/manual-review.txt`:

1. **`pool.connect()` users** — handlers that hold a checkout across multiple
   statements (e.g. transactions, SSE streams). Convert by replacing the
   `pool.connect()` block with `withTenant(session, async (client) => { ... })`.
2. **`withServiceRole` already used** — cron handlers and worker entry points.
   These should not be touched; they intentionally bypass tenant scope.
3. **Helper functions referencing `pool`** — e.g. `async function fetchAsset(id)`
   that takes the pool implicitly. Convert by passing the `client` from
   `withTenant` as an argument.
4. **Multi-query handlers** — anything with more than one `pool.query` call
   in the same handler. The codemod can't reason about the wrap boundary.

Expected count, eyeballed from the cowork branches:

| Branch | Codemod-converted | Manual review |
|---|---|---|
| #562 | ~10 routes | 0 |
| #565 | ~12 routes | 1 (transition has multi-query + audit log) |
| #566 | ~6 routes | 1 (spawn worker uses pool.connect) |
| #568 | ~6 routes | 0 |
| #574 | ~8 routes | 1 (chat SSE route uses pool.connect) |
| #576 | ~7 routes | 2 (worker + cron handler) |
| P2 batches | ~30 routes | ~4 |

Total manual conversions: 9–10 across all branches. ~30 minutes each at the
slow end.

---

## Rollback

If the sweep produces something hostile, recovery is local:

```bash
# Revert just the codemod's changes on a branch
git diff HEAD~1 -- mira-hub/src/app/api  # confirm scope
git checkout HEAD~1 -- mira-hub/src/app/api
git commit -m "revert: auth-sweep on this branch"
```

The Phase 1 foundation (route-helpers, tests) is independent and stays.

---

## After all branches sweep

A final clean-up issue worth filing:

- [ ] Remove the `mira.tenant_id` GUC fallback `OR current_setting('mira.role') = 'service'` from the policies. Once every worker uses `withServiceRole` explicitly, the policy can be tightened to a single condition. Track in a follow-up post-merge.
