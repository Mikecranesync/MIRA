## Why

The cowork run shipped 14 feature branches and zero automated tests. Each AGENT_NOTES had a "manual smoke test" section instead. The follow-up fix work (10 fixes) shipped 86 unit + 9 integration test files alongside the patches — but they don't run because vitest isn't in `devDependencies`.

This issue tracks getting the test runner installed (covered by the npm-deps issue), then adding a per-branch baseline that proves the basics work before any future CI gate.

## Source

- `docs/competitors/cowork-gap-report-2026-04-25.md` §3.4
- `docs/competitors/pre-merge-review-2026-04-25.md` §1 (universal blocker #2)
- `docs/competitors/fix-execution-report-2026-04-25.md` (test-files-shipped-as-code list)
- `docs/competitors/auth-sweep/04-rls-deny.test.ts` (the model integration test)

## Acceptance criteria

### Foundation (lands with auth-sweep PR on #578)

- [ ] `vitest` + `@vitest/expect` in `mira-hub/devDependencies`
- [ ] `mira-hub/package.json` `scripts`:
  ```json
  {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --testTimeout 30000 '**/*.integration.test.ts'"
  }
  ```
- [ ] `vitest.config.ts` at hub root with NeonDB-friendly defaults (single fork, 30s test timeout for integration tests)
- [ ] `.github/workflows/hub-test.yml` running `cd mira-hub && npm install && npm test` on every push to `agent/issue-*` or `main`
- [ ] Documented in `mira-hub/AGENTS.md` — section "Running tests" with the docker-postgres setup steps copied from the auth-sweep runbook

### Per-feature-branch baseline (one PR each, post-rebase)

For each branch, the test files are already committed as part of the fix series. Verify:

- [ ] **#562**: `src/lib/cmms/__tests__/hierarchy.test.ts` — 9 tests pass
- [ ] **#565**: `src/lib/work-orders/__tests__/state-machine.test.ts` — 19 tests pass
- [ ] **#568**: integration test for seed re-run idempotency (write fresh — patterned in `docs/competitors/fixes/08-568-idempotent-seed.md`)
- [ ] **#574**: `src/lib/__tests__/safety.test.ts` (14) + `pii.test.ts` (15) + `llm-keys.test.ts` (9) — 38 tests pass
- [ ] **#576**: `src/app/api/v1/webhooks/cron/__tests__/route.test.ts` — 7 tests pass (statistical timing test allowed to flake at <1% rate; document threshold)
- [ ] **#578**: `src/lib/auth/__tests__/route-helpers.test.ts` (8) + `rls-deny.integration.test.ts` (8) — 16 tests pass
- [ ] **#579**: `src/lib/auth/sso/__tests__/jit.test.ts` — 6 tests pass
- [ ] Every other feature branch (#566, #563/#564/#567, #569/#570/#571, #572/#573, #575): at least one smoke test asserting the migration applies + one happy-path test of a route handler.

### CI gating

- [ ] Tests run on every push to a feature branch (no merge-to-main if they fail)
- [ ] Integration tests run on the PR-to-main flow with an ephemeral Postgres service (use the GitHub Actions `services:` block with `postgres:16`)
- [ ] Coverage is reported but NOT gated (avoid coverage theatre while the suite is small)

### Out of band

- [ ] Track flaky tests in a `tests/flaky.md` so the team has a single place to look. The cron timing test is the only known flaky candidate — document the expected failure rate and what to do when it happens (re-run, vs. real regression).

## Dependency order

- Blocks on **npm-deps install issue** (vitest must exist).
- Phase 1 (foundation) can land alongside #578.
- Phase 2 (per-branch baseline) happens in the same PR as each feature branch's auth-sweep commit.

## Out of scope

- Full e2e coverage with Playwright — already partially covered by `mira-hub/tests/e2e/`. Track separately.
- Performance regression tests — separate ops concern.
- Mutation testing / property-based testing — far future.
