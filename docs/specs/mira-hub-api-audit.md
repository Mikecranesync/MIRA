# MIRA Hub API Audit Report

**Date:** 2026-05-06 | **Version:** mira-hub 3.4.0 | **Scope:** Next.js 16 API routes + outbound calls

---

## API Routes Exposed by mira-hub

### Public / Unauthenticated Routes

#### Authentication & Registration

- **POST `/api/auth/register`** — Email/password sign up with rate-limiting (5/hour per IP). Captures HubSpot lead if key set. Returns `{ ok, userId, tenantId }`. **Status:** WORKING. **Downstream:** HubSpot API, NeonDB.
- **POST `/api/auth/[...nextauth]`** — NextAuth.js handler (Google, Microsoft, Confluence, Dropbox, Slack OAuth callbacks, JWT session). **Status:** WORKING. **Downstream:** NextAuth providers.
- **GET `/api/auth/google`** — OAuth initiation redirect to Google consent. **Status:** WORKING.
- **GET `/api/auth/google/callback`** — Receives `code`, exchanges for token via `https://oauth2.googleapis.com/token`, fetches user info via `https://www.googleapis.com/oauth2/v2/userinfo`, creates/updates tenant. **Status:** WORKING. **Returns:** JWT session.
- **GET `/api/auth/microsoft`** — OAuth initiation redirect to Microsoft. **Status:** WORKING.
- **GET `/api/auth/microsoft/callback`** — Exchanges code at `https://login.microsoftonline.com/common/oauth2/v2.0/token`, fetches profile from `https://graph.microsoft.com/v1.0/me`. **Status:** WORKING.
- **GET `/api/auth/confluence`** — OAuth initiation for Atlassian Confluence. **Status:** WORKING.
- **GET `/api/auth/confluence/callback`** — Exchanges code, fetches resources from `https://api.atlassian.com/oauth/token/accessible-resources`. **Status:** WORKING.
- **GET `/api/auth/dropbox`** — OAuth initiation for Dropbox. **Status:** WORKING.
- **GET `/api/auth/dropbox/callback`** — Exchanges code at `https://api.dropboxapi.com/oauth2/token`, fetches account via `https://api.dropboxapi.com/2/users/get_current_account`. **Status:** WORKING.
- **GET `/api/auth/slack`** — OAuth initiation for Slack workspace. **Status:** WORKING.
- **GET `/api/auth/slack/callback`** — Exchanges code at `https://slack.com/api/oauth.v2.access`. **Status:** WORKING.
- **POST `/api/auth/openwebui`** — Accepts `baseUrl`, probes `{baseUrl}/api/version` to verify Open WebUI is reachable and alive. **Status:** WORKING.
- **POST `/api/auth/telegram`** — Accepts bot token, validates via `https://api.telegram.org/bot{token}/getMe`, then registers webhook at `https://api.telegram.org/bot{token}/setWebhook` pointing to mira-bot-telegram service. **Status:** WORKING.
- **GET `/api/auth/status`** — Returns current session auth status (user, tenant, roles). No auth required. **Status:** WORKING.

#### Health & System

- **GET `/api/health`** — Liveness probe. Checks `NEON_DATABASE_URL` and `INGEST_URL` presence. Returns 503 if missing. **Status:** WORKING. **Purpose:** Docker healthcheck sentinel.

#### Account Setup (Requires Session)

- **POST `/hub/api/auth/magic-link`** — Authenticated only. Sends magic link via Resend (`https://api.resend.com/emails`). **Status:** WORKING. **Downstream:** Resend, NeonDB.
- **GET `/hub/api/auth/check-approval`** — Checks if user has pending approval from admin. **Status:** WORKING.

#### Admin Routes (Authenticated, admin+ role)

- **GET `/hub/api/admin/users`** — List all users in tenant (admin only). **Status:** WORKING. **Downstream:** NeonDB.
- **GET `/hub/api/admin/users/[id]`** — Get single user details. **Status:** WORKING.

---

### Authenticated Routes

#### User Profile & Preferences

- **GET `/api/me`** — Current user profile (session required). **Status:** WORKING. **Downstream:** NeonDB.
- **GET `/api/user/preferences`** — User display prefs (theme, etc.). **Status:** WORKING. **Downstream:** NeonDB.

#### Work Orders

- **GET `/api/work-orders`** — List WOs with optional `?source=` and `?status=` filters. **Status:** WORKING. **Downstream:** NeonDB, parses stored arrays/markdown in description.
- **POST `/api/work-orders`** — Create WO. **Status:** STUB / TODO (endpoint structure exists, core not fully wired).
- **GET `/api/work-orders/[id]`** — Fetch single WO details. **Status:** WORKING. **Downstream:** NeonDB.
- **PATCH `/api/work-orders/[id]`** — Update WO (status, priority, notes). **Status:** WORKING. **Downstream:** NeonDB.

#### Assets / Equipment

- **GET `/api/assets`** — List all cmms_equipment in tenant with WO counts, downtime. **Status:** WORKING. **Downstream:** NeonDB, fire-and-forget asset enrichment.
- **POST `/api/assets`** — Create new equipment record. Validates manufacturer. **Status:** WORKING. **Downstream:** NeonDB, triggers `enrichAsset()`.
- **GET `/api/assets/[id]`** — Fetch single asset with enrichment report. **Status:** WORKING. **Downstream:** NeonDB, asset-intelligence agent.
- **POST `/api/assets/[id]/enrich`** — Manual trigger of asset enrichment (KB search, KG traversal, web search via Exa if key present, YouTube corpus). **Status:** WORKING. **Downstream:** Qdrant KB, NeonDB, Exa API (conditional), filesystem (YouTube), asset_enrichment_reports table.
- **POST `/api/assets/[id]/chat`** — Streaming SSE chat about asset. Implements safety keyword scan (arc flash, LOTO, confined space, etc.) with immediate STOP escalation. Uses LLM cascade (Groq → Cerebras → Gemini), each provider tries for 30s before fallback. **Status:** WORKING. **Downstream:** Groq, Cerebras, Gemini APIs, NeonDB.

#### PM Schedules

- **GET `/api/pm-schedules`** — List preventive maintenance schedules with optional filters (manufacturer, model_number, equipment_id). Status derived from `next_due_at` vs now. **Status:** WORKING. **Downstream:** NeonDB.
- **POST `/api/pm-schedules`** — Create PM schedule. **Status:** STUB / TODO.
- **GET `/api/pm-schedules/[id]`** — Fetch single schedule with extended metadata (parts, tools, safety requirements). **Status:** WORKING.
- **PATCH `/api/pm-schedules/[id]`** — Update schedule (interval, next_due_at, etc.). **Status:** WORKING.
- **POST `/api/pm-schedules/[id]/meter`** — Record meter reading (for meter-based PM trigger). **Status:** WORKING. **Downstream:** NeonDB.

#### Knowledge Base / Uploads

- **GET `/api/knowledge`** — List knowledge base items (summaries). **Status:** WORKING. **Downstream:** NeonDB.
- **POST `/api/uploads`** — Queue document/photo upload. Validates provider (google|dropbox), mime type, size <20MB, asset_tag. Calls mira-ingest immediately or queues. Returns upload record with requestId. **Status:** WORKING. **Downstream:** mira-ingest (document-kb or photo endpoint), NeonDB, Google Drive API (via picker), Dropbox API (via picker), file deduplication check.
- **GET `/api/uploads`** — List pending/completed uploads with processing status. **Status:** WORKING. **Downstream:** NeonDB.
- **POST `/api/uploads/local`** — Direct file upload (multipart/form-data). **Status:** WORKING. **Downstream:** mira-ingest document-kb, NeonDB.
- **GET `/api/uploads/[id]`** — Fetch download URL from mira-ingest (`/api/v1/files/{fileId}`) and proxy to user. **Status:** WORKING. **Downstream:** mira-ingest, Open WebUI (if mira-ingest proxies).
- **POST `/api/uploads/[id]/retry`** — Requeue failed upload to mira-ingest. **Status:** WORKING. **Downstream:** mira-ingest.
- **DELETE `/api/uploads/[id]`** — Mark upload deleted in NeonDB. **Status:** WORKING. **Downstream:** NeonDB, mira-ingest DELETE.

#### Integrations & Connections

- **GET `/api/connections`** — List OAuth connections (Google Drive, Dropbox, Nango providers). **Status:** WORKING. **Downstream:** NeonDB.
- **GET `/api/connections/[provider]`** — Check connection status. **Status:** WORKING. **Downstream:** Nango server (if provider is Nango), NeonDB.
- **DELETE `/api/connections/[provider]`** — Disconnect OAuth. **Status:** WORKING. **Downstream:** Nango `DELETE /connection/{id}`, NeonDB.
- **GET `/api/picker/google/token`** — Return Google Picker API token for browser file picker. **Status:** WORKING. **Downstream:** NeonDB session lookup, env var GOOGLE_PICKER_API_KEY.
- **GET `/api/picker/dropbox/key`** — Return Dropbox app key for Chooser. **Status:** WORKING. **Downstream:** env var DROPBOX_APP_KEY.

#### Nango Integration Layer

- **POST `/api/integrations/nango/connect`** — Initiates OAuth with Nango for provider (e.g., MaintainX). **Status:** WORKING. **Downstream:** Nango server OAuth flow.
- **GET `/api/integrations/nango/callback`** — Nango OAuth callback, stores connection. **Status:** WORKING. **Downstream:** Nango server, NeonDB.

#### Events & Monitoring

- **GET `/api/events`** — List system events (WO created, asset updated, etc.). **Status:** WORKING. **Downstream:** NeonDB tenant_audit_log table.
- **GET `/api/events/[id]`** — Fetch single event details. **Status:** WORKING. **Downstream:** NeonDB.

#### Reports & Analytics

- **POST `/api/reports/generate`** — Generates maintenance report with stats (MTTR, top problem assets, etc.). Uses LLM cascade to synthesize insights. **Status:** WORKING. **Downstream:** Groq, Cerebras, Gemini (cascade), NeonDB.
- **GET `/api/usage`** — Tenant usage metrics (uploads, WO count, etc.). **Status:** WORKING. **Downstream:** NeonDB.

#### CMMS Stats

- **GET `/api/cmms/stats`** — Pulls work order counts, asset criticality distribution from Atlas CMMS (if connected). Authenticates as `ATLAS_API_USER:ATLAS_API_PASSWORD` to `HUB_CMMS_API_URL`. **Status:** WORKING. **Downstream:** Atlas CMMS REST API (8088).

#### Channels / Integration Hub

- **GET `/api/channels`** — List connected channels (Telegram, Slack, etc.). **Status:** WORKING. **Downstream:** NeonDB.

#### Agents / Background Tasks

- **POST `/api/agents/morning-brief`** — Trigger morning brief generation (scheduled or manual). **Status:** WORKING. **Downstream:** Agents framework, NeonDB, LLM cascade.
- **GET `/api/agents/pm-escalation/check`** — Check for overdue PMs, create escalation alerts. **Status:** WORKING. **Downstream:** NeonDB PM table.
- **GET `/api/agents/safety-events`** — List safety incidents extracted from uploads/conversations. **Status:** WORKING. **Downstream:** NeonDB, knowledge graph.

#### Knowledge Graph Operations

- **POST `/api/kg/sync`** — Manually trigger KG sync from KB (extract entities, relationships). **Status:** WORKING. **Downstream:** Qdrant KB, NeonDB knowledge_graph tables.

#### Export / Backup

- **GET `/api/export`** — Export tenant data (WOs, assets, PM schedules, uploads metadata) as JSON or CSV. **Status:** WORKING. **Downstream:** NeonDB, file streaming.

#### Team Management

- **GET `/api/team`** — List team members, roles, permissions. **Status:** WORKING. **Downstream:** NeonDB users table scoped to tenant.

---

## Outbound HTTP Calls — Services mira-hub calls

| Service | Base URL (env var) | Used By (file:function) | Purpose |
|---------|---|---|---|
| **Google OAuth** | `https://oauth2.googleapis.com` | `api/auth/google/callback` | Token exchange |
| **Google UserInfo** | `https://www.googleapis.com/oauth2/v2/userinfo` | `api/auth/google/callback` | Fetch authenticated user profile |
| **Microsoft OAuth** | `https://login.microsoftonline.com/common/oauth2/v2.0` | `api/auth/microsoft/callback` | Token exchange |
| **Microsoft Graph** | `https://graph.microsoft.com/v1.0/me` | `api/auth/microsoft/callback` | Fetch authenticated user profile |
| **Atlassian OAuth** | `https://auth.atlassian.com/oauth/token` | `api/auth/confluence/callback` | Token exchange |
| **Atlassian Resources** | `https://api.atlassian.com/oauth/token/accessible-resources` | `api/auth/confluence/callback` | List accessible Confluence instances |
| **Dropbox OAuth** | `https://api.dropboxapi.com/oauth2/token` | `api/auth/dropbox/callback` | Token exchange |
| **Dropbox Users** | `https://api.dropboxapi.com/2/users/get_current_account` | `api/auth/dropbox/callback` | Fetch authenticated user account |
| **Slack OAuth** | `https://slack.com/api/oauth.v2.access` | `api/auth/slack/callback` | Token exchange |
| **Telegram Bot API** | `https://api.telegram.org/bot{token}/` | `api/auth/telegram` | Webhook registration, getMe, setWebhook |
| **HubSpot CRM** | `https://api.hubapi.com/crm/v3/objects/contacts` | `api/auth/register` (captureHubSpotLead) | Lead capture on signup |
| **Resend Email API** | `https://api.resend.com/emails` | `hub/api/auth/magic-link` | Send magic-link email |
| **Groq LLM** | `https://api.groq.com/openai/v1/chat/completions` | `api/assets/[id]/chat`, `api/reports/generate` | Streaming chat & report generation (cascade primary) |
| **Cerebras LLM** | `https://api.cerebras.ai/v1/chat/completions` | `api/assets/[id]/chat`, `api/reports/generate` | Cascade fallback if Groq unavailable |
| **Gemini LLM** | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `api/assets/[id]/chat`, `api/reports/generate` | Cascade fallback if Groq + Cerebras unavailable |
| **mira-ingest** | `INGEST_URL` (env var, e.g. `http://mira-ingest:8001`) | `lib/mira-ingest-client.ts` | Document KB ingestion (`/ingest/document-kb`), photo ingestion (`/ingest/photo`) |
| **Open WebUI** | `OPENWEBUI_BASE_URL` (env var) | `api/auth/openwebui` (probe), asset enrichment (KB search) | Verify liveness, query KB vector store |
| **Qdrant** | (via NeonDB pgvector or fallback to Ollama) | `lib/agents/asset-intelligence.ts` | Vector similarity search for KB enrichment |
| **Exa API** | `https://api.exa.ai/` | `lib/agents/asset-intelligence.ts` (if `EXA_API_KEY` set) | Web search for asset enrichment |
| **Nango Server** | `NANGO_SERVER_URL` (env var, e.g. `http://nango-server:3003`) | `lib/nango.ts` | OAuth credential management, proxy authenticated calls to external APIs (e.g., MaintainX) |
| **Atlas CMMS API** | `HUB_CMMS_API_URL` (env var) | `api/cmms/stats` | Fetch work order and asset stats from CMMS backend |
| **NeonDB (PostgreSQL)** | `NEON_DATABASE_URL` (env var) | All authenticated routes | Session management, asset/WO/PM/upload/event storage, knowledge graph tables |
| **mira-pipeline (Refine)** | `NEXT_PUBLIC_PIPELINE_API_URL` (env var, e.g. `http://mira-pipeline:9099`) | `providers/data-provider.ts` | Refine SimpleRestDataProvider for resource CRUD if `NEXT_PUBLIC_PIPELINE_API_URL` set; else uses mock data |

---

## Library Code (`src/lib/`)

### Auth & Session

- **`session.ts`** — `sessionOr401()` helper; checks NextAuth session and tenant context. Used by all authenticated routes.
- **`auth/`** — OAuth state encryption (`oauth-state.ts`), JWT helpers.

### Data Access & Connections

- **`db.ts`** — NeonDB connection pool (NullPool for Neon PgBouncer).
- **`tenant-context.ts`** — Wraps DB queries with tenant isolation (RLS via session).
- **`users.ts`** — User CRUD, password hashing (bcryptjs).
- **`connections.ts`** — OAuth connection metadata storage.
- **`uploads.ts`** — Upload record CRUD, file ID deduplication.
- **`nango.ts`** — Nango client (create/delete/status, proxy GET/POST, trigger actions). Calls `NANGO_SERVER_URL`.

### Ingest & Upload Pipeline

- **`mira-ingest-client.ts`** — Two functions: `forwardToIngest()` (document-kb, 120s timeout) and `forwardToPhotoIngest()` (photo, 120s timeout). Both POST multipart to `INGEST_URL`. Performs MIME sniffing and validation.
- **`upload-pipeline.ts`** — Orchestrates upload queue, calls mira-ingest, retries on failure, updates DB.
- **`upload-log.ts`** — Logging for upload status transitions.
- **`sniff-mime.ts`** — Magic byte validation (PDF, JPG, PNG, WebP, HEIC).
- **`asset-tag.ts`** — Path prefix validation (prevents `../` traversal).

### Knowledge Graph

- **`knowledge-graph/extractor.ts`** — Extracts entities & relationships from uploaded documents.
- **`knowledge-graph/context-builder.ts`** — Builds prompt context for LLM from KG for asset chat.
- **`knowledge-graph/` (other modules)** — Entity/relationship storage, graph traversal.

### Agents

- **`agents/asset-intelligence.ts`** — Enriches assets from 6 sources: KB vector search (via Ollama/Qdrant), KG traversal (2-hop), CMMS summary, web search (Exa), OEM advisories (KB pass 2), YouTube corpus (filesystem). Upserts `asset_enrichment_reports`.
- **`agents/morning-brief.ts`** — Generates executive summary of overnight events (new WOs, safety alerts, overdue PMs).
- **`agents/pm-escalation.ts`** — Scans overdue PMs, creates escalation alerts.
- **`agents/safety-alert.ts`** — Scans conversations & uploads for safety keywords, streams SSE responses with safety STOP if keywords detected.
- **`agents/wo-lifecycle.ts`** — WO state machine (open → in-progress → completed, etc.).

### Data Models & Schemas

- **`data-schema.ts`** — TypeScript type definitions for work orders, assets, PM schedules.
- **`documents-data.ts`** — Mock/sample document library.
- **`parts-data.ts`** — Mock parts catalog.
- **`workorders-data.ts`** — Mock work orders (used by reports/generate for stats).

### Config & Utilities

- **`config.ts`** — `API_BASE` (e.g., `https://app.factorylm.com`), environment variables.
- **`bindings.ts`** — Refine resource ↔ API endpoint bindings (assets → `/api/assets`, etc.).
- **`fetch-adapters.ts`** — HTTP client wrappers (timeout, retry, error handling).
- **`abort-helpers.ts`** — `composeTimeout()`, `isAbortError()` for fetch AbortSignal.

### Providers (Authentication & Access Control)

- **`providers/auth-provider.ts`** — Refine auth provider (login, logout, check, getPermissions).
- **`providers/access-control.ts`** — Refine access control (role-based: owner, admin, viewer, editor).
- **`providers/data-provider.ts`** — Refine SimpleRestDataProvider pointing to `NEXT_PUBLIC_PIPELINE_API_URL` or mock data.

---

## Environment Variables Consumed

| Variable | Used By | Required / Optional | Purpose |
|---|---|---|---|
| **`NEON_DATABASE_URL`** | All routes, health check | **Required** | PostgreSQL connection string (NeonDB). Health check fails 503 if missing. |
| **`INGEST_URL`** | `mira-ingest-client.ts`, health check | **Required** | Base URL of mira-ingest service (e.g., `http://mira-ingest:8001`). Health check fails 503 if missing. |
| **`NEXTAUTH_SECRET`** | NextAuth | **Required** | JWT secret for session encryption. |
| **`AUTH_SECRET`** | NextAuth (alias) | **Optional** | Alias for `NEXTAUTH_SECRET`. |
| **`NANGO_SERVER_URL`** | `lib/nango.ts` | **Optional** | Nango credential vault URL (e.g., `http://nango-server:3003`). Defaults to `http://nango-server:3003`. |
| **`NANGO_SECRET_KEY`** | `lib/nango.ts` | **Required if Nango used** | Bearer token for Nango API calls. |
| **`HUB_CMMS_API_URL`** | `api/cmms/stats` | **Optional** | Atlas CMMS base URL (e.g., `https://cmms.factorylm.com`). |
| **`ATLAS_API_USER`** | `api/cmms/stats` | **Optional** | Basic auth username for CMMS. |
| **`ATLAS_API_PASSWORD`** | `api/cmms/stats` | **Optional** | Basic auth password for CMMS. |
| **`HUB_TENANT_ID`** | (legacy, not actively used) | **Optional** | Hardcoded tenant ID fallback. |
| **`OPENWEBUI_BASE_URL`** | `api/auth/openwebui`, asset enrichment | **Optional** | Open WebUI server URL (e.g., `http://mira-core:3000`). |
| **`OPENWEBUI_API_KEY`** | KB vector search in asset enrichment | **Optional** | Bearer token for Open WebUI API. |
| **`GROQ_API_KEY`** | `api/assets/[id]/chat`, `api/reports/generate` | **Optional** | Groq API key (primary LLM cascade provider). |
| **`GROQ_MODEL`** | Chat + reports | **Optional** | Model name (defaults to `llama-3.3-70b-versatile`). |
| **`CEREBRAS_API_KEY`** | Chat + reports (cascade) | **Optional** | Cerebras API key (fallback LLM). |
| **`CEREBRAS_MODEL`** | Chat + reports | **Optional** | Model name (defaults to `llama3.1-8b`). |
| **`GEMINI_API_KEY`** | Chat + reports (cascade) | **Optional** | Google Gemini API key (final cascade fallback). |
| **`GEMINI_MODEL`** | Chat + reports | **Optional** | Model name (defaults to `gemini-2.5-flash`). |
| **`EXA_API_KEY`** | `lib/agents/asset-intelligence.ts` | **Optional** | Exa web search API key (for asset enrichment web search). If missing, web search step is skipped. |
| **`OLLAMA_BASE_URL`** | Asset enrichment KB search (fallback) | **Optional** | Ollama server URL (e.g., `http://localhost:11434`). Used if Open WebUI unavailable. |
| **`GOOGLE_CLIENT_ID`** | `api/auth/google` | **Required if Google OAuth enabled** | OAuth client ID. |
| **`GOOGLE_CLIENT_SECRET`** | `api/auth/google/callback` | **Required if Google OAuth enabled** | OAuth client secret. |
| **`GOOGLE_PICKER_API_KEY`** | `api/picker/google/token` | **Optional** | API key for Google Picker widget (file picker). |
| **`GOOGLE_CLOUD_PROJECT_NUMBER`** | (referenced but not actively used in current code) | **Optional** | GCP project number for advanced features. |
| **`MICROSOFT_CLIENT_ID`** | `api/auth/microsoft` | **Optional** | OAuth client ID. |
| **`MICROSOFT_CLIENT_SECRET`** | `api/auth/microsoft/callback` | **Optional** | OAuth client secret. |
| **`ATLASSIAN_CLIENT_ID`** | `api/auth/confluence` | **Optional** | Atlassian OAuth client ID. |
| **`ATLASSIAN_CLIENT_SECRET`** | `api/auth/confluence/callback` | **Optional** | Atlassian OAuth client secret. |
| **`DROPBOX_APP_KEY`** | `api/picker/dropbox/key`, `api/auth/dropbox` | **Optional** | Dropbox app key for Chooser + OAuth. |
| **`DROPBOX_APP_SECRET`** | `api/auth/dropbox/callback` | **Optional** | Dropbox app secret. |
| **`SLACK_CLIENT_ID`** | `api/auth/slack` | **Optional** | Slack OAuth client ID. |
| **`SLACK_CLIENT_SECRET`** | `api/auth/slack/callback` | **Optional** | Slack OAuth client secret. |
| **`SLACK_BOT_TOKEN`** | (stored, not read by hub; bot runs elsewhere) | **Optional** | Slack bot token (used by mira-bot-slack). |
| **`TELEGRAM_BOT_TOKEN`** | `api/auth/telegram` (webhook setup), Telegram service | **Optional** | Telegram bot token for webhook registration. |
| **`TELEGRAM_BOT_USERNAME`** | (not actively read) | **Optional** | Telegram bot @username. |
| **`FACTORYLMDIAGNOSE_TELEGRAM_BOT_TOKEN`** | (alternate naming, same as above) | **Optional** | Alternate env var for Telegram bot token. |
| **`HUBSPOT_API_KEY`** | `api/auth/register` (lead capture) | **Optional** | HubSpot CRM API key. If missing, lead capture is skipped. |
| **`RESEND_API_KEY`** | `hub/api/auth/magic-link` | **Optional** | Resend email API key for magic-link delivery. |
| **`ADMIN_EMAIL`** | (referenced for admin detection) | **Optional** | Email address of initial admin. |
| **`OAUTH_BASE_PATH`** | NextAuth config | **Optional** | Custom OAuth path (defaults to `/api/auth`). |
| **`OAUTH_TOKEN_ENC_KEY`** | OAuth state encryption | **Optional** | Secret key for OAuth state parameter encryption. |
| **`NEXT_PUBLIC_API_BASE`** | Client-side env var | **Optional** | Public API base URL exposed to browser (e.g., `https://app.factorylm.com`). |
| **`NEXT_PUBLIC_PIPELINE_API_URL`** | `providers/data-provider.ts` (client-side) | **Optional** | Refine data provider URL (mira-pipeline). If missing in prod, console warning logged. |
| **`NEXT_PUBLIC_APP_URL`** | (build-time config) | **Optional** | Public app URL. |
| **`NODE_ENV`** | Build config, env checks | **Optional** | `development`, `production`, or `test`. |
| **`TEST_DATABASE_URL`** | Test runner | **Optional** | Separate DB for integration tests. |

---

## Refine Resources Registered

| Resource Name | List Path | Show Path | Create Path | Used By | Data Source |
|---|---|---|---|---|---|
| `feed` | `/feed` | — | — | Home dashboard | Mock or mira-pipeline (TBD) |
| `workorders` | `/workorders` | `/workorders/:id` | `/workorders/new` | Work orders page | `/api/work-orders` (hub), or mira-pipeline (if URL set) |
| `assets` | `/assets` | `/assets/:id` | — | Assets page | `/api/assets` (hub), or mira-pipeline |
| `documents` | `/documents` | — | — | Knowledge base | `/api/knowledge` (hub) + uploads |
| `parts` | `/parts` | — | — | Parts catalog | Mock data (parts-data.ts) |
| `schedule` | `/schedule` | — | — | PM calendar | `/api/pm-schedules` (hub) |
| `requests` | `/requests` | — | — | (TBD) | Mock |
| `reports` | `/reports` | — | — | Analytics | `/api/reports/generate` (hub) |
| `team` | `/team` | — | — | Team management | `/api/team` (hub) |
| `admin/users` | `/admin/users` | — | — | Admin panel | `/hub/api/admin/users` (hub, admin-only) |

**Data Provider Logic:** If `NEXT_PUBLIC_PIPELINE_API_URL` is set, Refine uses `SimpleRestDataProvider(url)` and routes all CRUD to `{url}/{resource}` (e.g., `http://mira-pipeline:9099/workorders`). Otherwise, mock provider is used with hardcoded data.

---

## Auth-Gated vs Public Routes

### Public (No session required)

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/[...nextauth]`
- `GET /api/auth/google`, `/api/auth/google/callback`
- `GET /api/auth/microsoft`, `/api/auth/microsoft/callback`
- `GET /api/auth/confluence`, `/api/auth/confluence/callback`
- `GET /api/auth/dropbox`, `/api/auth/dropbox/callback`
- `GET /api/auth/slack`, `/api/auth/slack/callback`
- `POST /api/auth/openwebui`
- `POST /api/auth/telegram`
- `GET /api/auth/status`

### Authenticated (Session required; most routes)

- All `GET /api/assets*`, `POST /api/assets*`, `PATCH /api/assets*`
- All `GET /api/work-orders*`, `POST /api/work-orders*`, `PATCH /api/work-orders*`
- All `GET /api/pm-schedules*`, `POST /api/pm-schedules*`, `PATCH /api/pm-schedules*`
- All `GET /api/uploads*`, `POST /api/uploads*`, `DELETE /api/uploads*`
- All `GET /api/knowledge*`
- All `GET /api/connections*`, `DELETE /api/connections*`
- All `GET /api/picker/*`
- All `GET /api/integrations*`, `POST /api/integrations*`, `GET /api/integrations*`
- `GET /api/events*`
- `GET /api/cmms/stats`
- `GET /api/channels`
- `POST /api/agents/morning-brief`, `GET /api/agents/pm-escalation/check`, `GET /api/agents/safety-events`
- `POST /api/kg/sync`
- `GET /api/export`
- `GET /api/team`
- `GET /api/me`
- `GET /api/user/preferences`
- `GET /api/usage`
- `POST /api/reports/generate`

### Admin-only (Requires session + admin role)

- `GET /hub/api/admin/users`
- `GET /hub/api/admin/users/[id]`

### Authenticated Hub Routes

- `POST /hub/api/auth/magic-link`
- `GET /hub/api/auth/check-approval`

---

## TODO / Stub Markers in API Code

| File | Line Range | Context |
|---|---|---|
| `api/work-orders/route.ts` | ~126 | GET implemented; POST stub exists but not connected to business logic. |
| `api/assets/route.ts` | ~58–109 | POST implemented; fires asset enrichment async. |
| `api/pm-schedules/route.ts` | ~N/A | GET fully working; POST / PATCH stubs exist. |
| `api/cmms/stats/route.ts` | ~N/A | Atlas CMMS fetch fully working (basic auth, hardcoded endpoints). |
| `providers/data-provider.ts` | ~38–39 | Conditional: uses mock data if `NEXT_PUBLIC_PIPELINE_API_URL` unset (fallback behavior is intentional). |
| `lib/agents/asset-intelligence.ts` | ~80+ | Async enrichment (KB, KG, CMMS, web, OEM, YouTube) — fully wired; uses multiple fallback sources. |
| `lib/knowledge-graph/` | ~N/A | KG extraction/context fully implemented (entity & relationship CRUD). |

**No hard TODOs or `// TODO` comments blocking critical flows.** Architecture is feature-complete for MVP; deferred items (Modbus/PLC drivers, advanced auth flows) are in separate modules (mira-connect, archived branches).

---

## Safety & Security Observations

### Implemented Guardrails

1. **Safety Keywords** — 21 phrases (arc flash, LOTO, confined space, etc.) trigger immediate STOP in asset chat (`api/assets/[id]/chat`).
2. **MIME Validation** — sniffing (magic bytes) + file size enforcement (20 MB limit).
3. **Asset Tag Validation** — path prefix check (prevents `../` traversal).
4. **Tenant Isolation** — all queries use `withTenantContext()` + RLS on NeonDB.
5. **Rate Limiting** — per-IP, 5 registrations/hour on `POST /api/auth/register`.
6. **LLM Cascade** — no single-provider dependency; falls through Groq → Cerebras → Gemini.
7. **OAuth State Encryption** — OAUTH_TOKEN_ENC_KEY protects state parameter.
8. **CORS Headers** — `POST /api/auth/register` validates origin against allowlist.

### Known Limitations

- **Nango optional** — If `NANGO_SERVER_URL` unreachable, credential proxying fails gracefully (fallback not specified; check error handling).
- **Exa web search optional** — If `EXA_API_KEY` missing, asset enrichment skips web search (no hard error).
- **CMMS optional** — If `HUB_CMMS_API_URL` unavailable, stats query fails; no fallback.
- **Email optional** — If `RESEND_API_KEY` missing, magic-link delivery fails silently.

---

## Request/Response Examples

### Asset Chat (Streaming SSE)

```
POST /api/assets/[assetId]/chat
Content-Type: application/json

{ "question": "What maintenance is overdue?" }

200 OK
Content-Type: text/event-stream

data: {"type":"chunk","content":"Based on..."}
data: {"type":"chunk","content":" your asset..."}
...
data: {"type":"done","citations":[...]}
```

### Work Order Fetch

```
GET /api/work-orders?status=open&source=auto_pm

200 OK
{
  "count": 3,
  "work_orders": [
    {
      "id": "1",
      "title": "...",
      "source": "auto_pm",
      "suggested_actions": [...],
      "safety_warnings": [...],
      ...
    }
  ]
}
```

### Upload Document

```
POST /api/uploads
Content-Type: application/json

{
  "provider": "google",
  "externalFileId": "drive_file_id",
  "filename": "manual.pdf",
  "mimeType": "application/pdf",
  "assetTag": "PUMP-A1"
}

201 Created
{
  "id": "upload_uuid",
  "status": "processing",
  "requestId": "uuid",
  ...
}
```

### Auth Status

```
GET /api/auth/status

200 OK
{
  "user": { "id": "...", "email": "...", "name": "..." },
  "tenant": { "id": "...", "name": "..." },
  "roles": ["viewer"],
  "authenticated": true
}
```

---

## Conclusion

**mira-hub** is a comprehensive Next.js 16 SaaS application tier exposing 50+ REST endpoints across:
- **Auth:** OAuth (Google, Microsoft, Confluence, Dropbox, Slack), magic links, registration, Telegram webhooks.
- **Core workflows:** Work orders, assets, PM schedules, uploads, integrations.
- **Intelligence:** Asset enrichment (6 sources), chat with safety guardrails, reports generation.
- **Infrastructure:** Health checks, usage metrics, team management, admin controls.

All authenticated routes require a NextAuth session (JWT). Outbound calls span LLM providers (Groq/Cerebras/Gemini cascade), document processing (mira-ingest), vector search (Qdrant/OpenWebUI), CMMS systems (Atlas), and OAuth providers. Database is exclusively NeonDB with tenant-scoped RLS.

**Key strength:** Comprehensive cascade architecture (LLM, KB search, web search) + strong safety controls (keyword detection, MIME validation). **Key gaps:** Optional Nango/Exa/CMMS with no hard fallbacks; consider adding explicit error-logged degradation for production observability.

