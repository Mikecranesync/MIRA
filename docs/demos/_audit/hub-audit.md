# MIRA Hub Demo Readiness Audit

**Date:** 2026-06-05  
**Auditor:** Claude Code (automated static analysis + live HTTP probing)  
**Target:** https://app.factorylm.com (mira-hub)  
**Method:** Read every `page.tsx`, classify data source, probe live HTTP (no auth, GET-only)

---

## Verification

- **Branch vs prod parity confirmed.** Local branch `feat/simlab-machine-behavior` is 0 commits behind `origin/main` on `mira-hub/src/app`. Local reads are authoritative.
- **`/discovery` confirmed absent on `origin/main`.** PR #1589 added fieldbus inventory to the **Command Center** (surfaced in `/command-center`), not as a standalone `/discovery` route. `git ls-tree origin/main -- mira-hub/src/app | grep discovery` returns empty.
- **Live HTTP probing was GET-only, unauthenticated.** The "200" column records the final response after following all redirects. For auth-gated pages this means the **login page** returned 200, not the actual hub page. Every `(hub)` verdict is inferred from code analysis, not from a logged-in page load.

---

## Key Findings Up Front

- **`NEXT_PUBLIC_LABS_ENABLED` is UNSET** in prod → **7 routes show "Coming Soon" placeholder** (alerts, conversations, documents, parts, reports, requests, team)
- **Routes that do NOT exist** (return 307→login on `/` and then 307 on trailing-slash): `/discovery`, `/settings`, `/plc` — these are NOT hub pages. Do not navigate to them on camera.
- **`/proposals` redirects** to `/knowledge/suggestions` — the page lives there now.
- **`/graph` redirects** to `/knowledge/map`.
- **`/library` redirects** to `/knowledge/manuals`.
- **`/admin`** redirects to `/admin/users`.
- All 308 redirects from non-trailing-slash URLs are Next.js infrastructure, not failures.

---

## Summary Table

| Route | Data Source | Labs-gated | Live HTTP | Demo Verdict | Category |
|---|---|---|---|---|---|
| `/` (→ feed) | real-query (`/api/work-orders`, `/api/pm-schedules`) | No | 308→200 | GOOD if WOs seeded | NICE_TO_HAVE (seed) |
| `/login` | static form | No | 200 | GOOD | FUTURE |
| `/signup` | static form | No | 200 | GOOD | FUTURE |
| `/quickstart` | static form / wizard | No | 200 | OK | FUTURE |
| `/feed` | real-query (`/api/work-orders`, `/api/pm-schedules`) | No | 200 | GOOD if data seeded | NICE_TO_HAVE |
| `/namespace` | real-query (`/api/namespace/tree`) | No | 200 | GOOD if namespace seeded | NICE_TO_HAVE |
| `/proposals` | redirect → `/knowledge/suggestions` | No | 200 | n/a — redirect | FUTURE |
| `/knowledge` | redirect → `/knowledge/map` | No | 200 | n/a — redirect | FUTURE |
| `/knowledge/map` | real-query (`/api/kg/graph`) | No | 200 | GOOD (shows empty state gracefully) | NICE_TO_HAVE |
| `/knowledge/suggestions` | real-query (`/api/proposals`) | No | 200 | GOOD if proposals exist | NICE_TO_HAVE |
| `/knowledge/manuals` | real-query (`/api/knowledge`, `/api/uploads`) | No | 200 | GOOD if manuals ingested | NICE_TO_HAVE |
| `/assets` | real-query (`/api/assets`) | No | 200 | GOOD if assets seeded | NICE_TO_HAVE |
| `/assets/[id]` | real-query (`/api/assets/[id]`) + mock fallback tabs | No | 200 | MIXED — overview=real, activity/WO/parts=hardcoded mock | DEMO_BLOCKER |
| `/assets/print-qr` | real-query (`/api/assets`) | No | 200 | OK | FUTURE |
| `/command-center` | real-query (`/api/command-center/tree`) | No | 200 | GOOD if displays configured | NICE_TO_HAVE |
| `/workorders` | real-query (`/api/work-orders`) | No | 200 | GOOD if WOs seeded | NICE_TO_HAVE |
| `/workorders/[id]` | real-query (`/hub/api/work-orders/[id]`) | No | 200 | GOOD if WO exists | NICE_TO_HAVE |
| `/workorders/new` | form (POST to API) | No | 200 | GOOD | NICE_TO_HAVE |
| `/schedule` | real-query (`/api/pm-schedules`) | No | 200 | GOOD if PMs seeded | NICE_TO_HAVE |
| `/documents` | **LABS-STUB** (hardcoded DOCS array behind flag) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/documents/[id]` | **hardcoded-mock** (reads from `lib/documents-data` DOCS array, line 19) | No | 200 | DEMO_BLOCKER — shows fake doc data; only reachable from `/documents` (which is Labs-gated anyway) | DEMO_BLOCKER |
| `/reports` | **LABS-STUB** (hardcoded mock KPI_DATA, DOWNTIME_DATA, etc.) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/alerts` | **LABS-STUB** (hardcoded ALERTS array) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/conversations` | **LABS-STUB** (hardcoded CONVERSATIONS array) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/team` | **LABS-STUB** (hardcoded TEAM array + real `/api/team`) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/parts` | **LABS-STUB** (hardcoded PARTS array from `lib/parts-data`) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/requests` | **LABS-STUB** (hardcoded INITIAL_REQUESTS) | **YES** | 200 | DEMO_BLOCKER — "Coming Soon" | DEMO_BLOCKER |
| `/event-log` | real-query (`/api/events`) | No | 200 | GOOD if events exist | NICE_TO_HAVE |
| `/channels` | real-query (`/api/auth/status`) + localStorage | No | 200 | GOOD — functional connector config | NICE_TO_HAVE |
| `/integrations` | hardcoded-mock (CMMS_SYSTEMS, WEBHOOKS arrays) | No | 200 | MIXED — shows Atlas as "connected" with fake stats (47 assets, 312 WOs, "2 min ago"), other data fake | DEMO_BLOCKER |
| `/graph` | redirect → `/knowledge/map` | No | 200 | n/a — redirect | FUTURE |
| `/more` | static nav list | No | 200 | GOOD — static links | FUTURE |
| `/upgrade` | static pricing (hardcoded plan tiers) | No | 200 | GOOD — pricing page | FUTURE |
| `/usage` | real-query (`/api/events`) + recharts | No | 200 | GOOD if event data exists | NICE_TO_HAVE |
| `/channels` | real-query + localStorage state | No | 200 | GOOD | NICE_TO_HAVE |
| `/cmms` | real-query + static fallback (`STATIC_SUMMARY`) | No | 200 | MIXED — has hardcoded stats as fallback | NICE_TO_HAVE |
| `/admin` | redirect → `/admin/users` | No | 200 | GOOD — real NeonDB users | FUTURE |
| `/admin/users` | real-query (`/api/admin/users`) | No | 200 | GOOD | FUTURE |
| `/admin/review` | real-query (`/api/admin/review-queue`) | No | 200 | GOOD — pending proposals review queue | FUTURE |
| `/admin/roles` | real-query | No | 200 | GOOD | FUTURE |
| `/onboarding` | real-query (POST to `/api/namespace/...`) | No | 200 | GOOD — wizard UX | NICE_TO_HAVE |
| `/scan` | camera API (BarcodeDetector) | No | 200 | GOOD — functional | NICE_TO_HAVE |
| `/pending-approval` | real-query (`/api/auth/check-approval`) | No | 200 | GOOD — guard page | FUTURE |
| `/magic` | real-query (magic link verification) | No | 200 | GOOD — auth flow | FUTURE |
| `/library` | redirect → `/knowledge/manuals` | No | 200 | n/a — redirect | FUTURE |
| `/parts/[id]` | **hardcoded-mock** (`PARTS.find(p => p.id === id) ?? PARTS[0]`, line 21 of parts/[id]/page.tsx) | No | 200 | DEMO_BLOCKER — always shows fake part data | DEMO_BLOCKER |
| `/requests/new` | hardcoded ASSETS/AREAS dropdowns; form submits locally | No | 200 | MIXED — form renders fine, asset list is fake | NICE_TO_HAVE |
| `/documents/[id]` | **hardcoded-mock** (`DOCS.find(d => d.id === id) ?? DOCS[0]`, line 19 of documents/[id]/page.tsx) | No | 200 | DEMO_BLOCKER — reachable only from Labs-gated /documents anyway | DEMO_BLOCKER |
| `/workorders/new` | real-query (fetches asset list; photo upload; POST to create WO) | No | 200 | GOOD — fully functional wizard | NICE_TO_HAVE |
| `/signup` | static form (POST to `/api/auth/signup`) | No | 200 | GOOD | FUTURE |
| `/quickstart` | real-query (`/api/knowledge` + pipeline) — public PLG no-auth page | No | 200 | GOOD — public OEM corpus demo | NICE_TO_HAVE |
| `/m/[assetTag]` | real-query (asset lookup by tag) | No | n/a | GOOD — QR deep-link | NICE_TO_HAVE |
| `/demo/conveyor/[tag]` | real-query (conveyor equipment lookup) | No | n/a | GOOD — direct-connection demo | NICE_TO_HAVE |
| `/discovery` | **DOES NOT EXIST** — 307→login | n/a | 307→login | NOT A PAGE | n/a |
| `/settings` | **DOES NOT EXIST** — 307→login | n/a | 307→login | NOT A PAGE | n/a |
| `/plc` | **DOES NOT EXIST** — 307→login | n/a | 307→login | NOT A PAGE | n/a |

---

## Prioritized Route Details

### `/` → `/feed` (Dashboard)

**Data source:** real-query. Fetches `GET /api/work-orders` and `GET /api/pm-schedules` on load. KPI cards (Open WOs, Overdue PMs, Total WOs, Auto-Extracted PMs) are computed from these API responses — shows "—" while loading, real numbers once data loads.

**Labs-gated:** No.

**What renders:** HealthScoreWidget + 4 KPI cards + feed items (up to 5 recent WOs + 3 upcoming PMs). Also includes a floating action button for new WO / scan QR / new request.

**Demo verdict:** GOOD if the demo tenant has work orders and PM schedules seeded. If empty, shows only "All caught up" empty state with a checkmark — harmless but lacks the "wow" of a busy maintenance feed. Seed 4-5 realistic WOs + 2-3 upcoming PMs before the demo.

**File:** `mira-hub/src/app/(hub)/feed/page.tsx:180-196` (API calls)

---

### `/login`

**Data source:** static form (NextAuth credential flow).

**Demo verdict:** GOOD. Clean branded login page. Not a blocker.

**File:** `mira-hub/src/app/login/page.tsx`

---

### `/namespace`

**Data source:** real-query. Calls `GET /api/namespace/tree` on mount. Renders a Windows-Explorer-style split-pane file manager. Left panel = collapsible UNS tree. Right panel = node details, files, proposals count, work orders stub.

**Labs-gated:** No.

**Demo verdict:** GOOD if namespace has been built out. If empty, shows "Your namespace is empty" EmptyState with a "New Folder" CTA — acceptable. The "Work order view coming soon" stub in the content panel (line 816) is a minor blemish on equipment nodes but won't be visible unless the reviewer specifically clicks the Work Orders tab in the right pane.

**File:** `mira-hub/src/app/(hub)/namespace/page.tsx:100` (API call)

---

### `/proposals` (was a standalone page)

**Redirects to `/knowledge/suggestions`** — not a separate page anymore. `mira-hub/src/app/(hub)/proposals/page.tsx:3`: `redirect("/knowledge/suggestions")`.

**The real proposals page is `/knowledge/suggestions`** — real-query on `GET /api/proposals?status=proposed`. Shows Pending / Verified / Rejected tabs. Empty state shows "Upload a manual or run a photo walk". Good UX if proposals exist.

---

### `/assets`

**Data source:** real-query. `GET /api/assets`. Renders a 4-column grid of asset tiles with status badges.

**Labs-gated:** No.

**Demo verdict:** GOOD if assets exist. Empty state shows a search icon + "No assets found" — benign. Has a "New Asset" modal and "Export CSV" button.

**File:** `mira-hub/src/app/(hub)/assets/page.tsx:414` (API call)

---

### `/assets/[id]`

**Data source:** MIXED. The asset header (`GET /hub/api/assets/[id]/`) is real. However, **4 of 7 tabs are hardcoded mock data**:

- `overview` tab — real API data mapped via `apiToDisplay()`
- `ask` tab — live `AssetChat` component (real)
- `intelligence` tab — `AssetIntelligencePanel` (appears real)
- **`activity` tab** — hardcoded `ACTIVITY_EVENTS` array (line 42-50): fake timestamps like "2026-04-22 09:05", "2026-04-15 14:30"
- **`workorders` tab** — hardcoded `WO_LIST` array (line 52-57): 4 fake work orders for "Air Compressor #1"
- **`documents` tab** — tries real `GET /api/assets/[id]/documents/`, falls back to `DOCS_LIST` mock (line 59-64) if empty. Shows "(demo)" label.
- **`parts` tab** — hardcoded `PARTS_LIST` array (line 66-71)

**Demo verdict:** DEMO_BLOCKER. If Mike clicks the Activity, Work Orders, or Parts tabs on an asset that has no real data, he'll see fake entries with hardcoded names ("John S.", "WO-2026-007", "Air Compressor #1") that don't match the actual asset he navigated to. This is embarrassing on camera. **Mitigation:** only demo the Overview and Ask MIRA tabs, or seed real WO+activity data for the demo asset.

**File:** `mira-hub/src/app/(hub)/assets/[id]/page.tsx:42-71` (mock data blocks)

---

### `/assets/[id]/signals`

**Does not exist as a page.** There is an API route at `/api/assets/[id]/signals` (called by `AssetIntelligencePanel`) but no standalone page route. The signals view is embedded inside the asset detail page's "Intel" tab. Do not navigate to this URL directly.

---

### `/documents`

**DEMO_BLOCKER.** Gated behind Labs flag. First line of the render function (line 41): `if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") return <LabsStub feature="Documents" />;`. Shows "Coming Soon" card in prod. The hardcoded `DOCS` array exists but is never shown.

**File:** `mira-hub/src/app/(hub)/documents/page.tsx:41-43`

---

### `/command-center`

**Data source:** real-query. Polls `GET /api/command-center/tree` every 10 seconds. Shows a UNS tree on the left and an iframe viewer on the right for nodes that have `hasLiveDisplay=true`. Shows freshness status (live/stale/simulated/unknown) using telemetry data from the tag events system.

**Labs-gated:** No.

**Demo verdict:** GOOD if displays are configured. Empty tree shows "No equipment in the namespace yet." If the Ignition display is configured and reachable, this is a strong demo page. If the Ignition gateway on the PLC laptop is down, the iframe shows "display down" — not a crash, just a status indicator.

**File:** `mira-hub/src/app/(hub)/command-center/page.tsx:64` (API call)

---

### `/knowledge` → `/knowledge/map` (Knowledge Graph)

**`/knowledge` redirects** to `/knowledge/map` (the graph view).

**`/knowledge/map` data source:** real-query on `GET /api/kg/graph?includeProposals=true`. Dark-background force-directed knowledge graph. Shows verified edges (solid lines) and proposed edges (dashed). Has node type filters, search, "Show suggestions" toggle.

**Labs-gated:** No.

**Demo verdict:** GOOD if the KG has entities and edges. If empty (0 verified, 0 proposed), shows a blank dark canvas — embarrassing. **Mitigation:** ensure at least a few manuals are ingested so some entity nodes exist. Even with 0 verified edges, if proposals exist it auto-enables "Show suggestions" and shows dashed edges.

**`/knowledge/manuals` data source:** real-query on `GET /api/knowledge` (manufacturer list + stats). Shows manufacturer cards, then drills into models/docs per manufacturer. Also shows active upload queue from `GET /api/uploads`.

**Demo verdict:** GOOD if manuals are indexed. Empty state has a nice "Upload a PDF manual" CTA drag-drop zone — passable on camera.

---

### `/reports`

**DEMO_BLOCKER.** Hard-coded Labs gate at line 57: `if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") return <LabsStub feature="Reports" />;`. Shows "Coming Soon" card.

The charts below the gate (KPI_DATA, DOWNTIME_DATA, WO_COMPLETION_DATA, TOP_PROBLEM_ASSETS, PM_COMPLIANCE_DATA) are all hardcoded mock arrays — they render beautifully but are fake. None of this is visible in prod.

**File:** `mira-hub/src/app/(hub)/reports/page.tsx:57-59`

---

### `/settings`

**DOES NOT EXIST as a hub page.** When navigated to on prod, gets a 307→login redirect. The "settings" surface is split across:
- `/channels` — communication channel connections (Telegram, Slack, Google, Dropbox, etc.)
- `/integrations` — CMMS integrations (Atlas, Limble, MaintainX, webhooks, API key)

Do NOT navigate to `/settings` on camera — it will redirect to login.

---

### `/discovery`

**DOES NOT EXIST as a hub page.** Returns 307→login. There is a `/fieldbus-discovery` feature in the `plc/` directory of the monorepo (CLI tool), but it has no Hub UI page. The hub page list does not include a `/discovery` route. This was apparently never built as a Hub page.

---

### `/plc`

**DOES NOT EXIST as a hub page.** Returns 307→login. PLC connectivity is handled via Ignition cloud-chat, not a Hub page. Do NOT navigate to `/plc` on camera.

---

### `/integrations`

**Data source:** hardcoded-mock CMMS_SYSTEMS and WEBHOOKS arrays with no API backing. Shows:
- Atlas CMMS as "connected" with fake sync stats: `assets: 47, workorders: 312, lastSync: "2 min ago"` (hardcoded, line 33-38)
- Slack, Teams, Email webhooks with fake timestamps ("7:15 AM", "9:05 AM", "8:32 AM")
- API key section shows a fake key `mlm_sk_prod_a7f3c9d1e2b4g8h5...` with fake stats ("847 actions", "Pro tier")

**Demo verdict:** DEMO_BLOCKER — the sync stats ("47 assets", "312 WOs", "2 min ago") are hardcoded lies. They will not match the actual Hub data. The webhook URLs are truncated placeholders. **Mitigation:** navigate to `/channels` instead, which shows real connector state.

**File:** `mira-hub/src/app/(hub)/integrations/page.tsx:29-38, 58-63`

---

### `/alerts`

**DEMO_BLOCKER.** Labs-gated (line 84): `if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") return <LabsStub feature="Alerts" />;`. Shows "Coming Soon" in prod.

The hardcoded mock data (lines 25-66) is actually quite impressive — arc flash hazards, CNC vibration anomalies, bearing temps. But none of it is visible.

**File:** `mira-hub/src/app/(hub)/alerts/page.tsx:84-86`

---

### `/conversations`

**DEMO_BLOCKER.** Labs-gated (line 83): `if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") return <LabsStub feature="Conversations" />;`. Shows "Coming Soon" in prod.

The mock has 5 rich fake conversation threads across Telegram/Email/WhatsApp/Open WebUI — but invisible.

**File:** `mira-hub/src/app/(hub)/conversations/page.tsx:83-85`

---

### `/team`

**DEMO_BLOCKER.** Labs-gated (line 104): `if (process.env.NEXT_PUBLIC_LABS_ENABLED !== "true") return <LabsStub feature="Team" />;`. Shows "Coming Soon" in prod.

Note: the page also fetches real users via `GET /api/team` (line 130) — but the real query result is hidden behind the Labs gate.

**File:** `mira-hub/src/app/(hub)/team/page.tsx:104-106`

---

### `/workorders`

**Data source:** real-query. `GET /api/work-orders`. Shows tabs (All/Open/In Progress/Completed), search, export CSV, auto-PM count badge.

**Labs-gated:** No.

**Demo verdict:** GOOD if WOs exist. Empty state has "No work orders" + "Create first" CTA — acceptable. With a few seeded WOs showing auto-PM badges and source citations from manuals, this is a strong demo page.

---

### `/workorders/[id]`

**Data source:** real-query. `GET /hub/api/work-orders/[id]`. Loads full WO with suggested actions, safety warnings, parts needed, source citation (manual quote). Parts picker uses a local `PARTS` array from `lib/parts-data` — mock. Comments are local state only (client-side, not persisted). Timer is client-state.

**Demo verdict:** GOOD for demo. The real WO data is rich if properly seeded (auto-PM with source_citation shows the manual quote prominently). The "Ask MIRA" CTA links to Telegram bot. Comments being local-only is a minor gap but not visible unless actively demonstrated.

---

### `/schedule`

**Data source:** real-query. `GET /api/pm-schedules`. Calendar + list view. Shows overdue count, AI-extracted PM badge. The PMSheet bottom drawer shows rich detail (parts, tools, safety requirements, trigger type, meter thresholds).

**Labs-gated:** No.

**Demo verdict:** GOOD if PMs are seeded. An empty calendar is just a blank grid — benign but boring. With 5-10 seeded PMs including some overdue and some auto-extracted, this is a strong demo page.

---

## Missing / Non-Existent Routes

| Route Mike Asked About | Status | What to Navigate To Instead |
|---|---|---|
| `/discovery` | Does not exist — 307→login | No hub UI for fieldbus discovery |
| `/settings` | Does not exist — 307→login | `/channels` (connectors) or `/integrations` |
| `/plc` | Does not exist — 307→login | `/command-center` for live PLC tag view |
| `/assets/[id]/signals` | Not a page — it's an API route `/api/assets/[id]/signals` | `/assets/[id]` (Intel tab) |

---

## DEMO_BLOCKER Pages

These are pages that would embarrass Mike on camera:

| # | Route | Why It's a Blocker | Fix |
|---|---|---|---|
| 1 | `/reports` | "Coming Soon" card (Labs-gated) | Set `NEXT_PUBLIC_LABS_ENABLED=true` OR remove/skip from demo path |
| 2 | `/alerts` | "Coming Soon" card (Labs-gated) | Same |
| 3 | `/conversations` | "Coming Soon" card (Labs-gated) | Same |
| 4 | `/documents` | "Coming Soon" card (Labs-gated) | Use `/knowledge/manuals` instead |
| 5 | `/parts` | "Coming Soon" card (Labs-gated) | Same — use asset detail parts tab |
| 6 | `/requests` | "Coming Soon" card (Labs-gated) | Remove from demo path |
| 7 | `/team` | "Coming Soon" card (Labs-gated) | Remove from demo path |
| 8 | `/assets/[id]` — activity/WO/parts tabs | Hardcoded mock data with wrong asset names | Stick to Overview + Ask MIRA tabs |
| 9 | `/integrations` | Hardcoded fake sync stats (47 assets, 312 WOs, "2 min ago") | Use `/channels` instead |
| 10 | `/feed` (if empty) | Empty "All caught up" state with no data | Seed demo tenant data |
| 11 | `/parts/[id]` | Reads from hardcoded PARTS array — always fake, always "Air Filter" etc. | Don't navigate to parts detail on camera |
| 12 | `/documents/[id]` | Reads from hardcoded DOCS array — only reachable via Labs-gated `/documents` | Moot if `/documents` not shown |

---

## What Data Needs Seeding for the Demo Tenant

The following are real-query pages that will show empty state or no data unless seeded:

### Critical (directly affects featured demo pages)

1. **Work orders** (`cmms_work_orders` table) — needed by `/feed`, `/workorders`, `/workorders/[id]`, KPI cards  
   - Seed: 5-8 WOs with varied statuses (open, in_progress, completed), at least 2 auto-PM with `source_citation`, one with `safety_warnings` array populated
   - Script: `tools/seed_demo_tenant_pms.sql` (partial — check if it covers WOs too)

2. **PM schedules** (`pm_schedules` table) — needed by `/feed`, `/schedule`  
   - Seed: 6-10 PMs including 1-2 overdue, 3-4 upcoming, with `auto_extracted=true` and `source_citation` text

3. **Assets** (`cmms_assets` table) — needed by `/assets`, `/assets/[id]`  
   - Seed: 4-6 assets with manufacturer, model, location, criticality. At least one with documents linked.
   - Minimum to avoid empty grid on camera.

4. **Knowledge base / manuals** (`knowledge_entries` table) — needed by `/knowledge/manuals`  
   - If 0 manufacturers indexed, shows upload CTA only. Seed at least 2-3 manuals for demo OEMs.

5. **Namespace tree** (`kg_entities` table) — needed by `/namespace`, `/command-center`  
   - Seed: site → area → line → equipment hierarchy matching the demo plant (garage demo cell)
   - Without this, namespace page shows empty state.

### Important (affects secondary demo pages)

6. **KG entities + relationships** — needed by `/knowledge/map` (graph view)  
   - Without entities, the graph is a blank dark canvas. Seed entities from the namespace + some proposed relationships.

7. **Events** (`diagnostic_events` or equivalent) — needed by `/event-log`, `/usage`  
   - Without events, event-log shows empty; usage charts show nothing.

8. **Proposals** (`ai_suggestions` / `relationship_proposals`) — needed by `/knowledge/suggestions`  
   - Without proposals, shows empty state with helpful CTA — acceptable but boring.

### Not needed (real pages with acceptable empty states)

- `/channels` — reads auth status; renders connector cards regardless
- `/onboarding` — wizard renders with no data
- `/scan` — camera API, no data dependency
- `/upgrade` — static pricing page
- `/login`, `/signup` — static forms

---

## Labs Flag Option

Setting `NEXT_PUBLIC_LABS_ENABLED=true` in the prod Doppler config would unlock all 7 gated pages and show their hardcoded mock data. This is a trade-off:

**Pro:** Instantly unblocks 7 pages without seeding. The mock data (alerts, conversations, reports) is well-crafted and looks realistic.

**Con:** The mock data is not linked to the real tenant data. If Mike shows `/reports` (MTTR 2.4h, 312h MTBF, 87% PM compliance) and then navigates to `/workorders` (real data showing different WOs), the numbers won't match. On a polished sales demo video this inconsistency could be visible.

**Recommendation:** For a rapid demo, set `NEXT_PUBLIC_LABS_ENABLED=true` AND seed real data for the real-query pages. This way real pages show accurate data and the gated pages show plausible mock data.

---

## `/feed` HealthScoreWidget Note

The feed page renders a `<HealthScoreWidget />` component at the top. This component is not audited here — check `mira-hub/src/components/HealthScoreWidget.tsx` for its data source and empty state before filming the feed page.

---

*Audit generated by automated code analysis + GET-only live HTTP probing of https://app.factorylm.com. No authenticated requests were made. Mock data claims are verified against source file line numbers above.*
