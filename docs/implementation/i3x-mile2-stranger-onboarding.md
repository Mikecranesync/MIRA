# i3X Mile 2 — "A Stranger Factory Can Hook Up" (Roadmap + Phase 1 Plan)

**Status:** Roadmap + detailed Phase-1 plan (key issuance). No code yet.
**Date:** 2026-06-16
**Context:** Mile 1 (the read-only i3X API server) is **deployed and verified** — `GET https://app.factorylm.com/api/i3x/v1/info` → 200 public; authed routes 401 in the i3X shape. PRs #2027 (server) + #2038 (middleware bypass) merged. What mile 1 does NOT do: let a *stranger* factory get data in and become queryable context. That is mile 2.

> **The mile-2 thesis:** mile 1 built the *output* (read API). Mile 2 builds the *first mile* — the path from a cold factory's messy data to trustworthy, queryable i3X context. The very first task is **key issuance**, because without a sanctioned way to mint a prod API key, nothing else in mile 2 is end-to-end testable in prod either.

---

## Roadmap (sequenced; each phase is its own plan when reached)

| Phase | Delivers | Why this order | Plan |
|---|---|---|---|
| **1. Key issuance** | Apply migration 054 to prod; an admin-gated mint endpoint that issues a tenant-scoped i3X bearer key (hash stored, plaintext shown once) | Nothing is end-to-end testable in prod without a key; unblocks verifying every authed endpoint | **This doc, below** |
| **2. Tenant / factory provisioning** | A first-class "create a factory tenant" flow (tenant row + UNS root + initial `approved_tags` scaffold + a key) | A stranger needs a tenant to own their data, keys, and UNS subtree | separate plan |
| **3a. Ignition-first ingestion** | Documented + hardened `mira-relay /api/v1/tags/ingest` on-ramp + the "MIRA Connect" activation wired to a new tenant; allowlist seeding UX | Fastest real on-ramp; reuses existing relay; chosen first by Mike | separate plan |
| **3b. OPC UA ingestion** | Read-only OPC UA → raw-capture adapter (gap G8), or front with CESMII `OPCUA-i3X` + the Python client | Broadens reach to any OPC-UA plant without Ignition | separate plan |
| **4. Namespace-builder onboarding** | Manuals/CSV → AI proposals → human approval → verified `kg_entities` (the context the i3X server exposes) | i3X only serves `approval_state='verified'`; this produces it | reuse existing namespace-builder |
| **5. Classification** | First-class `signal_class` (command/feedback/fault/analog…) on signals → richer i3X ObjectTypes (gap G5) | Makes objects typed, not bare strings | separate plan |
| **6. Subscriptions** | `/subscriptions/*` (create/register/sync/list/delete) → "Full 1.0" conformance | A MUST for full i3X; lifts us above "1.0 Compatible (read/query)" | separate plan |

**Definition of "a stranger could hook up" (the mile-2 finish line):** a new factory can (1) get a tenant + key, (2) stream/expose their tags via Ignition (then OPC UA), (3) build verified UNS context via onboarding, and (4) have an i3X consumer (the CESMII MCP server / Explorer) read their typed objects + live values with that key.

---

## Key-issuance mechanism — DECIDED: self-serve (2026-06-16, Mike)

**Self-serve at signup / settings.** A logged-in tenant mints its OWN i3X key from the Hub settings area (`mira-hub/src/app/(hub)/settings/*` — fits under a new `settings/api-keys` or within `settings/security`/`integrations`). This is the true "stranger can hook up" answer. The mint endpoint is **session-gated to the caller's own tenant** (NOT admin-only, NOT in the i3x middleware bypass — a logged-in user mints their own key). There is no existing `public_api_keys` table; `i3x_api_keys` (migration 054) is the store.

Prod migration 054: **Mike reviews the dry-run Summary, then I apply** (decided 2026-06-16).

---

## Phase 1 — Key Issuance (detailed plan)

**Goal:** make the deployed i3X server actually usable by minting a tenant-scoped bearer key, via a sanctioned (no psql-to-prod) admin path, with migration 054 applied to prod.

**Tech stack:** TypeScript, Next.js App Router, vitest, `node:crypto`, `@/lib/db` (pg Pool), `@/lib/session` (admin gate), `withTenantContext`. Reuses `@/lib/i3x/auth.ts` `hashKey`.

### Pre-req (operator step, needs Mike's go): apply migration 054 to prod
- `054_i3x_api_keys.sql` is on `main` but **not applied to prod** (held — the apply-migrations plan is only in the GitHub run *web summary*, and prod migrations are manual). 
- **Action:** run `apply-migrations.yml target=staging mode=dry-run` → review the **run Summary page** plan → `mode=apply` → verify → `target=prod mode=dry-run` → **confirm the Summary shows only the expected additive files** → `mode=apply`. The table is `CREATE TABLE IF NOT EXISTS` (idempotent, additive, zero data risk).
- **Do NOT** psql-seed a key. Keys come from the endpoint below.

### Task 1.1 — Key generator helper (TDD, pure)
**Files:** create `mira-hub/src/lib/i3x/key.ts` + `key.test.ts`
- `generateApiKey(): { plaintext: string; hash: string }` — plaintext = a prefixed random token (e.g. `mira_i3x_` + 32 bytes base64url from `node:crypto.randomBytes`); `hash = hashKey(plaintext)` (reuse `@/lib/i3x/auth`). 
- Tests: plaintext has the `mira_i3x_` prefix + sufficient entropy length; `hash` matches `hashKey(plaintext)` and is 64-hex; two calls differ (vary by calling twice — randomBytes differs).
- TDD: write `key.test.ts` red → implement → green.

### Task 1.2 — Admin mint endpoint (TDD via handler unit test + middleware allowlist note)
**Files:** create `mira-hub/src/app/api/admin/i3x-keys/route.ts` + a handler test
- `POST` — `sessionOr401()` first; then require admin (reuse the Hub's existing admin check — find it: grep `isAdmin`/role in `@/lib/session` or existing admin routes; do NOT invent one). Body: `{ label?: string }`. Uses the caller's `tenantId` (or an explicit `tenantId` if the admin model allows cross-tenant — default to caller's tenant). Calls `generateApiKey()`, INSERTs `{tenant_id, key_hash, label, enabled:true}` into `i3x_api_keys` via `withTenantContext(tenantId, c => c.query(INSERT ...))`, returns `{ key: plaintext, id, label }` **once** (never re-retrievable).
- **Middleware:** `/api/admin/*` stays gated by the session middleware (it SHOULD require a session) — do NOT add it to the i3x matcher bypass. Confirm `/api/admin` is matched (gated) by the middleware.
- Tests: unit-test the handler with mocked `sessionOr401` (admin → mints; non-admin → 403; no session → 401) and a fake `withTenantContext` (assert the INSERT params: hash not plaintext, enabled=true, tenant bound). Assert the response returns the plaintext exactly once and that what's stored is the hash.
- **Do NOT log the plaintext key.**

### Task 1.3 — Minimal Hub UI affordance (optional in Phase 1; can defer to 1.4)
**Files:** a small admin settings control that POSTs to the endpoint and shows the key once with a copy button + "store it now, it won't be shown again" warning. (If deferring, the endpoint + `curl` is enough to mint for testing.) Screenshot rule applies if UI ships.

### Task 1.4 — End-to-end prod verification (the payoff)
After 054 is applied and the endpoint is deployed:
1. Mint a key for a test tenant (via the endpoint, as an admin).
2. `curl -H "Authorization: Bearer <key>" https://app.factorylm.com/api/i3x/v1/namespaces/` → **200** with the namespace list (proves bearer auth + a real authed read works end-to-end in prod).
3. `curl …/objects/` with the key → 200 (likely empty `result:[]` until a tenant has verified entities — which is Phase 4). That empty-but-200 is the correct, honest state: auth works; data awaits onboarding.
4. Point the **CESMII i3X MCP server** at `https://app.factorylm.com/api/i3x/v1` with `I3X_AUTH_SCHEME=bearer I3X_TOKEN=<key>` and confirm `server_info` + `search_objects` connect.

### Risks / what NOT to do
- ❌ No psql-to-prod for keys — mint only via the endpoint (sanctioned app write).
- ❌ Don't store or log plaintext keys; store only the hash; show plaintext once.
- ❌ Don't add `/api/admin/*` to the i3x middleware bypass — admin must stay session-gated.
- ❌ Don't bypass the prod-migration dry-run review — confirm the Summary plan first.
- ⚠️ Reuse the Hub's existing admin-authorization check; do not invent a new role model (grep first).
- ⚠️ Bump `/VERSION` (required) + `mira-hub/package.json` (convention) on the code PR.

### Phase-1 Definition of Done
- Migration 054 applied to prod (dry-run reviewed → apply).
- `generateApiKey` + mint endpoint shipped, tested (admin gate + hash-only storage proven).
- A real key mints and authenticates a live `…/namespaces` 200 in prod.
- The CESMII i3X MCP server connects to MIRA with that key.
- Honest state recorded: auth + read path work end-to-end; **data** is empty until onboarding (Phase 4).
