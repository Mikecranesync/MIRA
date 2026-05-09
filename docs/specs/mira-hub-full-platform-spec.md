# mira-hub — Full Platform Specification

**Domain:** `app.factorylm.com`
**Version:** 1.5.0 (package.json) | Phase 2 deployment (basePath="" at root)
**Spec date:** 2026-05-06
**Owner:** Mike Harper
**Spec branch:** `spec/mira-hub-full-platform`
**Status:** Reference document — every fix session reads this first.

---

## 1. Purpose

This is **the** reference for making `app.factorylm.com` (the mira-hub) 100% functional for Mike. It catalogs every page, navigation item, button, modal, asset, API endpoint, external dependency, environment variable, and database table the hub touches — and grades each one **WORKING / STUB / BROKEN / MISSING** based on direct source inspection on `2026-05-06`.

Every future fix session reads this spec first, picks an item from the punch list at the bottom, and updates the status column when done. No drive-by changes — only fix what is in the punch list.

**The hub is Mike's day-to-day operations platform** (his own factory + a trial of the SaaS for himself). It is not yet sold to external customers, so quality bar is "must work for me" not "must work for 1000 users." But: nothing should be broken or visibly half-built. If a tab is in the sidebar, clicking it must produce something coherent.

---

## 2. Scope

The hub covers nine functional surfaces. Each surface is a sidebar group; the sub-pages of each surface are listed in §5 (Feature Catalog).

| Surface | Purpose | Status (rollup) |
|---|---|---|
| **Auth & Onboarding** | Sign in, sign up, magic link, pending approval, trial-expired upgrade | WORKING |
| **Operations Feed** | Home dashboard — KPI cards, today's briefing, quick actions | STUB (hardcoded values) |
| **Conversations** | Chat history with MIRA across all channels | STUB (hardcoded conversation list) |
| **Actions** | AI-suggested actions queue (timeline of what MIRA has done) | STUB (hardcoded list) |
| **Alerts** | Safety + diagnostic alerts with acknowledge flow | WORKING |
| **Knowledge** | OEM manual upload + indexed KB browser (Google Drive / Dropbox / local) | WORKING |
| **Assets** | Equipment registry, per-asset chat, intelligence enrichment | WORKING |
| **CMMS Bridge** | Atlas CMMS live stats + connection config | PARTIAL (P0 — see CRA-37) |
| **Work Orders + Schedule + PMs + Requests + Parts + Documents + Reports** | Operational tracking surfaces | MIXED (work-orders/schedule WORKING; parts/documents STUB) |
| **Channels & Integrations** | Telegram, Slack, MS Teams, Confluence, Dropbox, Google, Nango credential vault | WORKING |
| **Team & Admin** | User management, role definitions | WORKING (admin/users); STUB (admin/roles) |
| **Billing** | Trial status, upgrade page (Stripe checkout) | STUB (Stripe not wired here — only via mira-web) |

---

## 3. Architecture

### 3.1 Container Topology

The hub is a Next.js 16 standalone app sitting behind nginx alongside ten sibling services. Live deployment is **Phase 2** (deployed 2026-04-27): the hub serves at the root of `app.factorylm.com`; all `/hub/*` URLs 301-redirect to root for 90-day bookmark cleanup.

```
                       Internet
                          │
                          ▼
            nginx (app.factorylm.com:443)
                          │
   ┌──────────────────────┼─────────────────────────────────┐
   │                      │                                 │
   ▼                      ▼                                 ▼
mira-hub (3101)      mira-pipeline (9099)            mira-web (3200)
Next.js standalone   FastAPI OpenAI-compat           Hono PLG funnel
─ All /              ─ /v1/                          ─ /pricing
─ /api/*  (own)      ─ /api/agents/                  ─ /sample, /activated
                     ─ /api/briefing/                ─ /api/checkout
                     ─ /api/identity/                ─ /api/stripe/
   │                      │                                 │
   │   ┌──────────────────┴────────────────┐                │
   │   ▼                                   ▼                │
mira-ingest (8002)              mira-mcp (8001)             │
Doc parsing / ingest            FastMCP REST                │
─ /api/ingest/                  ─ /api/mcp/                 │
   │                                   │                    │
   ▼                                   ▼                    ▼
                NeonDB (Postgres, multi-tenant, RLS by tenant_id)
                                                                  
       Sidebands:                                                 
       chat.factorylm.com → Open WebUI (3010)                     
       cmms.factorylm.com → Atlas CMMS (3100 + API 8088)          
                                                                  
       Credential vault: nango-server (3003), nango-db (5432)     
       LLM providers: Groq → Cerebras → Gemini cascade            
       OAuth: Google sign-in + Drive, Slack, Microsoft, Dropbox,  
              Confluence (Atlassian), Telegram                    
```

### 3.2 Request Flow — typical hub page load

1. User hits `https://app.factorylm.com/feed/`
2. nginx catches `/`, proxies to `127.0.0.1:3101` (mira-hub)
3. Next.js standalone middleware:
   - If path is `/`, redirect to `/feed/` (handled at `src/app/route.ts` Route Handler — Server-Component `redirect()` is broken in Next 16.2.4 standalone+basePath, see comment in `src/middleware.ts:51-58`)
   - `withAuth` checks the NextAuth JWT cookie. If missing → redirect to `/login`.
   - If status is `pending` → `/pending-approval`. If `expired` or trial past `trialExpiresAt` → `/upgrade`.
4. Page renders (Client Component) and fires `fetch('/api/...')` to its own backend routes
5. The API route calls `sessionOr401()` to extract `{ userId, tenantId, role }` from the JWT, then queries NeonDB inside `withTenantContext()` (sets `app.tenant_id` Postgres GUC for RLS scoping)

### 3.3 Auth Flow (NextAuth.js v4, JWT strategy)

Source of truth: `mira-hub/src/auth.ts` + `mira-hub/src/middleware.ts`.

Three providers wired:
1. **Credentials (email + bcrypt password)** — `signIn(email, password)`
2. **Magic Token** — second `CredentialsProvider("magic-token")` validating tokens from `/api/auth/magic-link`
3. **Google OAuth** — `HUB_AUTH_GOOGLE_CLIENT_ID/SECRET` (DISTINCT from `GOOGLE_CLIENT_ID` used for Drive/Gmail integration)

Session JWT carries: `id, email, name, image, tenantId, status, trialExpiresAt`. Middleware reads `status` on every authenticated request and gates accordingly.

⚠️ **`NEXTAUTH_URL` drift:** docker-compose.saas.yml hardcodes `https://app.factorylm.com/hub/api/auth` (Phase 1 layout). Phase 2 nginx redirects `/hub/*` → root, breaking OAuth callbacks if Doppler doesn't override. Verify Google authorized redirect URIs match what Phase 2 produces.

### 3.4 Multi-tenancy

All hub-owned tables (`hub_users`, `hub_channel_bindings`, `kb_chunks`, `cmms_equipment`, `work_orders`, `kg_*`, `agent_*`, etc.) carry `tenant_id`. Postgres RLS is enforced via `withTenantContext()` in `mira-hub/src/lib/tenant-context.ts`, which sets the session-level `app.tenant_id` GUC before running queries. RLS policies on each table use `tenant_id = current_setting('app.tenant_id')::uuid`.

`HUB_TENANT_ID=mike` is the default carried by lib helpers when no session is present (cron, scripts). Real API requests resolve tenant from the NextAuth session.

---

## 4. Page / Route Catalog

Source: direct enumeration of `mira-hub/src/app/` on 2026-05-06.

### 4.1 Public / Auth Routes

| Route | File | Purpose | Status | Notes |
|---|---|---|---|---|
| `/` | `src/app/route.ts` | Route Handler — 301 to `/feed/` | WORKING | Replaces broken `redirect()` in Server Components on Next 16.2.4 standalone+basePath |
| `/login` | `src/app/login/page.tsx` | Email+password and Google OAuth sign-in | WORKING | Lighthouse perf 73 (CRA-50, P2) |
| `/signup` | `src/app/signup/page.tsx` | Account creation, bcrypt password, sets status=`trial` | WORKING | Min 8-char password |
| `/magic` | `src/app/(hub)/magic/page.tsx` | Token-entry screen for magic link auth | WORKING | Validates against `magic_link_tokens` table |
| `/pending-approval` | `src/app/(hub)/pending-approval/page.tsx` | Holding screen when `status=pending` | WORKING | Polls `/api/auth/check-approval` |
| `/upgrade` | `src/app/(hub)/upgrade/page.tsx` | Trial-expired billing CTA, 3 plans (Individual/Team/Enterprise) | STUB | Comment line 45: `// Stripe checkout — placeholder until Stripe is wired`. Stripe lives in mira-web only. |

### 4.2 Hub Routes (route group `(hub)`, all auth-gated)

| Route | File | Purpose | API calls | Status |
|---|---|---|---|---|
| `/feed` | `(hub)/feed/page.tsx` | Home dashboard — KPI cards, briefing, quick actions | none (hardcoded KPIs) | **STUB** — KPI values "12", "3", "2.4h", "67%" hardcoded |
| `/conversations` | `(hub)/conversations/page.tsx` | Chat history per technician/channel | none | **STUB** — `Conversation` type with hardcoded fixture |
| `/actions` | `(hub)/actions/page.tsx` | Timeline of MIRA-taken actions (WO created, PM scheduled, lookups, alerts) | none | **STUB** — hardcoded `Action[]` |
| `/alerts` | `(hub)/alerts/page.tsx` | Safety + diagnostic alerts | `/api/events` | WORKING — pulls from `work_orders` with `safety_warnings != '{}'` |
| `/knowledge` | `(hub)/knowledge/page.tsx` | OEM manual library — upload + indexed chunks browser | 5 calls (uploads, knowledge, picker tokens) | WORKING — but `/api/uploads/` 500 in prod (CRA-38, P0) |
| `/assets` | `(hub)/assets/page.tsx` | Equipment registry list + create form | `/api/assets` | WORKING |
| `/assets/[id]` | `(hub)/assets/[id]/page.tsx` | Asset detail with WO history, chat, intelligence panel | `/api/assets/[id]`, `/api/assets/[id]/chat`, `/api/assets/[id]/enrich` | PARTIAL — comment `/* Mock data */` line 16; some sections hardcoded |
| `/cmms` | `(hub)/cmms/page.tsx` | Atlas CMMS connection status + live stats | `/api/cmms/stats` | **BROKEN** in prod — 503 on `/api/cmms/stats/` (CRA-37, P0). Has `STATIC_SUMMARY` fallback. |
| `/channels` | `(hub)/channels/page.tsx` | Telegram + Slack + MS Teams chat-channel bindings | `/api/channels` | WORKING |
| `/integrations` | `(hub)/integrations/page.tsx` | Third-party connectors (Google Drive, Slack, Confluence, Dropbox, MaintainX via Nango) | `/api/connections`, `/api/integrations/nango/connect` | WORKING |
| `/workorders` | `(hub)/workorders/page.tsx` | Work order list with filters | `/api/work-orders` | WORKING — has hardcoded fallback "while loading" (line 57) |
| `/workorders/[id]` | `(hub)/workorders/[id]/page.tsx` | WO detail — status, parts, comments, completion | `/api/work-orders/[id]` (GET + PATCH) | WORKING (CRA-19 closed 2026-05-04) |
| `/workorders/new` | `(hub)/workorders/new/page.tsx` | Create-WO form | none | **STUB** — `/* Mock asset search results */` line 10 |
| `/schedule` | `(hub)/schedule/page.tsx` | PM calendar (rrule-based) | `/api/pm-schedules` | WORKING |
| `/requests` | `(hub)/requests/page.tsx` | Maintenance request inbox | `/api/events` (filtered) | WORKING — has inline "create request" form |
| `/requests/new` | `(hub)/requests/new/page.tsx` | Submit a request | none | STUB — no submit endpoint visible |
| `/parts` | `(hub)/parts/page.tsx` | Inventory list + low-stock filter | none | **STUB** — uses `PARTS, CATEGORIES, OEMS` from `lib/parts-data.ts` (hardcoded) |
| `/parts/[id]` | `(hub)/parts/[id]/page.tsx` | Part detail | none | STUB — hardcoded; "Photo placeholder" |
| `/documents` | `(hub)/documents/page.tsx` | Document library (manuals, drawings) | none | **STUB** — uses `documents-data` from lib (hardcoded) |
| `/documents/[id]` | `(hub)/documents/[id]/page.tsx` | Doc detail with version history | none | STUB — "Document preview placeholder" line 79 |
| `/reports` | `(hub)/reports/page.tsx` | KPI charts (MTTR, MTBF, OEE) + AI summary generator | `/api/reports/generate` (POST) | PARTIAL — KPI cards `/* Static mock values */`; AI summary IS wired to LLM cascade |
| `/usage` | `(hub)/usage/page.tsx` | Token + action consumption per channel/tech | `/api/usage` | WORKING |
| `/event-log` | `(hub)/event-log/page.tsx` | Raw chronological event timeline | `/api/events` | WORKING |
| `/team` | `(hub)/team/page.tsx` | User list + role chips | `/api/team` | WORKING |
| `/admin/users` | `(hub)/admin/users/page.tsx` | Admin user management — approve, change role, expire trial | `/api/admin/users`, `/api/admin/users/[id]` | WORKING (CRA-43 closed 2026-05-06) |
| `/admin/roles` | `(hub)/admin/roles/page.tsx` | Role × permission matrix | none | **STUB** — `RoleDef` array hardcoded; not editable. Linked from sidebar. |
| `/more` | `(hub)/more/page.tsx` | Mobile fallback "all-nav" page | none | WORKING — pure nav links |

### 4.3 Layouts & Providers

| File | Role |
|---|---|
| `src/app/layout.tsx` | Root layout — wraps `RefineProviders`, `ThemeProvider`, `I18nProvider`, `ToastProvider`. Sets favicon + metadata. |
| `src/app/(hub)/layout.tsx` | Hub layout — `force-dynamic`, renders Sidebar + BottomTabs + MobileTopbar + TrialBanner around `{children}`. Authenticates via `auth()` server-side. |
| `src/middleware.ts` | NextAuth `withAuth` wrapper + `/` → `/feed` redirect + status gate routing. |
| `src/auth.ts` | NextAuth options — Credentials, MagicToken, Google providers; JWT callbacks enrich session with tenantId/status/trialExpiresAt. |
| `src/providers/access-control.ts` | RBAC config + sidebar `NAV_ITEMS` (single source of truth for nav). |
| `src/providers/data-provider.ts` | Refine simple-rest provider pointed at `NEXT_PUBLIC_PIPELINE_API_URL`. |
| `src/providers/auth-provider.ts` | Refine auth-provider bridge over NextAuth session. |
| `src/providers/i18n-provider.tsx` | next-intl wrapper. Locales: `en`, `es`, `hi`, `zh`. |
| `src/providers/theme-provider.tsx` | Light/dark toggle, persisted in localStorage. |
| `src/providers/toast-provider.tsx` | Toast notifications (used by cmms page, integrations). |

---

## 5. Component / UI Catalog

### 5.1 Navigation (single source: `src/providers/access-control.ts` NAV_ITEMS)

**Desktop sidebar — primary group** (visible to all authenticated roles unless noted):

| Label | Route | Icon | Roles |
|---|---|---|---|
| Event Log | `/event-log` | `Activity` | all |
| Conversations | `/conversations` | `MessageSquare` | all |
| Actions | `/actions` | `Zap` | all |
| Alerts | `/alerts` | `AlertTriangle` | all |
| Knowledge | `/knowledge` | `BookOpen` | all |
| Assets | `/assets` | `Wrench` | all |
| Channels | `/channels` | `Radio` | manager, scheduler, admin, owner |
| Integrations | `/integrations` | `Plug` | manager, admin, owner |
| Usage | `/usage` | `BarChart2` | manager, admin, owner |
| Team | `/team` | `Users` | manager, admin, owner |

**Desktop sidebar — secondary group** (below divider, "More" label when collapsed):

| Label | Route | Icon | Roles |
|---|---|---|---|
| Work Orders | `/workorders` | `ClipboardList` | all |
| Schedule | `/schedule` | `CalendarDays` | all |
| Requests | `/requests` | `Inbox` | all |
| Parts | `/parts` | `Package` | all |
| Documents | `/documents` | `FileText` | all |
| Reports | `/reports` | `TrendingUp` | manager, scheduler, admin, owner |
| Admin | `/admin/users` | `Settings` | admin, owner |

**Mobile bottom-tabs** (4 items + More drawer): Event Log, Channels, Actions, Team, More.
**Mobile drawer** (right-slide sheet): all nav items + Admin.
**Mobile top-bar:** logo (links to `/feed`), language selector, theme toggle.

⚠️ The sidebar nav ordering does **not** include `/feed` even though `/` redirects there. Feed is the implicit home — only reachable via the logo or initial redirect. Acceptable for now, document for later.

### 5.2 Components

| File | Purpose |
|---|---|
| `components/layout/sidebar.tsx` | Desktop nav, collapse, theme/language/logout, user profile card |
| `components/layout/bottom-tabs.tsx` | Mobile bottom-tab bar with safe-area-inset padding |
| `components/layout/mobile-drawer.tsx` | Slide-in mobile menu, swipe-to-close, ESC-to-close |
| `components/layout/mobile-topbar.tsx` | Sticky top bar with logo + controls |
| `components/onboarding/tour.tsx` | First-login 5-step tour (Conversations → Assets → Knowledge → WOs → Reports). Persists to `localStorage("mira_tour_v1")` |
| `components/AssetChat.tsx` | Inline asset-scoped chat, persists to `localStorage("mira_chat_${assetId}")` |
| `components/AssetIntelligencePanel.tsx` | Enrichment UI (KB hits, KG, web, OEM, YouTube) — calls `/api/assets/[id]/enrich` |
| `components/UploadPicker.tsx` | Google Drive + Dropbox file picker (multiselect PDF/image) |
| `components/UploadBlock.tsx` | Per-upload status display (queued/fetching/parsing/parsed/failed/cancelled) |
| `components/trial-banner.tsx` | Top banner — trial days remaining, urgent at ≤4 days |
| `components/ui/{badge,button,card,input,select,skeleton,tabs,language-selector}.tsx` | shadcn primitives (light wrappers) |

### 5.3 Modals / Forms

The hub uses **inline forms and slide-in panels** rather than modal dialogs. Notable forms:

| Form | Page | Submit endpoint | Status |
|---|---|---|---|
| Login (credentials) | `/login` | `/api/auth/callback/credentials` (NextAuth) | WORKING |
| Login (Google) | `/login` | NextAuth `signIn("google")` | WORKING (when env set) |
| Signup | `/signup` | `/api/auth/register` (rate-limited 5/hr/IP) | WORKING |
| Magic-link entry | `/magic` | `/api/auth/magic-link` then NextAuth `signIn("magic-token")` | WORKING |
| New Asset | `/assets` (inline form) | `POST /api/assets` (TBD — need to verify) | PARTIAL |
| New WO | `/workorders/new` | (no endpoint) | **STUB** — form posts nowhere |
| New Request | `/requests/new` | (no endpoint) | STUB |
| Add CMMS connection | `/cmms` | `POST /api/connections` | WORKING |
| Add Nango credential | `/integrations` (drawer) | `POST /api/integrations/nango/connect` | WORKING |
| WO complete | `/workorders/[id]` | `PATCH /api/work-orders/[id]` | WORKING |

### 5.4 Static Assets

| File | Where referenced | Status |
|---|---|---|
| `public/favicon.svg` | `src/app/layout.tsx` icon | WORKING |
| `public/onboarding/panel-1.png` | (not grepped in src) | UNUSED — onboarding tour overlays the live UI, not a static panel |
| `public/onboarding/walkthrough.md` | (not referenced) | UNUSED — possibly authoring notes |
| `public/{file,globe,next,vercel,window}.svg` | (not referenced) | LEGACY — Next.js scaffold leftovers, safe to delete |

**Iconography:** all icons are `lucide-react` components (no static SVG sprites). 23 distinct icons mapped in `ICON_MAP` inside `sidebar.tsx`.

### 5.5 i18n

`next-intl` with namespaces: `nav`, `common`, `feed`, `assets`, `workorders`, `schedule`, `knowledge`, `channels`, `integrations`, `team`, `usage`, `more`, `cmms`, plus per-page sub-namespaces. Locales: `en` (default), `es`, `hi`, `zh`.

⚠️ Many pages use translation keys that are likely only complete in `en.json`. Spot-check before claiming i18n is "done."

---

## 6. API Contract

### 6.1 Hub-owned endpoints (all under `mira-hub/src/app/api/`)

All authenticated endpoints call `sessionOr401()` first, then `withTenantContext(ctx.tenantId, ...)` for tenant-scoped DB queries. All return JSON. `force-dynamic` on every route (no static caching).

#### Auth (13 endpoints)

| Method | Path | Purpose | Auth | Status |
|---|---|---|---|---|
| GET, POST | `/api/auth/[...nextauth]` | NextAuth handler — sign in, sign out, session, callbacks | NextAuth | WORKING |
| POST | `/api/auth/register` | Email+password signup, bcrypt, rate-limited 5/hr/IP, CORS-locked | none (rate-limited) | WORKING |
| POST | `/api/auth/magic-link` | Issue + email a magic-link token | NextAuth or unauthenticated | WORKING — depends on Resend |
| GET | `/api/auth/check-approval` | Polled by `/pending-approval` | NextAuth | WORKING |
| GET | `/api/auth/status` | Current session status / role | NextAuth | WORKING |
| GET, POST | `/api/auth/google` | Drive/Gmail integration OAuth start | NextAuth | WORKING |
| GET | `/api/auth/google/callback` | Drive/Gmail OAuth callback → store token | NextAuth | WORKING |
| GET, POST | `/api/auth/slack` | Slack OAuth start (or paste-token shortcut) | NextAuth | WORKING |
| GET | `/api/auth/slack/callback` | Slack OAuth callback | NextAuth | WORKING |
| GET, POST | `/api/auth/microsoft` | MS Teams/O365 OAuth start | NextAuth | WORKING |
| GET | `/api/auth/microsoft/callback` | MS OAuth callback | NextAuth | WORKING |
| GET, POST | `/api/auth/dropbox` | Dropbox OAuth start | NextAuth | WORKING |
| GET | `/api/auth/dropbox/callback` | Dropbox OAuth callback | NextAuth | WORKING |
| GET, POST | `/api/auth/confluence` | Atlassian Confluence OAuth start | NextAuth | WORKING |
| GET | `/api/auth/confluence/callback` | Confluence OAuth callback | NextAuth | WORKING |
| POST | `/api/auth/telegram` | Telegram bot-token validation + binding | NextAuth | WORKING |
| GET | `/api/auth/openwebui` | Token exchange for Open WebUI KB delete | NextAuth | WORKING |

#### Work Orders (2 + nested)

| Method | Path | Purpose | DB | Status |
|---|---|---|---|---|
| GET | `/api/work-orders` | List WOs for tenant, parses suggested_actions / safety_warnings, derives `manual_reference` and parts/tools from description text | `work_orders` | WORKING |
| GET, PATCH | `/api/work-orders/[id]` | Detail + status change + completion validation | `work_orders` (+ `wo_completion_validation.ts` lib) | WORKING |

#### Assets (4)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/assets` | List equipment for tenant | WORKING |
| GET | `/api/assets/[id]` | Asset detail with WO history aggregates | WORKING |
| POST | `/api/assets/[id]/chat` | LLM cascade chat scoped to one asset's KB context | WORKING — uses safety keyword scan |
| POST | `/api/assets/[id]/enrich` | Fire-and-forget enrichment — KB, KG, CMMS, web (Exa), OEM, YouTube. Writes `asset_enrichment_jobs`. | WORKING |

#### PM Schedules (3)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET, POST | `/api/pm-schedules` | List + create rrule-based PM rules | WORKING |
| GET, PATCH, DELETE | `/api/pm-schedules/[id]` | Detail + update + delete | WORKING |
| POST | `/api/pm-schedules/[id]/meter` | Record a runtime/meter reading; triggers PM if threshold crossed | WORKING |

#### Knowledge / Uploads (5)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/knowledge` | Aggregate kb_chunks by manufacturer/category/product_family with quality scores | WORKING |
| GET, POST | `/api/uploads` | List + create upload (Google or Dropbox external file) | **BROKEN in prod** — 500 on GET (CRA-38, P0) |
| GET, DELETE | `/api/uploads/[id]` | Detail + cancel | WORKING |
| POST | `/api/uploads/[id]/retry` | Re-run ingest pipeline | WORKING |
| POST | `/api/uploads/local` | Direct file upload (multipart) | WORKING |
| GET | `/api/picker/google/token` | Mint short-lived Google Picker token | WORKING |
| GET | `/api/picker/dropbox/key` | Return Dropbox app key for client-side chooser | WORKING |
| POST | `/api/kg/sync` | Trigger CMMS → KG sync (admin-only) | WORKING |

#### Integrations / Connections (3)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET, POST, DELETE | `/api/connections` | List/create/remove channel bindings (per provider) | WORKING |
| GET, DELETE | `/api/connections/[provider]` | Get/remove specific provider binding | WORKING |
| POST | `/api/integrations/nango/connect` | Store API-key credential in Nango vault | WORKING |
| GET | `/api/integrations/nango/callback` | Nango OAuth callback | WORKING |
| GET, POST, DELETE | `/api/channels` | Telegram/Slack/MS Teams channel CRUD | WORKING |

#### Operational (8)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/me` | Current user profile + initials | WORKING |
| GET | `/api/team` | Team list (`hub_users` for tenant) | WORKING |
| GET | `/api/usage` | Aggregated work_orders by source/tech/day for current month | WORKING |
| GET | `/api/events` | All events (work_orders) for activity feed | WORKING |
| GET | `/api/events/[id]` | Single event detail | WORKING |
| GET | `/api/conversations` | Conversation list (placeholder — TBD what this returns; conversations page does NOT call this) | UNCLEAR — page is hardcoded |
| GET | `/api/cmms/stats` | Atlas CMMS live stats via basic-auth + token cache | **BROKEN in prod** — 503 (CRA-37, P0) |
| POST | `/api/reports/generate` | LLM cascade prompt → AI maintenance summary | WORKING (when keys set) |
| GET, POST | `/api/user/preferences` | User-scoped JSON prefs | WORKING |
| GET, POST | `/api/export` | Export tenant data as zip (archiver) | WORKING |
| GET | `/api/health` | Liveness probe — returns `{ ok: true }` | WORKING |

#### Admin (2 nested + 1 root)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `(hub)/api/admin/users` | List all users for tenant (admin role required) | WORKING |
| PATCH, DELETE | `(hub)/api/admin/users/[id]` | Approve, change role, expire trial, delete | WORKING |
| GET | `(hub)/api/auth/check-approval` | Pending-approval polling endpoint | WORKING |

#### Agent endpoints (3 — server-side jobs)

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/agents/morning-brief` | Generate per-tenant morning briefing (cron-callable) | WORKING |
| POST | `/api/agents/pm-escalation/check` | Scan PMs, escalate overdue ones | WORKING |
| POST | `/api/agents/safety-events` | Surface unresolved safety alerts | WORKING |

### 6.2 Outbound — services the hub calls

| Service | Base URL var | Used by | Purpose |
|---|---|---|---|
| **NeonDB Postgres** | `NEON_DATABASE_URL` | every API route via `lib/db.ts` (`pg.Pool`) and `lib/tenant-context.ts` | Primary data store, RLS enforced |
| **mira-pipeline** | `NEXT_PUBLIC_PIPELINE_API_URL` | Refine data provider (`providers/data-provider.ts`) | OpenAI-compat chat for Refine consumers (currently underused) |
| **mira-ingest** | `INGEST_URL` | `lib/upload-pipeline.ts`, `lib/mira-ingest-client.ts` | Document ingestion, OCR, chunking, embedding |
| **Open WebUI** | `OPENWEBUI_BASE_URL` + `OPENWEBUI_API_KEY` | `/api/auth/openwebui` + KB delete in upload pipeline | Knowledge-collection management |
| **Atlas CMMS** | `HUB_CMMS_API_URL` + `ATLAS_API_USER` + `ATLAS_API_PASSWORD` | `/api/cmms/stats` | Live work-order/asset/PM counts |
| **Nango** | `NANGO_SERVER_URL` + `NANGO_SECRET_KEY` | `lib/nango.ts` | Credential vault for MaintainX (and future CMMS connectors) |
| **Resend** | `RESEND_API_KEY` | `/api/auth/magic-link` | Email magic-link tokens |
| **Groq → Cerebras → Gemini** | `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` | `/api/reports/generate`, `/api/assets/[id]/chat`, agent endpoints | LLM cascade (no Anthropic — see project_anthropic_removal memory) |
| **Exa** | `EXA_API_KEY` | `lib/agents/asset-intelligence.ts` | Web search for asset enrichment |
| **HubSpot** | `HUBSPOT_API_KEY` | TBD (referenced in env, possibly leads pipeline) | (Likely unused inside hub — review) |
| **Google APIs** | `GOOGLE_PICKER_API_KEY` + Drive scope OAuth | Picker, Drive integration | File picker + manual ingest |
| **Slack / Microsoft / Dropbox / Atlassian** | OAuth client/secret pairs | `/api/auth/<provider>/...` | Channel and integration binding |
| **Telegram Bot API** | `TELEGRAM_BOT_TOKEN` | `/api/auth/telegram` | Validate pasted bot token |

### 6.3 Refine resources

`mira-hub/src/providers/data-provider.ts` registers a Refine simple-rest provider against `NEXT_PUBLIC_PIPELINE_API_URL`. Resources in use: TBD (the data provider exists but is barely wired to UI — most pages call hub-internal endpoints directly via `fetch`). Listed here for future hardening.

⚠️ `NEXT_PUBLIC_PIPELINE_API_URL` is **unset in production** (CRA-39, P1). Every authenticated page logs:

```
[hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production
```

Doesn't break anything visible (Refine queries silently fall through to mock paths) but pollutes the console.

---

## 7. Configuration

### 7.1 Environment Variables

Source: grep of `process.env.*` across `mira-hub/src/`. 47 vars referenced; 42 declared in `docker-compose.saas.yml` mira-hub block.

| Variable | Required? | Default | Purpose | Status |
|---|---|---|---|---|
| `NEON_DATABASE_URL` | **YES** | — | Primary Postgres connection | Doppler — present |
| `AUTH_SECRET` | **YES** | — | NextAuth JWT signing | Doppler — present |
| `NEXTAUTH_SECRET` | (alias) | — | Fallback name for AUTH_SECRET | CRA-6: must be in Doppler not compose |
| `NEXTAUTH_URL` | **YES** | `https://app.factorylm.com/hub/api/auth` | OAuth callback base | ⚠️ Phase-2 drift — must be `…/api/auth` (no `/hub/`) |
| `NEXTAUTH_URL_INTERNAL` | yes | same as NEXTAUTH_URL | Server-side OAuth callback | matches |
| `HUB_AUTH_GOOGLE_CLIENT_ID` | yes (for Google sign-in) | — | Sign-in OAuth client | Doppler — present |
| `HUB_AUTH_GOOGLE_CLIENT_SECRET` | yes | — | Sign-in client secret | Doppler — present |
| `OAUTH_TOKEN_ENC_KEY` | yes (if storing OAuth tokens) | — | AES-256-GCM key for `hub_channel_bindings` token encryption | Doppler — present |
| `HUB_TENANT_ID` | yes | `mike` | Default tenant for cron/scripts | hardcoded default |
| `NEXT_PUBLIC_APP_URL` | yes | `https://app.factorylm.com` | Public hub URL | hardcoded default |
| `NEXT_PUBLIC_PIPELINE_API_URL` | **YES (build-time)** | — | Refine data provider base | **MISSING in prod** (CRA-39) |
| `NEXT_PUBLIC_BASE_PATH` | build-arg | `""` (Phase 2) / `/hub` (Phase 1) | Next.js basePath, **baked at build** | Phase 2 set |
| `NEXT_PUBLIC_API_BASE` | build-arg | `""` / `/hub` | Asset prefix | Phase 2 set |
| `INGEST_URL` | yes | `http://mira-ingest-saas:8001` | Document ingest service | hardcoded |
| `OPENWEBUI_BASE_URL` | yes | `http://mira-core-saas:8080` | Open WebUI for KB ops | hardcoded |
| `OPENWEBUI_API_KEY` | yes | — | Open WebUI API key | Doppler — present |
| `NANGO_SERVER_URL` | yes (if integrations on) | `http://nango-server:3003` | Credential vault | hardcoded |
| `NANGO_SECRET_KEY` | yes | — | Nango API secret | Doppler — present |
| `GROQ_API_KEY` | yes | — | Groq cascade tier 1 | Doppler — present |
| `GROQ_MODEL` | optional | `llama-3.3-70b-versatile` | Groq model | hardcoded default |
| `CEREBRAS_API_KEY` | yes | — | Cerebras cascade tier 2 | Doppler — present |
| `CEREBRAS_MODEL` | optional | `llama3.1-8b` | Cerebras model | hardcoded default |
| `GEMINI_API_KEY` | yes | — | Gemini cascade tier 3 | Doppler — present (was 403 — verify) |
| `GEMINI_MODEL` | optional | `gemini-2.5-flash` | Gemini model | hardcoded default |
| `HUB_CMMS_API_URL` | yes | `https://cmms.factorylm.com` | Atlas CMMS public URL | hardcoded |
| `ATLAS_API_USER` | yes (for /cmms) | — | Atlas admin email | Doppler — present |
| `ATLAS_API_PASSWORD` | yes | — | Atlas admin password | Doppler — present |
| `GOOGLE_CLIENT_ID` | for Drive | — | Drive/Gmail OAuth client (DIFFERENT from HUB_AUTH_GOOGLE_*) | Doppler — present |
| `GOOGLE_CLIENT_SECRET` | for Drive | — | Drive OAuth secret | Doppler — present |
| `GOOGLE_PICKER_API_KEY` | for Picker | — | Google Picker API key | Doppler — present |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | for Picker | — | GCP project number | Doppler — present |
| `SLACK_BOT_TOKEN` | for Slack | — | xoxb- token shortcut path | Doppler — present |
| `SLACK_CLIENT_ID` | for Slack OAuth | — | Slack OAuth client | Doppler — present |
| `SLACK_CLIENT_SECRET` | for Slack OAuth | — | Slack OAuth secret | Doppler — present |
| `MICROSOFT_CLIENT_ID` | for MS | — | Azure App ID | Doppler — present |
| `MICROSOFT_CLIENT_SECRET` | for MS | — | Azure secret | Doppler — present |
| `DROPBOX_APP_KEY` | for Dropbox | — | Dropbox app key | Doppler — present |
| `DROPBOX_APP_SECRET` | for Dropbox | — | Dropbox app secret | Doppler — present |
| `ATLASSIAN_CLIENT_ID` | for Confluence | — | Confluence OAuth client | Doppler — present |
| `ATLASSIAN_CLIENT_SECRET` | for Confluence | — | Confluence OAuth secret | Doppler — present |
| `TELEGRAM_BOT_TOKEN` | for Telegram | — | Bot token (status endpoint reads this) | Doppler — present |
| `TELEGRAM_BOT_USERNAME` | for Telegram | — | Bot @username | Doppler — present |
| `RESEND_API_KEY` | for magic links | — | Resend email API | Doppler — present |
| `EXA_API_KEY` | optional | — | Web search for asset enrichment | Doppler — verify |
| `HUBSPOT_API_KEY` | possibly unused inside hub | — | HubSpot CRM | Doppler — present |
| `ADMIN_EMAIL` | optional | — | Bootstrap admin email for first-tenant flow | Doppler — verify |
| `OAUTH_BASE_PATH` | build-time | derived | OAuth callback path prefix | derived |
| `FACTORYLMDIAGNOSE_TELEGRAM_BOT_TOKEN` | legacy | — | Earlier Telegram bot var | possibly unused |
| `OLLAMA_BASE_URL` | dev | — | Local LLM fallback | dev only |
| `TEST_DATABASE_URL` | tests | — | Vitest integration tests | dev only |

⚠️ **`.env.template` only lists 1 of these 47 vars.** Mike: this is a documentation gap, not a runtime gap (Doppler `factorylm/prd` carries the values), but anyone trying to run the hub locally without Doppler will hit a wall.

### 7.2 Build-time vs runtime config

| Knob | Where set | When applied | Notes |
|---|---|---|---|
| `basePath` | Build arg → `next.config.ts` | Container build | Phase 2: empty. Changing it requires `docker compose build mira-hub`. |
| `assetPrefix` | Same | Same | Same |
| `trailingSlash: true` | Hardcoded in `next.config.ts` | Build | Required to avoid nginx redirect loop |
| `output: "standalone"` | Hardcoded | Build | Produces single `server.js` for the runtime stage |
| `NEXT_PUBLIC_*` | Doppler at build | Build | Inlined into JS bundles — **changing them requires rebuild** |
| Everything else | Doppler at runtime | `docker compose up` | Container reads at start |

### 7.3 Docker

`docker-compose.saas.yml` (lines 369–460) builds `./mira-hub` with:
- Build args: `NEXT_PUBLIC_BASE_PATH=""`, `NEXT_PUBLIC_API_BASE=""`
- Port: `127.0.0.1:3101:3000` (loopback only — nginx fronts it)
- Network: `mira-net`
- Healthcheck: dual probe `wget /api/health/ || wget /hub/api/health/` (CRA-57 in review)
- 42 env vars wired through

`docker-compose.hub.yml` is a **standalone single-service compose** for testing the hub in isolation. Has older env-var layout (uses `NEXTAUTH_SECRET` not `AUTH_SECRET`). Don't deploy from this on prod.

### 7.4 Nginx (Phase 2 — `nginx-phase2-live.conf` deployed 2026-04-27)

Server `app.factorylm.com:443`:

| Path pattern | Upstream | Service |
|---|---|---|
| `= /` | (301 → /feed/) | redirect |
| `^~ /hub/` | (301 → root, 90-day cleanup) | redirect |
| `= /agents` | static `/opt/mira/agent-dashboard.html` | static |
| `/api/agents/` | `127.0.0.1:9099` | mira-pipeline |
| `/v1/` | `127.0.0.1:9099` | mira-pipeline (OpenAI-compat) |
| `/api/briefing/`, `/api/identity/` | `9099` | mira-pipeline |
| `/preview/` | static `/opt/mira/preview/` | static |
| `/api/ingest/` (rewrite strip) | `127.0.0.1:8002` | mira-ingest |
| `/api/mcp/` (rewrite strip) | `127.0.0.1:8001` | mira-mcp |
| `/qr-test`, `/m/`, `/admin/` | `127.0.0.1:3200` | mira-web |
| `= /sample`, `= /activated`, `= /pricing` | `3200` | mira-web (PLG) |
| `/api/magic`, `/api/register`, `/api/checkout`, `/api/stripe/`, `/api/billing-portal`, `/api/activation/` | `3200` | mira-web |
| `/` (catch-all) | `127.0.0.1:3101` | **mira-hub** |

Headers: HSTS preload, CSP (Google + HubSpot allowed), `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: SAMEORIGIN`.

⚠️ `/admin/` (line 132) routes to **mira-web** — but the hub's own admin pages live at `/admin/users` and `/admin/roles` inside the hub! See CRA-62, P2 — the nginx block intercepts the path and mira-web has no `/admin` index. Either remove the nginx block or add an `/admin` page to mira-web. **For Mike: this means clicking the Admin sidebar item links to `/admin/users`, which the hub renders, but bare `/admin/` is broken.**

### 7.5 Database

Migrations in `mira-hub/db/migrations/` — must be applied manually before app start. No migration runner is built into the container.

| Migration | Tables / Columns Added |
|---|---|
| `001_knowledge_graph.sql` | `kg_entities`, `kg_relationships`, `kg_triples_log`, `kg_warnings`, `kg_insights` |
| `002_agent_events.sql` | `agent_events`, `agent_event_attachments` |
| `003_kb_hardening.sql` | `kb_file_metadata`, `kb_parsing_errors`, `kb_embedding_status` |
| `004_asset_enrichment.sql` | `asset_enrichment_jobs`, `asset_property_sets` |
| `005_wo_pm_enhancements.sql` | `wo_diagnostic_context`, `pm_schedule_rules`, `pm_asset_mappings` |

Tables expected by app code but **not** in any local migration (assumed created by sibling services / earlier setup):
- `hub_users` — defined inline by `lib/users.ts` `ensureSchema()`
- `hub_channel_bindings` — token storage; AES-256-GCM via `OAUTH_TOKEN_ENC_KEY`
- `work_orders`, `cmms_equipment` — populated by mira-bots / mira-pipeline
- `kb_chunks` — populated by mira-ingest
- `magic_link_tokens` — created by `/api/auth/magic-link`

Run order verifier: `mira-hub/db/check-migration-order.mjs`.
Bootstrap scripts: `scripts/seed-synthetic-users.ts` (idempotent test data) and `scripts/kg-cmms-sync.ts` (Atlas → KG sync).

---

## 8. Quality Standards

For Mike's day-to-day use, "100% working" means:

1. **No 4xx/5xx on first-class navigation.** Every sidebar link returns 200 with substantive content. No 404s, no 500s, no 503s on pages Mike clicks.
2. **No stub fixtures rendered as if they were real data.** If a page can't fetch data, it shows a loading skeleton or empty state — not hardcoded "12 open work orders" pulled out of thin air.
3. **No console errors** on any page (currently CRA-39 spams console site-wide).
4. **No RSC prefetch 404s** (CRA-40 was caused by `/admin/users` not existing — closed).
5. **Auth flow round-trips end-to-end** for credentials, magic-link, and Google OAuth. Phase-2 NEXTAUTH_URL must produce a working callback.
6. **OAuth integrations actually persist tokens** in `hub_channel_bindings` (encrypted) and survive a logout/login cycle.
7. **CMMS bridge shows live numbers** when Atlas is reachable, gracefully degrades to cached/empty state when not.
8. **Every form has a submit endpoint** — currently `/workorders/new` and `/requests/new` post nowhere.
9. **Trial banner accurate** — counts down to real `trialExpiresAt`, redirects to `/upgrade` past zero.
10. **Mobile parity** — bottom-tabs + drawer match desktop sidebar; safe-area insets respected on iPhone notch.

---

## 9. Acceptance Criteria — per feature

The hub is "100% working" when **every row** below is GREEN.

| Feature | Acceptance test | Current |
|---|---|---|
| `/login` (credentials) | POST `/api/auth/callback/credentials` with valid email+password redirects to `/feed/`, NextAuth cookie set | GREEN |
| `/login` (Google) | "Continue with Google" → Google consent → callback → `/feed/` | needs verify per Phase 2 NEXTAUTH_URL |
| `/login` (magic link) | Submit email at `/login`, receive Resend email, click link → land on `/magic?token=...` → click submit → `/feed/` | needs verify (CRA-12 says "doesn't work in practice") |
| `/signup` | New email + password creates user, sends to `/pending-approval` until admin approves via `/admin/users` | GREEN |
| `/feed` | KPIs show **live** values from `/api/usage` (or wherever) — NOT hardcoded "12/3/2.4h/67%" | RED — STUB |
| `/conversations` | Lists real conversations from a real source (mira-bots conversation table?). Currently no `/api/conversations` consumer exists. | RED — STUB |
| `/actions` | Lists real MIRA actions. Hooks into `agent_events` table. | RED — STUB |
| `/alerts` | Acknowledge button writes to DB; safety-tagged WOs appear here | GREEN |
| `/knowledge` | List loads from `/api/knowledge`; Upload Picker opens Drive/Dropbox; uploads end in `kb_chunks`; can delete | YELLOW — `/api/uploads/` 500 in prod (CRA-38) |
| `/assets` | List loads from `/api/assets`; create form posts a new equipment row | needs verify create endpoint |
| `/assets/[id]` | All 3 panels live: profile, chat (`/api/assets/[id]/chat`), enrich (`/api/assets/[id]/enrich`); no `/* Mock data */` | YELLOW — partial mock |
| `/cmms` | Atlas stats card shows real numbers when ATLAS_* env set | RED — 503 (CRA-37) |
| `/channels` | Telegram + Slack + MS bindings load from `hub_channel_bindings`; add/remove works | GREEN |
| `/integrations` | Same for Drive, Confluence, Dropbox, MaintainX (Nango); Nango credential connect flow works | GREEN |
| `/workorders` | List loads from NeonDB; filters by status/priority work | GREEN |
| `/workorders/[id]` | Status change PATCH persists; comments add; completion validation runs | GREEN |
| `/workorders/new` | Submit creates a real WO row | RED — STUB (no submit endpoint) |
| `/schedule` | rrule-based calendar renders from `/api/pm-schedules`; meter readings POST works | GREEN |
| `/requests` | Real requests load; create flow posts | YELLOW — list works, new doesn't |
| `/requests/new` | Submit creates a real request row | RED |
| `/parts` | List from a real `parts` table; low-stock filter accurate | RED — STUB (uses `lib/parts-data.ts`) |
| `/parts/[id]` | Detail loads real part with linked assets | RED — STUB |
| `/documents` | Real document library, not `lib/documents-data.ts` | RED — STUB |
| `/documents/[id]` | Real version history + preview | RED — STUB |
| `/reports` | KPI cards show **live** MTTR/MTBF/OEE/PM compliance; AI summary generator works (already does) | YELLOW — KPIs hardcoded, AI works |
| `/usage` | Charts populate from `/api/usage` real data | GREEN |
| `/event-log` | Activity timeline from `/api/events` | GREEN |
| `/team` | User list real | GREEN |
| `/admin/users` | List + approve/role/expire works | GREEN |
| `/admin/roles` | Editable role-permission matrix that persists | RED — STUB (read-only hardcoded) |
| `/upgrade` | Stripe Checkout button actually opens Checkout (currently placeholder, mira-web owns Stripe) | RED — STUB |
| Trial banner | Shows real days-remaining; ≤4 = urgent; redirects past 0 | needs verify |
| Sidebar collapse | Toggle persists across reload | needs verify |
| Mobile bottom-tabs | Active tab highlighted; safe-area inset on iPhone notch | needs verify on device |
| Onboarding tour | Triggers on first login; ESC dismisses; persisted in localStorage | GREEN |

---

## 10. Known Issues — open Linear tickets affecting the hub

Cross-reference: `https://linear.app/cranesync/team/Cranesync/all`. As of 2026-05-06.

### Open

| Ticket | Priority | Title | Why it matters |
|---|---|---|---|
| **CRA-37** | P0 | `/cmms` 503 on `/api/cmms/stats/` | CMMS bridge dead in prod. Atlas-api at 8088 may be down or proxy mis-wired. |
| **CRA-38** | P0 | `/knowledge` 500 on `/api/uploads/` | Knowledge page can't list uploads — feature visibly broken. |
| **CRA-39** | P1 | `NEXT_PUBLIC_PIPELINE_API_URL` unset in production | Console error on every page; Refine data provider falls through. |
| **CRA-42** | P1 | `/admin/roles` 404 | Sidebar links here, page doesn't exist (page does exist at `(hub)/admin/roles/page.tsx` — verify nginx routing isn't intercepting `/admin/`). |
| **CRA-25** | P0 | nginx routes `/sample` and `/activated` to Open WebUI | mira-web bypassed; PLG funnel broken. |
| **CRA-62** | P2 | `app.factorylm.com/admin/` 404 — routes to mira-web with no /admin index | nginx Phase 2 conf line 132 still proxies `/admin/` to mira-web. |
| **CRA-63** | P2 | `/pricing` Stripe Checkout asset ERR_CONNECTION_RESET | Conversion blocker (mira-web side, but visible at app domain). |
| **CRA-45** | P2 | Missing `<link rel="canonical">` on every hub page | SEO. Site-wide. |
| **CRA-46** | P2 | Incomplete Open Graph tags on every hub page | Link previews broken. Site-wide. |
| **CRA-48** | P2 | Heading hierarchy skips on 19 hub routes | a11y. h1 → h3 with no h2. |
| **CRA-50** | P2 | `/login` Lighthouse perf 73 (target ≥80) | First-impression perf. |
| **CRA-51** | P3 | Missing `twitter:card` meta | Same fix as CRA-46. |
| **CRA-57** | P2 | hub healthcheck accepts both basePath layouts | In review (PR #930). |
| **CRA-61** | P1 | factorylm.com apex CSP missing | Deploy drift; affects sibling domain. |
| **CRA-12** | P1 | Magic-inbox doesn't work in practice | Investigation needed. |

### Closed (referenced for history)

- **CRA-19** — WO detail fetches real WO. Closed 2026-05-04.
- **CRA-26** — 308 instead of 404 on unknown paths. Closed 2026-05-06.
- **CRA-40** — `/admin/users` RSC prefetch 404. Closed 2026-05-06.
- **CRA-43** — `/admin/users` page 404. Closed 2026-05-06.
- **CRA-60** — `/blog/fault-codes` widget calls `/api/mira/session` 404. Closed 2026-05-06.
- **CRA-6** — `NEXTAUTH_SECRET` hardcoded in `docker-compose.hub.yml`. Closed 2026-05-06 — compose now uses `${AUTH_SECRET}`.

---

## 11. Fix Plan — Prioritized Punch List

This is the to-do list. Work top-down. Update this list when items are done.

### P0 — Broken and user-facing (Mike can't use the platform)

1. **Fix `/api/cmms/stats/` 503** (CRA-37)
   - Verify atlas-api container is up (`docker compose ps atlas-api`)
   - Verify nginx upstream from `cmms.factorylm.com/api/` to `127.0.0.1:8088`
   - Verify `ATLAS_API_USER` / `ATLAS_API_PASSWORD` in Doppler match real Atlas creds
   - Add timeout-graceful fallback in `mira-hub/src/app/api/cmms/stats/route.ts` (currently throws on ≠ 200)
   - **Acceptance:** `curl -H "Cookie: ..." https://app.factorylm.com/api/cmms/stats/` returns 200 with `{ workOrders, assets, pms }` shape
2. **Fix `/api/uploads/` 500** (CRA-38)
   - Read `mira-hub/src/app/api/uploads/route.ts` GET handler
   - Likely cause: missing/wrong DB column, or `lib/uploads.ts:listUploads` throws when `tenant_id` empty
   - **Acceptance:** `/knowledge` page loads with empty list (or real list) — no 500
3. **Wire NEXT_PUBLIC_PIPELINE_API_URL at build** (CRA-39)
   - Set `NEXT_PUBLIC_PIPELINE_API_URL=https://app.factorylm.com` in `docker-compose.saas.yml` mira-hub `args:` block (build-time, not env)
   - Rebuild + redeploy
   - **Acceptance:** No console error on any authenticated page
4. **Replace `/feed` hardcoded KPIs with live data**
   - Add a `/api/dashboard/kpis` endpoint that returns `{ openWOs, overduePMs, downtimeToday, wrenchTime }` from real queries
   - Replace `KPI_CARDS` array in `(hub)/feed/page.tsx`
   - **Acceptance:** KPI numbers match what's actually in NeonDB; refresh changes them when data changes
5. **Decide `/admin/` routing** (CRA-62)
   - Either: remove nginx `location /admin/` block in `nginx-phase2-live.conf:132-138` so requests pass to mira-hub
   - Or: add an `/admin` index in mira-web that redirects to `/admin/users`
   - **Acceptance:** Visiting bare `/admin` lands on a real page

### P1 — Stubbed but should work

6. **Wire `/workorders/new` submit endpoint**
   - Add POST handler in `mira-hub/src/app/api/work-orders/route.ts` that creates a row, returns the new id
   - Replace mock asset search at `(hub)/workorders/new/page.tsx:10` with `fetch('/api/assets')`-driven autocomplete
   - **Acceptance:** Submitting the form creates a WO that appears in `/workorders` list
7. **Wire `/requests/new` submit endpoint**
   - Decide schema (new `requests` table or piggyback on `work_orders` with `type=request`?)
   - Add POST handler
   - **Acceptance:** Submission creates a request visible at `/requests`
8. **Replace `/parts` hardcoded data**
   - Create a `parts` table (or CMMS bridge to Atlas parts)
   - Add `/api/parts` GET endpoint
   - Replace `lib/parts-data.ts` import in `(hub)/parts/page.tsx`
   - **Acceptance:** Parts list reflects real data, low-stock filter works
9. **Replace `/documents` hardcoded data**
   - Either: source from `kb_chunks` aggregation (similar to `/api/knowledge`)
   - Or: create a `documents` table for a curated library distinct from KB chunks
   - **Acceptance:** `/documents` shows real OEM manuals
10. **Replace `/conversations` hardcoded data**
    - Source from mira-bots `conversations` SQLite or NeonDB equivalent
    - Add `/api/conversations` GET endpoint
    - **Acceptance:** Real Telegram + Slack threads visible
11. **Replace `/actions` hardcoded data**
    - Source from `agent_events` table (already exists)
    - Add `/api/actions` GET endpoint or repurpose `/api/events` with a filter
    - **Acceptance:** Recent MIRA-taken actions visible
12. **Replace `/reports` KPI cards with live data**
    - Compute MTTR, MTBF, PM compliance, downtime from `work_orders`
    - Reuse cascade for AI summary (already wired)
    - **Acceptance:** Cards update when work-order data changes
13. **Make `/admin/roles` editable**
    - Schema: a `role_permissions` table or store in `hub_users` JSONB
    - Add CRUD endpoints
    - **Acceptance:** Admin can grant/revoke a permission and the change persists
14. ~~**Move `NEXTAUTH_SECRET` from compose to Doppler** (CRA-6)~~ — **DONE 2026-05-06**
    - `docker-compose.hub.yml` now passes `AUTH_SECRET=${AUTH_SECRET}` (matches saas.yml).
    - Hub code already prefers `AUTH_SECRET` over `NEXTAUTH_SECRET` in `auth.ts:141`,
      `middleware.ts:44`, `lib/session.ts:47`. Doppler `NEXTAUTH_SECRET` duplicate
      can now be retired (manual Doppler step, not part of this fix).
15. **Verify `/login` magic-link flow end-to-end** (CRA-12)
    - Trigger from production
    - Inspect Resend logs
    - Check token validation in `/api/auth/magic-link` POST + the `magic-token` provider
    - **Acceptance:** Email arrives, link works, lands on `/feed/`
16. **Phase-2 NEXTAUTH_URL audit**
    - Confirm Doppler `NEXTAUTH_URL=https://app.factorylm.com/api/auth` (no `/hub/`)
    - Confirm Google authorized redirect URIs include the matching callback path
    - **Acceptance:** Google sign-in completes without `redirect_uri_mismatch`
17. ~~**Wire `/upgrade` to mira-web Stripe Checkout**~~ — **DONE 2026-05-06**
    - `mira-hub/src/app/(hub)/upgrade/page.tsx` now redirects to
      `/pricing?from=hub-upgrade&plan=<id>`. nginx phase-2 routes `/pricing` and
      `/api/checkout/*` to mira-web :3200, so the hub no longer needs its own
      Stripe wiring.
    - **Follow-up:** Hub plan list ($20 / $499) doesn't match mira-web's live
      Stripe tiers ($97 / $297). Either reconcile the hub PLANS array to the
      real prices, or have mira-web's `/pricing` accept a `plan=` hint to
      pre-select. Filed as a separate item.

### P2 — Polish (visible quality, not blocking)

18. **Add canonical + Open Graph + twitter:card** on every page (CRA-45, CRA-46, CRA-51)
    - Add to `src/app/layout.tsx` `metadata` export
    - **Acceptance:** Pasting a hub URL into Slack shows a card
19. **Fix heading hierarchy** (CRA-48) — sweep h1→h3 to insert h2
20. **Improve `/login` Lighthouse perf** (CRA-50) — defer Google SDK, preload critical CSS
21. **Delete unused `public/` SVGs** — `next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`
22. **Remove unreferenced onboarding asset** — `public/onboarding/panel-1.png` if confirmed unused
23. **Trim `mira-hub/AGENTS.md`** — currently `@AGENTS.md` self-reference; clean up
24. **Ensure `.env.template` reflects all 47 env vars** — currently only 1 documented; add the rest with placeholders so local-dev setups don't fail silently
25. **Sweep i18n completeness** — `es`, `hi`, `zh` likely partial; either complete or hide language selector until done
26. **Sidebar feed link** — add `/feed` (Home) as the first sidebar item or change the logo to be more obviously a home link

---

## 12. How to Use This Spec

1. **Pick a punch-list item.** Start with P0. One person, one item.
2. **Branch off main.** `git checkout -b fix/cra-XX-<short>`
3. **Update this spec** when you change a feature's status (RED → YELLOW → GREEN). Commit the spec change in the same PR as the fix.
4. **Acceptance criteria are non-negotiable** — if you can't satisfy the listed test, the item isn't done.
5. **No drive-by changes.** If you spot something else broken, add it to the punch list with priority and Linear ticket. Don't fix it inside an unrelated PR.
6. **Linear sync.** Every item in the punch list should have a Linear ticket; create one if missing using the `agent-action` or `user-action` label conventions.

---

## 13. Out of Scope (deferred, not in this spec)

- **mira-web** PLG funnel — separate platform, separate spec (lives at `factorylm.com` and the `/sample`, `/pricing`, `/activated` routes on `app.factorylm.com`).
- **Atlas CMMS** — at `cmms.factorylm.com`, separate codebase under `mira-cmms/`.
- **mira-bots** — Telegram + Slack + MS Teams adapters; the hub displays their output but the bots themselves are different services.
- **mira-pipeline** — Supervisor/cascade engine; the hub is one consumer.
- **mira-ingest** — Document ingestion service; the hub is one client.
- **mira-mcp** — FastMCP server; the hub doesn't currently call it directly (mira-pipeline does).
- **mira-relay** — Ignition factory→cloud streaming; SaaS-only.

---

**End of spec.** Anything else you find broken on `app.factorylm.com` that isn't listed here — add it to §11 with a priority and a Linear ticket. This file is the source of truth.
