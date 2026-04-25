## Why

Every cowork branch ships routes that read `tenant_id` from an `x-tenant-id` HTTP header (a stub) instead of from a real session. ~80 routes across 13 branches, each with a `function getTenantContext(req: Request)` local helper tagged `// TODO(#578)`. Once #578's strict-mode RLS flips on, every one of these returns 401 or worse — RLS denies the row visibility because `mira.tenant_id` is never set.

This issue tracks the bulk conversion of those stubs to use `requireSession()` + `withTenant()` from `src/lib/auth/session.ts`.

The foundation work + a regex-based codemod are already in `docs/competitors/auth-sweep/` — drop-in lib, codemod script, unit tests, and the RLS-deny integration test that #578 should have shipped with.

## Source

- `docs/competitors/auth-sweep/00-runbook.md` — two-phase apply procedure
- `docs/competitors/auth-sweep/01-route-helpers.ts` — `withSession` wrapper
- `docs/competitors/auth-sweep/02-codemod.mjs` — regex sweep (refuses on ambiguity)
- `docs/competitors/auth-sweep/03-route-helpers.test.ts` — 8 unit tests
- `docs/competitors/auth-sweep/04-rls-deny.test.ts` — 8 integration tests
- `docs/competitors/auth-sweep/05-example-conversion.md` — worked before/after

## Acceptance criteria

### Phase 1 — foundation on #578

- [ ] `mira-hub/src/lib/auth/route-helpers.ts` (file 01) committed
- [ ] `tools/auth-sweep/sweep.mjs` (file 02) committed and chmod +x
- [ ] `mira-hub/src/lib/auth/__tests__/route-helpers.test.ts` (file 03) — 8 tests pass
- [ ] `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts` (file 04) — 8 tests pass against ephemeral Postgres
- [ ] **Audit-log immutability test (case 8) verified passing** — confirms the existing trigger holds (note: this was a false-alarm in the original review; trigger already exists)

### Phase 2 — per-feature-branch sweep

For each branch in the merge order from `pre-merge-review-2026-04-25.md` §7:

- [ ] `agent/issue-562-asset-hierarchy-0405` — ~10 routes
- [ ] `agent/issue-565-wo-lifecycle-0405` — ~12 routes (manual on transition route — multi-query)
- [ ] `agent/issue-566-pm-procedures-0405` — ~6 routes (manual on spawn worker — pool.connect)
- [ ] `agent/issue-568-failure-codes-iso14224-0405` — ~6 routes
- [ ] `agent/issue-574-byo-llm-asset-chat-0331` — ~8 routes (manual on chat SSE — pool.connect)
- [ ] `agent/issue-576-outbound-webhooks-0331` — ~7 routes (manual on worker + cron)
- [ ] `agent/issue-579-sso-saml-oidc-0445` — admin SSO config routes
- [ ] `agent/p2-batch-563-564-567-0903` — ~10 routes
- [ ] `agent/p2-batch-569-570-571-0903` — ~12 routes
- [ ] `agent/p2-batch-572-573-0903` — ~12 routes
- [ ] `agent/issue-575-mobile-pwa-0445` — ~5 routes

### Per-branch verification

- [ ] `grep -r 'getTenantContext' mira-hub/src` returns 0 hits
- [ ] `grep -r 'x-tenant-id' mira-hub/src/app/api` returns 0 hits
- [ ] `npx tsc --noEmit -p mira-hub` passes
- [ ] `npx eslint mira-hub/src --max-warnings 0` passes
- [ ] `npx vitest run` passes (depends on the npm-deps-install issue)

## Dependency order

- Phase 1 lands on **#578** as part of #578's PR (or as a follow-up commit on `main` after #578 merges).
- Phase 2 happens **per feature branch on rebase** — each PR includes its own sweep commit. The sweep can't be a single cross-branch PR because the routes only exist on their feature branches.
- Hard dep: this issue is blocked by **#578** (`agent/issue-578-multi-tenancy-0445`) until that branch lands the `withTenant()` helper.

## Codemod expectations (from the runbook)

| Branch | Auto | Manual |
|---|---|---|
| #562 | ~10 | 0 |
| #565 | ~12 | 1 (transition has multi-query + audit log) |
| #566 | ~6 | 1 (spawn worker uses pool.connect) |
| #568 | ~6 | 0 |
| #574 | ~8 | 1 (chat SSE route uses pool.connect) |
| #576 | ~7 | 2 (worker + cron handler) |
| P2 batches | ~30 | ~4 |
| #575 | ~5 | 0 |

Total ~95 auto-converted, ~9 manual at ~30 min each.

## Out of scope

- Adding rate limiting / lockout to the login route (see separate issue).
- Implementing the SSO library wiring (depends on the npm-deps-install issue).
- Removing the tenant-bypass `OR current_setting('mira.role') = 'service'` clause from the RLS policies (post-merge cleanup).
