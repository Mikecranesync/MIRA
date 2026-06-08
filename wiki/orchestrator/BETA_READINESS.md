# MIRA Beta Readiness Scorecard

North Star: a stranger signs up on app.factorylm.com, uses MIRA's grounded chat, and nothing breaks, leaks, or lies.
Legend: 🟢 GREEN ready · 🟡 YELLOW gaps · 🔴 RED blocker · ⬜ UNKNOWN never audited

| Lens | Status | Last audited | Top finding | Next action |
|---|---|---|---|---|
| A. Hub security & auth | 🟡 YELLOW | 2026-06-07 | `/api/quickstart/ask` is a public, unauthenticated LLM endpoint with **no rate limit** → a stranger can drain the shared free-tier cascade (Groq→Cerebras→Gemini) for all users. Core authz is otherwise sound (`sessionOr401` + `withTenantContext` RLS dropping BYPASSRLS via `SET LOCAL ROLE`). | Apply `patches/2026-06-07-quickstart-rate-limit.patch` (IP-hash limiter, reuses the `/api/public/report` pattern). |
| B. Hub functional readiness | 🟡 YELLOW | 2026-06-08 | Canonical-source drift on the proposal queue: spec §357 + glossary say `/proposals` renders `ai_suggestions` (mig 027 shipped), but `/api/proposals` reads `relationship_proposals` directly and its own comment disclaims the spec. Prod `tsc` clean — all 9 type errors are in test files. | Founder decision: crown `ai_suggestions` (per spec) or amend spec+glossary to crown `relationship_proposals`; then build `proposal-transition.ts` (ADR-0017 helper, still missing). |
| C. Engine integrity | ⬜ UNKNOWN | never | — | Audit UNS chat-gate bypass + direct-connection rejection contract in `mira-bots/shared/engine.py`. |
| D. Eval & test health | ⬜ UNKNOWN | never | — | Read latest offline scorecard (46/57, 81% per hot.md 2026-06-07); name failure clusters; flag gate/citation/safety ones. |
| E. Promotion pipeline | ⬜ UNKNOWN | never | — | Check `docker-compose.staging.yml` (TODO?), smoke-test hub-route coverage, migration head consistency. |
| F. Beta-blocker ledger | ⬜ UNKNOWN | never | — | Synthesize known-issues + hot.md + master-plan into ranked top-10. |

## Lens B — detail (2026-06-08)

**Verdict: YELLOW.** The hub ships the spec'd surfaces and production code typechecks clean; the gaps are a data-contract drift and test debt, not broken functionality.

What's solid:
- **Typecheck:** `tsc --noEmit` → ZERO errors in production `src/` code. All 9 errors confined to tests: `namespace/tree/route.test.ts` ×6 (stale `EntityFixture` missing `files_count`/`equipment_status` after schema columns were added), `rls-deny.integration.test.ts` (unused `@ts-expect-error`), `command-center-freshness.test.ts` + `workflow.test.ts` (`bun:test` types unresolved under tsc — bun/vitest toolchain mix).
- **Spec surfaces exist:** `/api/readiness` + `/readiness/recalculate` (health_scores, L0–L6), `/api/proposals` + `[id]/decide`, `/api/namespace/{tree,node,path,files}`, `/api/wizard/[step]`, quickstart routes — matching spec §"Hub UI surfaces".
- **Decide route is disciplined:** status guard (`proposed|reviewed|needs_review` only), `SELECT … FOR UPDATE` row lock, tenant-scoped, kg_relationships mirror writes `approval_state='verified'` with provenance (`relationship_proposal_id`, COALESCE keeps first link). ADR-0017 transitions are honored in practice on this route.
- 35 unit-test files in `src/`; `api-unauth-returns-401.spec.ts` guards the auth perimeter; signup-flow + smoke + command-center (local webServer) Playwright configs all present.

Findings (ranked):
1. **[BETA-RISK — data-contract drift] `/api/proposals` vs spec/glossary.** Spec §357 defines `ai_suggestions` as the queue the `/proposals` surface renders ("N proposals pending" counts it; 6 suggestion_types); migration `027_ai_suggestions.sql` shipped the table. But the route reads `relationship_proposals` directly and its comment asserts that's canonical, "NOT a duplicate ai_suggestions table." Only kg_edge-type suggestions can ever surface, and spec §658's event-driven readiness recalc (triggered on `ai_suggestions` status change) can't fire from this path. Needs an explicit decision, not a silent winner.
2. **[MEDIUM] ADR-0017 helper still missing.** `mira-hub/src/lib/proposal-transition.ts` + `mira_bots/shared/proposal_transition.py` don't exist; transitions are hand-rolled (correctly, today) in `decide/route.ts` and `namespace/node/[id]/route.ts` + `uns-backfill.ts`. Each new write-path multiplies drift risk.
3. **[MEDIUM] Playwright gaps:** no e2e covers the proposals decide flow or readiness recalculation; default `playwright.config.ts` baseURL is **production** app.factorylm.com (e2e on prod by default); ~20 one-off `proof-pr-*.spec.ts` files are historical noise that obscure living coverage.
4. **[LOW] Test-fixture rot** (the 9 tsc errors) — will bite any CI step that typechecks tests.

KG insight (graph query this run): all 106 hub API route files in the graph are connected (zero orphaned routes — no dead surface area), and the `proposals` cluster's data edges go exclusively to `relationship_proposals`; `ai_suggestions` has exactly one referencing symbol in all of `src/` (a comment). The spec's central queue table is, in code terms, write-only infrastructure.

Prod note: `app.factorylm.com/api/health` responded to a GET this run (no error) — the 06-04 CI 502 may be transient/resolved; re-verify in CI before closing.

## Lens A — detail (2026-06-07)

**Verdict: YELLOW.** The authorization architecture is correct and intentional, not accidental. The blocker is one abuse surface, not a broken model.

What's solid:
- `sessionOr401()` decodes the next-auth JWE directly from the cookie store (works around Next 16 async-headers breakage) — consistent across most routes.
- `withTenantContext()` does the right thing: `SET LOCAL ROLE factorylm_app` (no BYPASSRLS) + transaction-local `app.tenant_id`/`app.current_tenant_id`, so RLS tenant_isolation is actually enforced and scoped per-transaction.
- Hardcoded-secret scan over `src/**/*.ts` (excluding tests): **clean** — secrets read from `process.env`.
- Service-to-service routes are token-gated: `/api/internal/kg` (`INTERNAL_KG_API_KEY`, 401/503), `/api/uploads/folder` (`HUB_INGEST_TOKEN` + UUID-validated tenant header).
- `/api/public/report` (intentionally public) is rate-limited by IP hash (5/IP/hr) and bounds input length — the right template for other public routes.

Findings (ranked):
1. **[BETA-BLOCKER] `/api/quickstart/ask` — public LLM, no rate limit.** Caps question length (1000 chars) but nothing throttles request volume. Anonymous POSTs each fire a `cascadeComplete` (700 tok, 20s). A script exhausts the free-tier providers for the whole beta cohort, or runs up cost. Retrieval is correctly tenant-scoped via `withTenantContext(quickstartTenantId())`. Fix = port the `/api/public/report` IP-hash limiter. Patch attached.
2. **[MEDIUM — tenant-scope drift] `/api/documents`.** Uses raw `pool` (RLS-bypass) and the `knowledge_entries` query has **no tenant filter**, despite the route comment asserting it "stays scoped to the caller's tenant." The `cmms_equipment WHERE id = $1` lookup is also not tenant-filtered, so an authenticated user can resolve any asset's manufacturer/model by id. `knowledge_entries` may be a deliberately universal corpus (as `/api/knowledge` states), but the comment/implementation drift should be resolved explicitly — either filter by tenant or update the contract.
3. **[LOW — confirm intent] raw-pool routes without tenant refs:** `/api/knowledge/stats|growth|manufacturer` read the universal corpus (documented), acceptable. Re-confirm none expose per-tenant rows.

KG insight (from this run's graph): of 11 fully-public (no-auth) hub routes, only `/api/public/report` both bypasses RLS *and* is public — and it is rate-limited and intentionally RLS-exempt. So the public attack surface that touches tenant data directly is small; the real public exposure is the **LLM/compute** surface (`quickstart/ask`, `mira/ask`), which authz alone doesn't cover.
