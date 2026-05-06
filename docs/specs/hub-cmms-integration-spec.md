# Hub ↔ Atlas CMMS Integration Spec

**Status:** AUDIT — current state + gap analysis. NOTHING built from this doc yet.
**Audit date:** 2026-05-06
**Author:** Claude (CHARLIE node) for Mike
**Branch:** `claude/trusting-antonelli-c398ab`
**Scope:** Two domains the user expects to feel like one product:
  - `app.factorylm.com` — `mira-hub` (Next.js, NeonDB-backed)
  - `cmms.factorylm.com` — Atlas CMMS (vendored Spring Boot + React, own Postgres on port 5433)

> **Mike's expectation (verbatim):**
> 1. Create an asset in the hub → it appears in Atlas CMMS
> 2. Create a work order in Atlas → it appears in the hub
> 3. All fields sync both ways
> 4. He can click from the hub to Atlas and back seamlessly
>
> **Reality:** None of (1), (2), (3) work today. Only one piece of (4) is wired — and that link is broken (uses the wrong ID).

---

## TL;DR

| Mike's expectation | Reality today |
|---|---|
| Create asset in hub → appears in Atlas | ❌ Hub writes only to NeonDB `cmms_equipment`. Zero Atlas write. |
| Create WO in Atlas → appears in hub | ❌ Hub reads only NeonDB `work_orders`. No pull from Atlas. |
| All fields sync both ways | ❌ No sync layer exists. Two independent UUID namespaces, no `atlas_id` column. |
| Click hub → Atlas seamlessly | ⚠️ One "Open in CMMS" link on `/workorders/[id]`, but the URL uses the **NeonDB** UUID — Atlas will 404. The `/cmms` page deep-links to Atlas index pages only (no per-record). |
| Click Atlas → hub | ❌ Atlas has no link back to the hub. Anywhere. |
| SSO between the two | ❌ Three independent JWT secrets (`AUTH_SECRET`, `PLG_JWT_SECRET`, `ATLAS_JWT_SECRET`). Atlas explicitly has `ENABLE_SSO: "false"`. User must log in twice. |

The only live integration is **read-only stats**: `GET /api/cmms/stats` calls Atlas with admin creds and aggregates 5 counts. That's the entire integration surface today.

---

## Section 1: Current State (what actually works today)

### 1.1 Hub `/assets` page

**File:** `mira-hub/src/app/(hub)/assets/page.tsx` (list), `mira-hub/src/app/(hub)/assets/[id]/page.tsx` (detail)
**API:** `mira-hub/src/app/api/assets/route.ts`, `mira-hub/src/app/api/assets/[id]/route.ts`

| Click | What actually happens |
|---|---|
| Open `/assets` | `GET /api/assets` → `SELECT … FROM cmms_equipment WHERE tenant_id = $1` (NeonDB only). Renders tile grid. |
| Click "New Asset" / FAB | Opens `CreateAssetModal`. Submitting POSTs to `/api/assets`. |
| `POST /api/assets` | `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, …)` to **NeonDB only** (`route.ts:78`). Fires `enrichAsset()` background task. **Zero Atlas write.** |
| Click a tile → `/assets/[id]` | `GET /api/assets/[id]` from NeonDB. Tabs (Activity, Work Orders, Documents, Parts, Intel) render mostly **hardcoded mock arrays** in the page component. |
| "Open in CMMS" / "View in Atlas" | **Does not exist on /assets or /assets/[id].** Confirmed by grep. |

**Where data lives:** NeonDB `cmms_equipment` (hub-owned). Atlas Postgres has its own `assets` table — hub writes never touch it.

### 1.2 Hub `/workorders` page

**File:** `mira-hub/src/app/(hub)/workorders/page.tsx` (list), `new/page.tsx`, `[id]/page.tsx`
**API:** `mira-hub/src/app/api/work-orders/route.ts`, `[id]/route.ts`

| Click | What actually happens |
|---|---|
| Open `/workorders` | `GET /api/work-orders` → `SELECT … FROM work_orders WHERE tenant_id = $1` (NeonDB only). |
| Click "New Work Order" → `/workorders/new` | 3-step wizard (Asset → Description → Review). Asset list is a **hardcoded `ASSET_OPTIONS` array** (5 mock assets), NOT a real fetch. |
| Submit the wizard | **Stub.** `submit()` at `new/page.tsx:42–45` is `setSubmitted(true); setTimeout(() => {}, 1500);` — **no API call, nothing persisted, anywhere**. Generates a fake `WO-2026-{random}` number for display. |
| Click WO row → `/workorders/[id]` | Fetches WO from NeonDB. Renders detail. |
| Click **"Open in CMMS"** button (`[id]/page.tsx:240`) | `<a href={`https://cmms.factorylm.com/workorders/${wo.id}`} target="_blank">`. **`wo.id` is the NeonDB UUID** — Atlas does not know that ID, so this **will 404 in Atlas** for every WO. |
| PATCH status (Start / Pause / Complete) | `/api/work-orders/[id]` PATCH writes only to NeonDB. **No Atlas write.** |

**Where data lives:** NeonDB `work_orders`. Population sources today: mira-bots (Telegram diagnostic flow), `auto_pm` agent. **No path inserts work orders from the hub UI** — the New WO form is a stub.

### 1.3 Hub `/cmms` page

**File:** `mira-hub/src/app/(hub)/cmms/page.tsx`
**API:** `mira-hub/src/app/api/cmms/stats/route.ts`

This page is a **CMMS dashboard + connection settings panel**, not an iframe of Atlas.

| Element | Reality |
|---|---|
| `configured` initial state | Hardcoded to `true` (`page.tsx:32`). UI always shows "connected." |
| URL/API key form | Connect button only updates React state (`page.tsx:60–66`). **Never persisted to DB or env.** Reload = lost. |
| "Open Atlas" button (header) + full-width CTA | Plain `<a href="https://cmms.factorylm.com" target="_blank">`. Opens Atlas homepage in new tab. |
| Summary cards (WOs / Assets / PMs) | Calls `GET /api/cmms/stats`. If creds present, returns live Atlas counts. Falls back to `STATIC_SUMMARY` (hardcoded 12/4/2/89/47/18/2). |
| Quick Links | `<a>` tags to `https://cmms.factorylm.com/{workorders,assets,schedule,reports}`. **Index pages only — no per-record deep link.** |

**`/api/cmms/stats` flow** (`route.ts`):
1. Reads `ATLAS_API_USER` / `ATLAS_API_PASSWORD` from env.
2. `POST {HUB_CMMS_API_URL}/auth/signin` → Atlas JWT, cached 23 hours in process memory (`route.ts:14–39`).
3. Fires 5 parallel `POST /<resource>/search` calls (work orders by status × 3, assets, PMs) — `pageSize: 1` for counts only (`route.ts:72–78`).
4. Returns `{ workOrders, assets, pms, fetchedAt }`.

This is **the only live read-path from hub to Atlas.** It uses **shared admin creds** — every tenant sees the same Atlas company's data.

### 1.4 Hub → Atlas: the only other code path

**`mira-hub/src/lib/knowledge-graph/cmms-sync.ts`**
- `fetchAtlasParts()` calls `POST ${ATLAS_URL}/parts/search` to populate the hub Knowledge Graph (`cmms-sync.ts:65–81`).
- `syncCmmsToKg()` (`cmms-sync.ts:171–197`) reads equipment / WOs / PMs from **NeonDB** and parts from Atlas, upserts into KG tables.
- Triggered by `mira-hub/scripts/kg-cmms-sync.ts` — a manual/cron script, not a UI flow.

### 1.5 Hub → Atlas (Python, mira-bots side)

**`mira-bots/shared/integrations/atlas_cmms.py`**
- Class `AtlasCMMSClient` does NOT call Atlas directly. It calls **`mira-mcp`** (`POST {MCP_BASE_URL}/api/cmms/work-orders`, `atlas_cmms.py:47`).
- mira-mcp holds the Atlas creds and proxies the call.
- Used by mira-bots Telegram flow when user approves a WO mid-conversation.
- **Hub does NOT call this.** This is a Python-only path.

### 1.6 Atlas itself (`mira-cmms/`)

**Vendored open-source.** `intelloop/atlas-cmms-backend:v1.5.0` Spring Boot + custom-branded React frontend (`mira/atlas-cmms-frontend:mobile`) + Postgres 16 + MinIO. Lives in its own compose file (`mira-cmms/docker-compose.yml`), NOT in `docker-compose.saas.yml`.

REST surface (per `mira-cmms/CLAUDE.md`):
```
POST   /api/auth/signin
GET/POST/PATCH  /api/work-orders, /api/assets, /api/preventive-maintenances, /api/parts
```
JWT Bearer auth via `/auth/signin`. `ENABLE_SSO: "false"`.

### 1.7 docker-compose.saas.yml

| Service | Networks | CMMS env |
|---|---|---|
| `mira-hub` | `mira-net` only | `HUB_CMMS_API_URL`, `ATLAS_API_USER`, `ATLAS_API_PASSWORD` (l.448–450). Comment l.447: *"Atlas CMMS live stats (public URL — mira-hub is not on cmms-ext network)."* |
| `mira-web` | `mira-net` + `cmms-ext` | `ATLAS_API_URL=http://cmms-backend:8080` (internal). |
| `cmms-ext` | external network `factorylm-cmms_default` | Owned by `mira-cmms` compose. |
| `atlas-api` / `atlas-db` | (not in saas.yml) | Run from `mira-cmms/docker-compose.yml`. |

**Implication:** `mira-hub` reaches Atlas only over the public HTTPS URL (`cmms.factorylm.com`). It cannot use the internal Docker hostname. `mira-web` could (cmms-ext network) but doesn't drive any user flows we care about for this spec.

### 1.8 Nginx routing

**Files:** `nginx-oracle.conf`, `nginx-oracle-v2.conf`, `nginx-phase2-live.conf`, `docs/plans/cmms-nginx.conf.template`

- `app.factorylm.com` → `127.0.0.1:3101` (hub) + several path-based routes for pipeline / web / ingest / mcp.
- `cmms.factorylm.com` → `/` to `127.0.0.1:3100` (atlas-frontend), `/api/` to `127.0.0.1:8088/api/` (atlas-api).
- **No** `auth_request`, **no** shared JWT validation, **no** `/cmms` / `/atlas` location block on `app.factorylm.com`.
- `cmms-nginx.conf.template` has `sub_filter` rules to rebrand "Atlas CMMS" → "FactoryLM CMMS" in HTML responses (cosmetic only).

### 1.9 Auth / cookies

| System | Secret env var | Cookie name(s) | Cookie `Domain` | SSO? |
|---|---|---|---|---|
| `mira-hub` | `AUTH_SECRET` (NextAuth) | NextAuth defaults | (NextAuth defaults — host-only) | No |
| `mira-web` | `PLG_JWT_SECRET` | `mira_session`, `mira_channel_pref`, `mira_pending_scan` | `.factorylm.com` (`cookie-session.ts:10`) | No |
| Atlas | `ATLAS_JWT_SECRET` | Atlas internal | n/a | `ENABLE_SSO: "false"` |

Three independent secrets. **No JWT validates across systems.** A logged-in hub user is not logged into Atlas. Period.

### 1.10 Cross-system data identity

- Hub `cmms_equipment.id` is a NeonDB-generated UUID.
- Atlas `assets.id` is Atlas-internal (Spring Boot managed).
- Zero `atlas_id`, `external_id`, or `cmms_synced_at` columns in any hub schema (verified via grep across `*.sql`, `*.py`, `*.ts`).
- The two databases are **schema cousins, not synced replicas**. Same domain concepts, different rows.

### 1.11 Summary table — every UI surface

| Hub UI | Reads | Writes | Atlas? |
|---|---|---|---|
| `GET /api/assets` | NeonDB `cmms_equipment` | — | No |
| `POST /api/assets` | — | NeonDB `cmms_equipment` | **No** |
| `GET /api/work-orders` | NeonDB `work_orders` | — | No |
| `/workorders/new` submit | — | **Nothing — stub** | No |
| `PATCH /api/work-orders/[id]` | — | NeonDB `work_orders` | No |
| `GET /api/cmms/stats` | Atlas (5 search calls) | — | **Yes (read counts only)** |
| KG sync script | NeonDB + Atlas `/parts/search` | NeonDB KG tables | Read-only |
| `/cmms` "Open Atlas" | — | — | Link only |
| `/workorders/[id]` "Open in CMMS" | — | — | Link, **broken (wrong ID)** |
| Atlas UI any button | — | Atlas Postgres | n/a (zero hub awareness) |

---

## Section 2: User Journey (step-by-step walkthrough)

### 2.1 Mike creates an asset from the hub today

1. Mike logs into `app.factorylm.com` (NextAuth session cookie). _\[screenshot: hub login\]_
2. Sidebar → "Assets" → `/assets`. _\[screenshot: hub assets list\]_
3. Tap "New Asset" (desktop) or `+` FAB (mobile). Modal opens. _\[screenshot: new-asset modal\]_
4. Mike fills tag, manufacturer, model, location. Submit.
5. `POST /api/assets` → NeonDB `cmms_equipment` row inserted. Modal closes, list refreshes. _\[screenshot: hub asset visible\]_
6. **Mike opens a new tab → `cmms.factorylm.com` → must log into Atlas separately.** _\[screenshot: Atlas login\]_
7. Atlas → Assets. **The asset Mike created is not there.** _\[screenshot: Atlas missing asset\]_

**Result: data divergence after step 5. No way to reconcile from the UI.**

### 2.2 Mike creates a work order from the hub today

1. Hub → `/workorders` → "New Work Order". _\[screenshot: WO wizard step 1\]_
2. Wizard step 1: pick from a hardcoded 5-item asset list (NOT his real assets).
3. Step 2: description + priority. Step 3: review. Tap "Create Work Order".
4. Page swaps to a green checkmark with `WO-2026-{random 100–999}`. _\[screenshot: success splash\]_
5. **Nothing was persisted. Anywhere. The WO does not exist in NeonDB or Atlas.**
6. Mike navigates to `/workorders` list — his "created" WO is **not there**.

**Result: silent data loss. The success message is a lie.**

### 2.3 Mike creates a work order *from a Telegram diagnostic conversation* today

(Different path, but the only one that actually creates WOs.)

1. Mike messages `@FactoryLMDiagnose_bot` describing a fault.
2. Bot replies with diagnostic. Offers "Create work order?"
3. Mike confirms. mira-bots calls `AtlasCMMSClient.create_work_order()` → `POST mira-mcp/api/cmms/work-orders` → mira-mcp creates WO in Atlas.
4. Bot also writes a row to NeonDB `work_orders` (separately).
5. Hub `/workorders` list now shows the WO (NeonDB-side row).
6. Atlas `/workorders` also shows the WO (Atlas-side row).
7. **The two rows have different IDs and no foreign-key link.** Updating one does not update the other.

**Result: dual-write today through mira-bots, but no reconciliation. Status changes diverge.**

### 2.4 Mike navigates from the hub to Atlas today

1. Hub `/cmms` page → "Open Atlas" button → opens `https://cmms.factorylm.com` in new tab → **Atlas login screen** (he must log in again).
2. Hub `/cmms` page Quick Links → opens `cmms.factorylm.com/workorders` (index page, not specific record) → still requires login.
3. Hub `/workorders/[id]` → "Open in CMMS" button → opens `cmms.factorylm.com/workorders/{neondb-uuid}` → **Atlas 404** (Atlas doesn't know that ID), after he logs in. _\[screenshot: Atlas 404\]_

**Result: every cross-domain click costs a login. The one "deep link" leads nowhere.**

### 2.5 Mike navigates from Atlas back to the hub today

There is no link. Atlas does not know the hub exists.

---

## Section 3: Gap Analysis

### 3.1 Missing for **bidirectional sync**

| Need | Status |
|---|---|
| Hub `cmms_equipment.atlas_id` column (and on `work_orders`, `pm_schedules`) | Missing |
| `POST /api/assets` mirror-write to Atlas | Missing |
| `POST /api/work-orders` route (the route doesn't even exist — only GET / `[id]` PATCH) | Missing |
| `/workorders/new` real submit → real API | Missing (UI is a stub) |
| Atlas → hub webhook (or polling reconciler) for WOs / assets created in Atlas | Missing |
| Conflict resolution policy (last-write-wins? source-of-truth flag?) | Undecided |
| Per-tenant Atlas company creation at signup (so each tenant has its own Atlas org) | Designed in `2026-04-10-factorylm-cmms-rebrand.md` Phase 1, **not shipped** |
| Per-tenant Atlas creds (today: shared admin in env vars — every tenant queries the same Atlas company) | Missing — multi-tenancy hole |

### 3.2 Missing for **seamless navigation**

| Need | Status |
|---|---|
| "Open in CMMS" link on `/assets/[id]` | Missing |
| "Open in CMMS" link on `/assets` list (per-row) | Missing |
| Deep-link URL must use **Atlas ID**, not NeonDB UUID | Bug — currently uses NeonDB UUID at `workorders/[id]/page.tsx:240` |
| "Back to FactoryLM" link inside Atlas frontend | Missing (Atlas would need a header injection or fork) |
| nginx `sub_filter` injection of a "Back to FactoryLM" widget | Possible via `cmms-nginx.conf.template`, not implemented |
| Hub navbar persistent "Open CMMS" with current-record context | Missing |

### 3.3 Missing for **SSO**

| Need | Status |
|---|---|
| Shared JWT secret OR token-exchange endpoint between hub and Atlas | Missing — three independent secrets |
| Cookie domain `.factorylm.com` set by **hub** (today only `mira-web` does this) | Missing |
| `/api/cmms/login` SSO route (exchange hub session → Atlas JWT, redirect with token) | Designed in `2026-04-10-factorylm-cmms-rebrand.md` Phase 2, **not shipped** |
| Atlas-side JIT user provisioning when a hub session arrives with a valid signed claim | Missing — `ENABLE_SSO: "false"` |
| Per-tenant Atlas user (today: shared admin) | Missing |

### 3.4 Architectural decision points (Mike must answer before fix plan is real)

1. **Source of truth.** Is Atlas the SoT for assets / WOs / PMs, with NeonDB as a denormalized cache? Or is NeonDB the SoT (hub-native) and Atlas is a downstream view? `docs/product/cmms-integration.md` claims Atlas is SoT ("MIRA does not mirror entire CMMS to own database; queries API on demand") — but the **actual code does the opposite**: hub `cmms_equipment` and `work_orders` are independent NeonDB tables populated by hub/bots, Atlas is queried only for stats + parts.
2. **Sync model.** Push-on-write (each hub mutation calls Atlas synchronously), event-driven (Atlas webhooks back to hub), or batched reconciler? Synchronous push couples hub uptime to Atlas; webhooks need Atlas configurability (Atlas OSS may not support).
3. **Multi-tenancy.** Today the hub has one `ATLAS_API_USER` env var → one Atlas company → all tenants share it. The 2026-04-10 rebrand plan calls for per-tenant Atlas company provisioning at signup. **Until that exists, sync is structurally broken** — it would mix tenant data.
4. **Atlas customizability.** Atlas is vendored OSS (`intelloop/atlas-cmms-backend`). Adding "Back to FactoryLM" to its UI = either fork the frontend image or do `sub_filter` HTML injection at nginx. Forking adds a maintenance tax forever.

---

## Section 4: Fix Plan (prioritized — SPEC ONLY, not built)

### P0 — Make the hub honest about what it does today

Do these first because they prevent the user from being misled. Cheap, no architecture decisions needed.

| # | Change | Effort | Where |
|---|---|---|---|
| P0.1 | Make `/workorders/new` either really submit (POST `/api/work-orders` to NeonDB, mirror to Atlas) **or** disable the "Create" button and show "Coming soon" | S | `mira-hub/src/app/(hub)/workorders/new/page.tsx:42` |
| P0.2 | Fix the `Open in CMMS` link on `/workorders/[id]:240` — either remove it (until Atlas IDs are stored) or hide it behind a `wo.atlas_id` field | XS | `mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240` |
| P0.3 | Make `/cmms` page `configured` reflect actual env (`HUB_CMMS_API_URL` + `ATLAS_API_USER` set) instead of hardcoded `true` | XS | `mira-hub/src/app/(hub)/cmms/page.tsx:32` (add a `/api/cmms/stats` HEAD probe or new `/api/cmms/health` route) |
| P0.4 | Persist the "URL + API key" form OR remove the form (today it's local React state, looks functional but isn't) | S | same file, `connect()` function |

**Outcome of P0:** Mike can use the system and the UI no longer lies. No new sync, no SSO yet.

### P1 — Bidirectional sync (the real ask)

Pre-req: **Mike picks the source-of-truth model** (see §3.4 #1).

Sub-plan A — **Atlas as SoT** (matches docs, requires hub UI to call Atlas directly):
- A.1 Add `ATLAS_API_URL` + JWT exchange to hub session middleware so each user request gets a per-tenant Atlas token (depends on multi-tenant Atlas — see P1.0).
- A.2 Replace `POST /api/assets` body to also `POST /api/assets` on Atlas; store returned Atlas ID locally as denormalized cache.
- A.3 Add `POST /api/work-orders` route (currently missing) that writes to Atlas + caches in NeonDB.
- A.4 Replace `/workorders/new` stub with real submit hitting that route.
- A.5 Build a 5-min reconciler that pulls Atlas → NeonDB diff (creates / updates done outside the hub).

Sub-plan B — **NeonDB as SoT, Atlas downstream**:
- B.1 Add `atlas_id`, `cmms_synced_at` columns to `cmms_equipment`, `work_orders`, `pm_schedules`.
- B.2 After every hub `INSERT`/`UPDATE`, enqueue an Atlas mirror-write (background worker, not in request path).
- B.3 Build an inbound endpoint (`POST /api/cmms/webhook`) for Atlas → hub events; if Atlas OSS can't emit webhooks, run a reconciler poller.
- B.4 Conflict policy: hub wins on conflict (because hub is SoT).

**P1.0 (blocker either way):** ship Phase 1 of `docs/plans/2026-04-10-factorylm-cmms-rebrand.md` — per-tenant Atlas company provisioned at signup, per-tenant API creds stored in NeonDB. Without this, sync mixes tenants.

### P2 — Seamless navigation with SSO

| # | Change | Depends on |
|---|---|---|
| P2.1 | Add `/api/cmms/login` route on hub: validates NextAuth session → POSTs to Atlas `/auth/signin` with the tenant's stored Atlas creds → redirects to `cmms.factorylm.com/...?token={jwt}` | P1.0 (per-tenant Atlas creds) |
| P2.2 | Atlas frontend must accept token via URL fragment and skip its own login screen. Either fork frontend or use `sub_filter` to inject a small JS snippet that reads `#token=` and stores it in localStorage. | Atlas customization decision (§3.4 #4) |
| P2.3 | Hub navbar: persistent "Open CMMS" button using `/api/cmms/login`, with `?return=<current-record-atlas-id>` for context. | P1.B.1 (atlas_id column) |
| P2.4 | "Back to FactoryLM" widget inside Atlas — either nginx `sub_filter` injecting a header bar, or atlas-frontend fork. | §3.4 #4 |
| P2.5 | Set hub session cookie `Domain=.factorylm.com` so logout from hub also clears Atlas session (only meaningful if SSO uses the same cookie surface — likely not). | P2.1 design |

---

## Appendix A — Files cited in this audit

- `mira-hub/src/app/(hub)/assets/page.tsx`, `[id]/page.tsx`
- `mira-hub/src/app/(hub)/workorders/page.tsx`, `new/page.tsx`, `[id]/page.tsx`
- `mira-hub/src/app/(hub)/cmms/page.tsx`
- `mira-hub/src/app/api/assets/route.ts`, `[id]/route.ts`
- `mira-hub/src/app/api/work-orders/route.ts`, `[id]/route.ts`
- `mira-hub/src/app/api/cmms/stats/route.ts`
- `mira-hub/src/lib/knowledge-graph/cmms-sync.ts`
- `mira-hub/scripts/kg-cmms-sync.ts`
- `mira-hub/src/auth.ts`, `src/middleware.ts`
- `mira-bots/shared/integrations/atlas_cmms.py`
- `mira-cmms/CLAUDE.md`, `mira-cmms/docker-compose.yml`
- `mira-web/src/lib/cookie-session.ts`
- `docker-compose.saas.yml` (l.165, 369–459, 464–466)
- `nginx-oracle.conf`, `nginx-oracle-v2.conf`, `nginx-phase2-live.conf`, `docs/plans/cmms-nginx.conf.template`
- `docs/product/cmms-integration.md`
- `docs/plans/2026-04-10-factorylm-cmms-rebrand.md`
- `docs/runbooks/cmms-onboarding.md`
- `PRDS/mira_factorylm_prd_v2.md`

## Appendix B — What the docs claim vs. what the code does

| Claim (`docs/product/cmms-integration.md`) | Code reality |
|---|---|
| "MIRA does not mirror entire CMMS to own database; queries API on demand" | Hub keeps its own `cmms_equipment` and `work_orders` tables in NeonDB. The hub UI never queries Atlas for these — only for stats counts. |
| "MIRA only writes when you explicitly approve" | The only Atlas write path today (mira-bots → mira-mcp) does prompt for approval. The hub UI has no Atlas write path. |
| "Per-tenant isolation. Your CMMS data not shared with other tenants" | Today there is one `ATLAS_API_USER` shared across all tenants. **Multi-tenant isolation does not exist yet.** |
| "Audit log. Every CMMS write logged against MIRA user who approved" | No audit log table found for Atlas writes. mira-bots logs to its own `events`/conversation tables, not as a CMMS audit. |

The docs describe an aspirational state. The 2026-04-10 rebrand plan acknowledges this (6 phases planned, **none merged as of audit date**).

---

## Open questions for Mike (before any P1/P2 work)

1. **Source of truth:** Atlas, NeonDB, or "Atlas for assets, NeonDB for diagnostic conversations & WOs"?
2. **Sync mode:** synchronous push, async worker, webhook, polling reconciler?
3. **Multi-tenant Atlas:** ship Phase 1 of the rebrand plan first, or live with shared-admin until SaaS scale demands it?
4. **Atlas customization:** fork the frontend (own the look) or `sub_filter` inject (zero fork tax, fragile)?
5. **Scope of the WO write path:** does the hub `/workorders/new` wizard need parity with the Telegram-bot WO creator, or is it MVP-stub for now?

Until (1)–(5) are answered, we cannot pick between sub-plan A and sub-plan B in P1, and P2 design has hard dependencies.
