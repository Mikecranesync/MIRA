# MIRA Hub Integrations — Implementation Guide

**Version:** v1.0 | **Date:** 2026-04-28 | **Companion PRD:** `docs/PRD_Hub_Integrations_v1.md`

---

## 1. What Already Exists (Don't Rebuild)

Before writing a line of code, understand the infrastructure already in place.

### OAuth Framework (Production)

The Hub ships a complete OAuth 2.0 framework:

| File | Purpose |
|------|---------|
| `src/lib/oauth-state.ts` | State token generation (24-byte random, base64) + constant-time validation |
| `src/lib/connections.ts` | Client-side `localStorage` wrapper (`mira_connections_v2`) |
| `src/lib/bindings.ts` | Server-side NeonDB CRUD via `hub_channel_bindings` table |
| `src/app/api/auth/[provider]/route.ts` | OAuth initiation — sets secure httpOnly cookie, redirects to provider |
| `src/app/api/auth/[provider]/callback/route.ts` | OAuth callback — validates state, exchanges code for token, calls `upsertBinding()` |

**Live providers:** Slack, Google, Microsoft, Dropbox, Confluence, Telegram (token-based), OpenWebUI (URL-based).

Adding a new OAuth provider means: (a) add a `route.ts` initiation handler, (b) add a `callback/route.ts` handler, (c) register it in `ConnectorCard` on the channels page. No framework changes needed.

### Token Storage (`hub_channel_bindings`)

NeonDB table created at runtime by `ensureSchema()` in `bindings.ts`:

```sql
CREATE TABLE IF NOT EXISTS hub_channel_bindings (
    id                SERIAL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    provider          TEXT NOT NULL,
    external_id       TEXT,
    access_token_enc  TEXT,          -- encrypted at rest
    refresh_token_enc TEXT,          -- encrypted at rest
    token_expires_at  TIMESTAMPTZ,
    scopes            TEXT[],
    meta              JSONB,
    status            TEXT NOT NULL DEFAULT 'active',
    connected_at      TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, provider)
);
```

Key properties:
- One row per `(tenant_id, provider)` — upsert semantics on reconnect
- Tokens encrypted in `access_token_enc` / `refresh_token_enc` (AES, key in Doppler)
- RLS enabled — queries always scoped to the calling tenant
- `status` field: `active | disconnected | error` — drives Hub UI badge color

### ConnectorCard Component

`src/app/(hub)/channels/page.tsx:41` — the single reusable card:

```typescript
interface CardProps {
    emoji: string;
    name: string;
    description: string;
    conn: ConnectionMeta;          // from localStorage / bindings API
    onConnect: () => void;
    onDisconnect: () => void;
    disabled?: boolean;
    comingSoon?: boolean;          // grays out + shows "Coming Soon" badge
    infoOnly?: boolean;            // shows info panel instead of connect button
}
```

To add a new channel card: add an entry to the channels array in `page.tsx` with `comingSoon: true` initially — it renders without wiring. Remove `comingSoon` when the backend is live.

---

## 2. Shared Infrastructure Still Needed

These are the three cross-cutting pieces that must be built before most integrations can go live.

### 2.1 Webhook Ingress Endpoint

**What it is:** A single authenticated POST endpoint that receives inbound events from external platforms and routes them to the MIRA engine.

**Gap:** No `/api/webhook/` route exists. The integrations page has a `WebhookTarget` UI concept but no receiver.

**Implementation:**

```
src/app/api/webhook/[provider]/route.ts
```

Pattern for each provider:
1. Verify inbound signature (HMAC-SHA256 for Slack/GitHub, Bearer token for others)
2. Parse event → `NormalizedChatEvent` using the provider's `ChatAdapter.normalize_incoming()`
3. Forward to MIRA pipeline (`POST http://mira-pipeline:9099/chat`)
4. Return 200 immediately (async processing — never block the webhook response)

**Signature verification library:** Use Node.js `crypto.timingSafeEqual()` — same pattern as `oauth-state.ts`.

**Providers needing webhook ingress (priority order):**
1. Slack Events API (event_callback, url_verification challenge)
2. Microsoft Teams (activity from Bot Framework)
3. WhatsApp / Twilio (Twilio form POST)
4. Google Chat (JSON POST from Google)
5. GitHub (repo events for KB update triggers)

### 2.2 OAuth Token Refresh

**Gap:** `hub_channel_bindings` stores `token_expires_at` and `refresh_token_enc` but no refresh loop runs.

**Implementation:** Add a server-side route `src/app/api/connections/refresh/route.ts`:

```typescript
// Called by a Vercel cron or explicit trigger
// 1. SELECT all bindings WHERE token_expires_at < now() + interval '10 minutes'
// 2. For each: call provider's token refresh endpoint
// 3. upsertBinding() with new tokens
```

For the MVP: call refresh on-demand in `getBinding()` when `token_expires_at` is near. Add a background Vercel Cron (`vercel.json`) for scheduled refresh after GA.

### 2.3 CMMS Adapter Server-Side Routing

**Gap:** The integrations page CMMS tab shows Atlas (live via MCP), Limble, MaintainX, UpKeep, Fiix (all mock). There's no server-side routing layer that takes a work-order event and dispatches to the right CMMS based on the tenant's active connection.

**Implementation:**

```
src/app/api/cmms/work-orders/route.ts   -- POST to create WO in connected CMMS
src/app/api/cmms/assets/route.ts        -- GET asset list from connected CMMS
src/app/api/cmms/sync/route.ts          -- Trigger full sync for a tenant
```

Each route:
1. Load tenant's active CMMS binding from `hub_channel_bindings` (provider = "atlas" | "limble" | ...)
2. Instantiate the matching `CMMSAdapter` from `mira-mcp/cmms/`
3. Call the adapter's typed method
4. Return normalized response

---

## 3. Sprint Plan

### Sprint 1 — Foundation (Week 1–2)
*Prerequisite for everything else. Ship before touching any new connector.*

| Task | File(s) | Effort | Owner |
|------|---------|--------|-------|
| Webhook ingress endpoint | `api/webhook/[provider]/route.ts` | 1d | Backend |
| Slack webhook verification (HMAC) | `api/webhook/slack/route.ts` | 0.5d | Backend |
| Token refresh on-demand | `api/connections/refresh/route.ts` | 0.5d | Backend |
| Wire `integrations/page.tsx` CMMS tab to real binding data | `integrations/page.tsx` | 0.5d | Frontend |
| Replace mock webhook targets with NeonDB CRUD | `integrations/page.tsx` + new API route | 1d | Full-stack |

**Exit criteria:** Slack can send an event to `/api/webhook/slack`, MIRA responds in Slack thread, webhook target shows real status in Hub.

---

### Sprint 2 — Communication Channels (Week 3–4)
*High-leverage: each channel multiplies the user surface.*

| Connector | What's needed | Effort |
|-----------|--------------|--------|
| **Slack** (full) | Webhook ingress wired + `hub_channel_bindings` token used for posting | 1d |
| **WhatsApp via Twilio** | Add Twilio OAuth entry to channels page + webhook ingress route | 2d |
| **Microsoft Teams** | Bot Framework registration + webhook ingress | 2d |
| **Email (SMTP)** | `Nodemailer` outbound + IMAP polling inbound (or SendGrid inbound parse) | 2d |

**Exit criteria:** 4 channels can receive a message and MIRA replies through the same channel.

---

### Sprint 3 — Productivity Suites (Week 5–6)
*Google and Microsoft already have OAuth. These wire the tokens to real API calls.*

| Connector | What's needed | Effort |
|-----------|--------------|--------|
| **Google Drive KB sync** | Cron job: poll Drive folder → `mira-crawler` ingest | 2d |
| **Confluence KB sync** | Confluence Cloud REST API → `mira-crawler` ingest | 2d |
| **Dropbox KB sync** | Dropbox webhooks → `mira-crawler` ingest | 1d |
| **SharePoint KB sync** | Microsoft Graph → `mira-crawler` ingest | 2d |
| **Outlook calendar** | Graph API read maintenance windows | 1d |

**Exit criteria:** Connecting Google Drive triggers a KB ingest run; new documents appear in MIRA RAG results.

---

### Sprint 4 — CMMS Connectors (Week 7–8)
*Atlas is live via MCP. Remaining four need adapter + OAuth.*

| Connector | What's needed | Effort |
|-----------|--------------|--------|
| **Limble CMMS** | OAuth 2.0 + `LimbleCMMSAdapter` implementing `CMMSAdapter` base | 3d |
| **MaintainX** | API key auth + `MaintainXAdapter` | 2d |
| **UpKeep** | API key auth + `UpKeepAdapter` | 2d |
| **Fiix** | SOAP/REST + `FiixAdapter` (complex auth) | 3d |

**CMMS adapter pattern** (follow `mira-mcp/cmms/` existing structure):

```python
class LimbleCMMSAdapter(CMMSAdapter):
    async def create_work_order(self, title, asset_id, description, priority) -> WorkOrder: ...
    async def list_assets(self, site_id=None) -> list[Asset]: ...
    async def get_work_order(self, wo_id) -> WorkOrder: ...
    async def update_work_order(self, wo_id, **kwargs) -> WorkOrder: ...
```

---

### Sprint 5 — Operational Tools (Week 9–10)

| Connector | What's needed | Effort |
|-----------|--------------|--------|
| **GitHub** | Webhook for doc changes → KB re-ingest | 1d |
| **Jira** | OAuth + create issue from MIRA WO recommendation | 2d |
| **PagerDuty** | Webhook receive alert → MIRA diagnosis | 1.5d |
| **Datadog** | Webhook receive anomaly → MIRA analysis | 1.5d |

---

### Sprint 6 — IoT / Sensor (Week 11–12)
*Hardware-gated. Defer until at least 3 CMMS connectors are GA.*

| Connector | What's needed | Effort |
|-----------|--------------|--------|
| **Ignition** | `mira-relay` already built — wire Hub UI to show tag stream status | 1d |
| **MQTT broker** | `mira-connect` module (deferred "Config 4") — new service | 5d |
| **Modbus TCP** | `mira-connect` expansion | 3d |
| **OSIsoft PI** | PI Web API + polling | 4d |

---

## 4. Hub UI Patterns

### Adding a New Connector Card

1. **Add to channels array** in `src/app/(hub)/channels/page.tsx`:

```typescript
{
    emoji: "🔧",
    name: "Limble CMMS",
    description: "Sync work orders and assets with Limble.",
    provider: "limble",
    comingSoon: false,          // set true until backend is live
}
```

2. **Add OAuth initiation route:** `src/app/api/auth/limble/route.ts`
3. **Add OAuth callback route:** `src/app/api/auth/limble/callback/route.ts`
4. **Add provider to `ConnectionMeta` type** in `src/lib/connections.ts`

That's it. `ConnectorCard` handles the rest: connected/disconnected state badge, connect/disconnect buttons, error display.

### Connect / Disconnect Flow

```
User clicks Connect
  → channels/page.tsx onConnect()
  → redirect to /api/auth/[provider]
  → provider sets secure cookie with CSRF state
  → provider redirects to OAuth consent page

User approves
  → provider redirects to /api/auth/[provider]/callback
  → callback validates CSRF state (timingSafeEqual)
  → callback exchanges code for token pair
  → upsertBinding() writes to hub_channel_bindings
  → redirect to /channels with ?connected=provider
  → page reads binding → updates localStorage ConnectionMeta
  → ConnectorCard shows "Connected" badge

User clicks Disconnect
  → DELETE /api/connections/[provider]
  → hub_channel_bindings row: status = 'disconnected', tokens nulled
  → localStorage entry removed
  → ConnectorCard shows "Connect" button
```

### Status Monitoring Panel

The integrations page (`src/app/(hub)/integrations/page.tsx`) currently shows mock `WebhookTarget[]` data. Replace with a real-time panel:

```typescript
// Replace static WEBHOOK_TARGETS with:
const { data: webhooks } = useSWR('/api/connections/webhooks', fetcher, { refreshInterval: 30000 })
```

Backend route `GET /api/connections/webhooks`:
- Query `hub_channel_bindings` WHERE `meta->>'type' = 'webhook'`
- Join `agent_events` for last-fired timestamp
- Return `[{ provider, status, last_call, error_count }]`

Status badge colors follow existing pattern: `active` → green, `error` → red, `disconnected` → gray.

---

## 5. Credential Vault Conventions

All new integration credentials follow this pattern:

| Credential type | Where stored | Format |
|----------------|-------------|--------|
| OAuth access token | `hub_channel_bindings.access_token_enc` | AES-256 encrypted, key = `HUB_TOKEN_ENCRYPTION_KEY` in Doppler |
| OAuth refresh token | `hub_channel_bindings.refresh_token_enc` | Same |
| API key (non-OAuth) | `hub_channel_bindings.meta->>'api_key_enc'` | Same encryption |
| Webhook signing secret | `hub_channel_bindings.meta->>'signing_secret_enc'` | Same encryption |
| Short-lived UI state | `localStorage` via `connections.ts` | Unencrypted — status only, never tokens |

**Never** store raw tokens in `meta` JSONB, `localStorage`, or environment variables. If a provider uses a static API key (no OAuth), store it encrypted in the `meta` JSONB column using the same `encrypt()` / `decrypt()` helpers.

Add `HUB_TOKEN_ENCRYPTION_KEY` to Doppler `factorylm/prd` before Sprint 1 ships.

---

## 6. Testing Each Connector

### Unit Tests
Each new adapter gets a test file at `mira-mcp/cmms/tests/test_[provider]_adapter.py`:
- Mock the provider's HTTP responses
- Assert `WorkOrder` fields are correctly mapped
- Assert error states return typed exceptions (not raw HTTP errors)

### Integration Tests (Sprint gate)
Before a sprint is "done", run the connector e2e:
1. Connect via Hub UI — verify `hub_channel_bindings` row appears in NeonDB
2. Send a test message on the channel — verify MIRA replies in the same thread
3. Trigger a WO creation — verify it appears in the CMMS UI
4. Disconnect — verify `status = 'disconnected'` in NeonDB and Hub shows gray badge

### Benchmark Impact
After each new channel ships, re-run `python benchmarks/benchmark_suite.py --version X.Y.Z` from inside the `mira-bots` container. The benchmark's Technical and WO Quality dimensions will surface regressions introduced by routing changes.

---

## 7. File Checklist per New Connector

```
□ src/app/api/auth/[provider]/route.ts         -- OAuth initiation
□ src/app/api/auth/[provider]/callback/route.ts -- OAuth callback + upsertBinding
□ src/app/api/webhook/[provider]/route.ts       -- Inbound event receiver
□ src/app/(hub)/channels/page.tsx               -- Add ConnectorCard entry
□ mira-mcp/cmms/[provider]_adapter.py           -- (CMMS only) CMMSAdapter impl
□ mira-mcp/cmms/tests/test_[provider]_adapter.py -- (CMMS only) unit tests
□ docs/env-vars.md                              -- Document any new env vars
□ .env.template                                 -- Add placeholder (no real values)
```

**Definition of done per connector:**
- ConnectorCard shows real connected/disconnected state
- Inbound message reaches MIRA engine and reply is delivered
- Token is stored encrypted in `hub_channel_bindings` (verify with `SELECT access_token_enc FROM hub_channel_bindings WHERE provider = '...'`)
- `ruff check` passes on any new Python
- `tsc --noEmit` passes on any new TypeScript
