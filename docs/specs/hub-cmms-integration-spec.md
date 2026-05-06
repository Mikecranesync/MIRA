# Hub ↔ Atlas CMMS Integration Spec

**Status:** AUDIT + plan. P0 in flight (2026-05-06). P1/P2 await implementation kickoff.
**Audit date:** 2026-05-06
**Decision recorded:** 2026-05-06 — **NeonDB is the single source of truth.** Atlas receives synced copies via one-way push from NeonDB; changes made directly in the Atlas GUI flow back into NeonDB via reverse sync, with NeonDB winning on conflict. (See §3.4 #1 and §4 below.)
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

### 3.1 Missing for **bidirectional sync** (NeonDB-as-SoT model)

| Need | Status |
|---|---|
| `atlas_id`, `cmms_synced_at`, `cmms_synced_etag` columns on `cmms_equipment`, `work_orders`, `pm_schedules` | Missing — added in P1.1 |
| `POST /api/work-orders` route (currently only GET + PATCH) | Missing — added in P0.1 |
| `/workorders/new` real submit → real API | Missing (UI is a stub) — fixed in P0.1 |
| Sync worker (NeonDB → Atlas) | Missing — built in P1.3 |
| Reverse sync worker (Atlas → NeonDB) | Missing — built in P1b |
| Conflict resolution policy | **Decided 2026-05-06: NeonDB wins** (see §3.4 #1, P1b.2) |
| Per-tenant Atlas company creation at signup | Designed in `2026-04-10-factorylm-cmms-rebrand.md` Phase 1, **not shipped** |
| Per-tenant Atlas creds (today: shared admin) | Missing — gates safe multi-tenant rollout, see P1 caveat |

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

### 3.4 Architectural decisions

1. **Source of truth → DECIDED 2026-05-06: NeonDB.**
   - NeonDB is canonical for assets, work orders, PM schedules.
   - Atlas receives synced copies via one-way push from a sync layer; Atlas exists primarily to provide a CMMS-style GUI for users who want one.
   - Changes made directly in the Atlas GUI flow back into NeonDB via reverse sync (poll or webhook). On conflict, **NeonDB wins** — Atlas-side edits are accepted only when NeonDB has not edited the same record more recently.
   - This decision contradicts `docs/product/cmms-integration.md` ("MIRA does not mirror entire CMMS"). That doc is now stale and should be marked as such; the code already operates NeonDB-first.
2. **Sync model → planned: async worker + atlas_id cross-reference.**
   - Hub UI mutates NeonDB synchronously (request path stays fast).
   - A background worker drains a queue (or scans a `cmms_synced_at IS NULL OR < updated_at` predicate) and pushes to Atlas REST.
   - On successful push, the worker writes the returned Atlas ID back into NeonDB (`atlas_id` column).
   - Reverse path (Atlas → NeonDB): poll Atlas `*/search` endpoints by `updatedAt > last_poll`, OR an Atlas webhook if available — TBD during P1b implementation.
3. **Multi-tenancy** — same as before: today one shared `ATLAS_API_USER` env var means all tenants share one Atlas company. Per-tenant Atlas provisioning (Phase 1 of `2026-04-10-factorylm-cmms-rebrand.md`) is still **not shipped**, and sync is structurally unsafe across tenants until it ships. P1 sync work is single-tenant viable; multi-tenant sync is gated on the rebrand-plan Phase 1.
4. **Atlas customizability.** Atlas is vendored OSS (`intelloop/atlas-cmms-backend`). Adding "Back to FactoryLM" to its UI = either fork the frontend image or do `sub_filter` HTML injection at nginx. Forking adds a maintenance tax forever. Decision deferred to P2.

---

## Section 4: Fix Plan (prioritized — NeonDB is canonical; Atlas is a synced view)

**Architecture in one diagram:**

```
   Hub UI (Next.js)                                 Atlas GUI (vendored OSS)
        │                                                  │
        │ writes                                           │ writes
        ▼                                                  ▼
┌──────────────────┐   one-way push (worker) ───►  ┌────────────────┐
│   NeonDB (SoT)   │ ◄─── reverse sync (poll) ───  │ Atlas Postgres │
│ cmms_equipment   │                               │ assets, work-  │
│ work_orders      │                               │ orders, pms    │
│ pm_schedules     │                               └────────────────┘
│ + atlas_id col   │
│ + cmms_synced_at │
│ + cmms_synced_etag (optimistic-lock for conflicts)
└──────────────────┘
        ▲
        │ MIRA reads here for diagnostics, dashboards, KG, agents
```

- Every hub write hits NeonDB synchronously and returns immediately.
- A sync worker drains NeonDB → Atlas. On success, it writes the returned Atlas ID back into NeonDB (`atlas_id`).
- A reverse sync (poll or webhook) pulls Atlas → NeonDB for changes made directly in the Atlas GUI. **NeonDB wins on conflict** (compare `updated_at` vs. `cmms_synced_at`; Atlas-side edit accepted only if NeonDB hasn't moved since the last successful push).
- Deep linking uses `atlas_id` from NeonDB — that's why the column matters for P2 even though it's a P1 deliverable.

### P0 — Stop lying to the user (in flight 2026-05-06)

Cheap, no new architecture. Goal: every UI surface either works or honestly says it doesn't.

| # | Change | Effort | Where |
|---|---|---|---|
| P0.1 | `/workorders/new` actually persists. Wire `submit()` to a new `POST /api/work-orders` route that inserts into NeonDB `work_orders`. Atlas mirror-write is **deferred to P1** — for P0 the WO just lives in NeonDB. | S | `mira-hub/src/app/(hub)/workorders/new/page.tsx:42`, new `mira-hub/src/app/api/work-orders/route.ts` POST handler |
| P0.2 | Hide the broken `Open in CMMS` link on `/workorders/[id]` until `wo.atlas_id` exists. Render the button only when the WO record carries a non-null `atlas_id`. (Column doesn't exist yet → button is always hidden until P1 adds it.) | XS | `mira-hub/src/app/(hub)/workorders/[id]/page.tsx:240` |
| P0.3 | `/cmms` page `configured` flag reflects reality. Add a `/api/cmms/health` route that returns `{ configured: <bool> }` based on `process.env.ATLAS_API_USER && ATLAS_API_PASSWORD && HUB_CMMS_API_URL`. Page consumes it on mount and falls back to the setup card when not configured. | XS | `mira-hub/src/app/(hub)/cmms/page.tsx:32`, new `mira-hub/src/app/api/cmms/health/route.ts` |
| P0.4 (deferred) | Persisting the URL/API-key form is left for P1 because per-tenant creds is a P1 multi-tenant decision; for P0 we just hide the form when env-configured and keep the local-state behavior otherwise (clearly labeled as preview). | — | — |

**Outcome of P0:** No fake success splashes. No 404-bound deep links. No "Connected" lie. Sync layer not built yet — assets/WOs created in the hub still don't appear in Atlas, but the UI doesn't claim they do.

### P1 — NeonDB → Atlas one-way push (the sync worker)

Goal: any record created or updated in the hub UI shows up in the Atlas GUI within a minute.

| # | Change | Where |
|---|---|---|
| P1.1 | Migration: add `atlas_id TEXT NULL`, `cmms_synced_at TIMESTAMPTZ NULL`, `cmms_synced_etag TEXT NULL` to `cmms_equipment`, `work_orders`, `pm_schedules`. Indexes on `(tenant_id, cmms_synced_at)` for the worker's predicate scan. | new `mira-hub/db/migrations/006_atlas_sync_cols.sql` |
| P1.2 | `POST /api/assets` and `POST /api/work-orders` (added in P0.1) emit a sync intent. Two acceptable mechanisms:<br>(a) write a row into a `cmms_sync_outbox` table inside the same NeonDB transaction (transactional outbox pattern), OR<br>(b) just leave `cmms_synced_at IS NULL` and let the worker poll for unsynced rows (simpler, fine at MVP scale). Pick (b) for P1; revisit if poll lag is unacceptable. | hub API routes |
| P1.3 | Sync worker: a Node.js process (script + cron, OR a tiny long-running container). Every 30s: select `tenant_id, id, ...` rows where `cmms_synced_at IS NULL OR cmms_synced_at < updated_at`, push to Atlas via existing `atlasPost()` helper (extracted from `cmms/stats/route.ts`), capture returned ID, `UPDATE … SET atlas_id = $1, cmms_synced_at = now(), cmms_synced_etag = $2`. | new `mira-hub/scripts/cmms-sync-worker.ts` (mirrors the existing `kg-cmms-sync.ts` pattern); deploy as cron until volume justifies long-running |
| P1.4 | The `atlasPost()` helper currently lives inline in `cmms/stats/route.ts`. Extract into `mira-hub/src/lib/atlas/client.ts` with: `getToken()`, `atlasPost(path, body)`, `atlasPatch(path, body)`, `atlasGet(path, params)`, plus typed mappers for `Asset`, `WorkOrder`, `PreventiveMaintenance` between the NeonDB row shapes and Atlas DTO shapes. | new `mira-hub/src/lib/atlas/client.ts` |
| P1.5 | Updates path: hub `PATCH /api/work-orders/[id]` already exists; ensure it bumps `updated_at` (Postgres trigger or explicit), so the worker re-pushes. | `mira-hub/src/app/api/work-orders/[id]/route.ts` |
| P1.6 | Hub UI surfaces sync state. Add a small "Synced to CMMS" / "Pending sync" badge on `/workorders/[id]` and `/assets/[id]` based on `atlas_id IS NOT NULL`. Re-enable the `Open in CMMS` button (deep link uses `atlas_id`). | hub detail pages |
| P1.7 | `cmms_equipment` source field. Several existing rows are populated by mira-bots and the ingest pipeline; ensure the worker treats those exactly the same as hub-UI-created rows. No special case. | worker logic |

**Multi-tenancy caveat:** P1 ships with the existing **shared admin** Atlas creds. That means at MVP every tenant's data lands in one Atlas company. **Acceptable only while we have one paying tenant.** P1 must be flagged off (`CMMS_SYNC_ENABLED=false`) until either (a) we have only one tenant, or (b) Phase 1 of `2026-04-10-factorylm-cmms-rebrand.md` (per-tenant Atlas provisioning) ships. Document this in the worker's startup log.

### P1b — Atlas → NeonDB reverse sync

Goal: changes made directly inside the Atlas GUI (a CMMS user closing a WO, editing an asset) flow back into NeonDB so the hub stays accurate.

| # | Change | Where |
|---|---|---|
| P1b.1 | Pull strategy. Worker calls `POST /work-orders/search` and `/assets/search` filtered by `updatedAt > {last_poll_cursor}` every 60s. Cursor stored in NeonDB `cmms_sync_state(resource, last_poll_at)`. Atlas REST does support filtering by date in search. | extend `cmms-sync-worker.ts` |
| P1b.2 | For each Atlas-side change, look up the NeonDB row by `atlas_id`. If it exists and NeonDB's `updated_at <= cmms_synced_at`, accept the Atlas change (UPDATE NeonDB). If `updated_at > cmms_synced_at`, **reject** the Atlas change — log it to a `cmms_sync_conflicts` table for review. NeonDB wins. | worker logic |
| P1b.3 | Atlas-only creates (a record created in Atlas with no NeonDB counterpart). Insert into NeonDB with `atlas_id` populated immediately so the next forward-sync tick treats it as already synced. | worker logic |
| P1b.4 | Atlas webhook path (optional). If atlas-cmms-backend supports outbound webhooks, register `POST /api/cmms/webhook` and replace polling. Verify webhook signature with `ATLAS_WEBHOOK_SECRET`. **Investigation task for P1b kickoff** — likely not supported; default plan is polling. | new `mira-hub/src/app/api/cmms/webhook/route.ts` if viable |
| P1b.5 | Conflict review surface. Tiny admin-only page at `/admin/cmms-sync` listing recent conflicts and letting the operator pick a resolution. Ship behind `ADMIN_ONLY`. | new admin page |

### P2 — Seamless navigation with SSO

Same shape as before, with the deep-link path now feasible because `atlas_id` exists after P1.

| # | Change | Depends on |
|---|---|---|
| P2.1 | `/api/cmms/login` route: validates NextAuth session → POSTs to Atlas `/auth/signin` (using tenant's Atlas creds) → redirects to `cmms.factorylm.com/...#token={jwt}` | per-tenant Atlas creds (Phase 1 of rebrand plan) |
| P2.2 | Atlas frontend accepts token via URL fragment. Either fork the frontend or `sub_filter`-inject a JS snippet that reads `#token=` and stores in `localStorage` under Atlas's expected key. | §3.4 #4 |
| P2.3 | Hub navbar: persistent "Open CMMS" button using `/api/cmms/login?return=<atlas_id>` so we land on the same record. **Now unblocked because `atlas_id` was added in P1.1.** | P1.1 |
| P2.4 | "Back to FactoryLM" widget inside Atlas — nginx `sub_filter` injecting a header bar (preferred — no fork) or atlas-frontend fork. | §3.4 #4 |
| P2.5 | Hub session cookie `Domain=.factorylm.com` so logout cascades. (Mostly a polish item once P2.1/P2.2 are real.) | P2.1 design |

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

## Open questions

1. ~~**Source of truth.**~~ **Answered 2026-05-06: NeonDB.** Atlas receives synced copies via one-way push from a worker. Reverse sync pulls Atlas changes back into NeonDB; NeonDB wins on conflict.
2. **Sync mode.** Working assumption: **async worker polling NeonDB for unsynced rows** (no transactional outbox at MVP). Atlas → NeonDB direction defaults to **polling** because Atlas OSS likely doesn't support outbound webhooks; verify during P1b kickoff and switch to webhooks if available.
3. **Multi-tenant Atlas.** P1 ships behind `CMMS_SYNC_ENABLED` flag, **off by default until either** (a) we have only one paying tenant or (b) Phase 1 of `2026-04-10-factorylm-cmms-rebrand.md` (per-tenant Atlas company provisioning) ships.
4. **Atlas customization.** Default plan: nginx `sub_filter` for the "Back to FactoryLM" widget (no fork tax, fragile but reversible). Fork only if `sub_filter` proves brittle. Decision finalized at P2 kickoff.
5. **Scope of `/workorders/new`.** P0 MVP = the wizard's existing 3-step flow but actually persisting to NeonDB. Parity with the Telegram WO flow (suggested actions, safety warnings, parts/tools needed) is **out of scope for P0** — those fields stay null and can be added later.
