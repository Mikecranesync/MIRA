# Public Ingest API + MCP Spec — "Twilio for Maintenance Data"

**Status:** Draft v1 — spec only, no implementation
**Owner:** Mike Harper / MIRA Hub team
**Created:** 2026-05-11
**Related specs:**
- `docs/specs/mira-hub-spec.md` (current internal API contract)
- `docs/specs/hub-cmms-integration-spec.md` (Hub↔Atlas integration reality)
- `docs/specs/mira-mcp-spec.md` (existing MCP tool surface)
- `NORTH_STAR.md` (flywheel + cooperative)

---

## 1. TL;DR

Turn the FactoryLM Hub into a public ingest substrate for industrial maintenance
data. Customers' existing CMMS, SCADA, historian, MES, and spreadsheet workflows
push data in via:

- **REST** — `factorylm.com/api/v1/*` — boring HTTPS + Bearer token. Any
  language, any platform.
- **MCP** — same surface exposed as tools so AI agents (OpenAI, Anthropic,
  in-house) can read/write FactoryLM data natively.

Both surfaces are **tenant-scoped, RLS-enforced, rate-limited, and idempotent
where it matters**. Internally they reuse the existing `withTenantContext` +
`cmms_equipment` / `work_orders` / `knowledge_entries` / `hub_uploads` tables —
this spec adds *no* new domain model, only a public façade with API-key auth
and quota.

Mental model: **Twilio for maintenance data.** A system integrator should be
able to wire a customer's Ignition tag stream, Maximo work-order export, or
SharePoint manual folder into FactoryLM in under an hour using nothing but
`curl` and our docs.

Sandbox: a prospect signs up, gets a pre-loaded demo tenant + 7-day API key +
interactive playground, and can push their own data alongside seed data before
ever talking to sales.

---

## 2. Goals / Non-Goals

### Goals
1. One stable, documented public surface for *all* customer data ingest.
2. Same domain model exposed three ways (UI / REST / MCP) — never diverging
   shapes.
3. Frictionless 5-minute trial that demonstrates the flywheel without sales
   involvement.
4. Forward-compatible response shapes for **i3X** (Object/Element/VQT) so
   we're not locked out of the emerging interoperability standard.
5. Reuse existing tenancy + RLS + upload pipeline. No parallel data model.

### Non-Goals
- Replacing the internal `/api/*` routes used by the hub UI session. Those
  stay JWT-cookie-auth'd. The `/api/v1/*` surface is the *public* mirror.
- Building new connectors (MaintainX, Fiix, Limble already exist in
  `mira-mcp/cmms/`). This spec defines the substrate they push into.
- A full IDP/OAuth2 dance. API keys only in v1. OAuth2 client-credentials is
  a v2 follow-up if enterprise asks.
- Realtime streaming (WebSocket/MQTT). v1 is HTTP POST batches. UNS/MQTT
  bridge is a separate spec.

---

## 3. Mental Model — "Twilio for Maintenance"

| Twilio | FactoryLM |
|---|---|
| Phone numbers | Asset tags |
| SMS message | Work order, fault event, tag value |
| Programmable Voice | `mira_ask` (LLM diagnostic over your data) |
| Webhooks | Outbound events (v2) |
| Console + live logs | Hub UI + `/api/v1/usage` |
| Trial account | 7-day sandbox tenant w/ seed data |
| SDKs | `@factorylm/sdk-js`, `factorylm-py` (v2) |

Every endpoint is something a **system integrator** could reasonably script
against on day one without a sales call.

---

## 4. Authentication

### 4.1 API Keys
- Format: `flm_<env>_<random32>` — e.g. `flm_live_a1b2…` / `flm_sbx_…`.
- Stored: new table `public_api_keys` (`id`, `tenant_id`, `key_hash`,
  `prefix`, `name`, `scopes TEXT[]`, `created_at`, `last_used_at`,
  `revoked_at`, `expires_at`).
- Hash: argon2id of full key. Only prefix (`flm_live_a1b2`) is shown in UI
  after creation.
- Header: `Authorization: Bearer flm_live_...`
- Resolution: middleware `withApiKey(req)` → `{ tenantId, keyId, scopes,
  tier }`. Mirrors the existing `sessionOr401` shape so route handlers can
  share logic via a `withAuthContext` wrapper that accepts either source.
- Scopes (v1): `assets:read`, `assets:write`, `wo:read`, `wo:write`,
  `tags:write`, `events:write`, `knowledge:read`, `knowledge:write`,
  `ask:invoke`. Default scope on creation = all read + all write for that
  tenant.
- Revocation: soft-delete via `revoked_at`. Check on every request (cached
  60 s in-process).
- Rotation: `POST /api/v1/me/api-keys` creates new; old still valid until
  explicit revoke.

### 4.2 Tier Limits

| Tier | Rate (req/hr) | Burst | File MB/tenant/day | LLM `ask` calls/day |
|---|---|---|---|---|
| Sandbox (7 day) | 100 | 20/min | 100 | 25 |
| Individual | 100 | 30/min | 500 | 50 |
| Community | 1,000 | 200/min | 2,000 | 500 |
| Professional | 10,000 | 1,000/min | 20,000 | 5,000 |
| Enterprise | custom | custom | custom | custom |

Reuses `mira-core/mira-ingest/db/neon.py:check_tier_limit` pattern.
Fail-open on counter DB error, log to `prometheus_counter("api_v1_quota_db_error")`.

Headers on every response:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 987
X-RateLimit-Reset: 1717024800
```
429 returns JSON `{ "error": "rate_limited", "retry_after": 42 }`.

---

## 5. REST API — `factorylm.com/api/v1/`

### 5.1 Conventions
- JSON in / JSON out. `Content-Type: application/json` (multipart for `/documents`).
- Timestamps: RFC 3339 UTC (`2026-05-11T14:30:00Z`).
- IDs: UUID v4 strings. Customers may also send `external_id` to dedupe.
- Idempotency: `Idempotency-Key: <uuid>` header honored on all POSTs; result
  cached 24 h per (tenant, key).
- Pagination: `?cursor=...&limit=50` (max 200). Response includes
  `next_cursor` (null on last page).
- Errors: RFC 7807-ish:
  ```json
  { "error": "validation_failed",
    "message": "manufacturer is required",
    "field": "manufacturer",
    "request_id": "req_..." }
  ```
- Every response carries `X-Request-Id` (also logged) for support.
- Versioning: URL-versioned (`/v1`). Breaking changes → `/v2`. Additive
  changes (new optional fields) stay in `/v1`.
- All write endpoints emit an internal audit row to `api_v1_audit_log`
  (tenant_id, key_id, method, path, status, request_id, latency_ms).

### 5.2 Endpoint Catalog

Each endpoint maps directly to an existing internal table — no new schema.

| # | Endpoint | Method(s) | Backs onto | P-tier | Notes |
|---|---|---|---|---|---|
| 1 | `/api/v1/assets` | GET, POST | `cmms_equipment` | **P0** | Mirrors `mira-hub/src/app/api/assets/route.ts` |
| 2 | `/api/v1/assets/{id}` | GET, PATCH, DELETE | `cmms_equipment` | **P0** | DELETE = soft via `deleted_at` |
| 3 | `/api/v1/documents` | POST (multipart), GET list | `hub_uploads` + `knowledge_entries` | **P0** | Reuses `upload-pipeline.ts` |
| 4 | `/api/v1/documents/{id}` | GET, DELETE | `hub_uploads` | **P0** | GET returns parse status + chunks count |
| 5 | `/api/v1/work-orders` | GET, POST | `work_orders` | **P0** | Mirrors existing route |
| 6 | `/api/v1/work-orders/{id}` | GET, PATCH | `work_orders` | **P0** | PATCH for status transitions |
| 7 | `/api/v1/knowledge` | GET, POST | `knowledge_entries` | **P0** | Text-only push (PDF goes through `/documents`) |
| 8 | `/api/v1/knowledge/search` | GET | `knowledge_entries` (RAG) | **P0** | `?q=...&limit=20` returns chunks + scores |
| 9 | `/api/v1/ask` | POST | mira-pipeline `/v1/chat/completions` | **P0** | Natural-language Q&A against tenant data |
| 10 | `/api/v1/components` | GET, POST | `cmms_components` (new sub-table, see §6) | **P1** | Parent FK → `cmms_equipment.id` |
| 11 | `/api/v1/tags` | POST (batch), GET | `uns_tag_values` (new, see §6) | **P1** | UNS-compatible VQT shape |
| 12 | `/api/v1/tags/{path}/history` | GET | `uns_tag_values` | **P1** | Range query, paginated |
| 13 | `/api/v1/events` | POST, GET | `equipment_faults` (existing) | **P1** | Maps to fault history |
| 14 | `/api/v1/pm-schedules` | GET, POST, PATCH | `pm_schedules` (existing) | **P1** | Mirrors `/api/pm-schedules` |
| 15 | `/api/v1/me` | GET | session/key context | **P0** | Tenant, tier, quota, scopes |
| 16 | `/api/v1/me/api-keys` | GET, POST, DELETE | `public_api_keys` | **P0** | Self-service key mgmt |
| 17 | `/api/v1/usage` | GET | `api_v1_audit_log` rollup | **P0** | Daily req counts by endpoint |
| 18 | `/api/v1/connectors` | GET | static list | **P2** | Marketplace preview |
| 19 | `/api/v1/connectors/{id}/connect` | POST | nango handoff | **P2** | OAuth start URL |

### 5.3 Request/Response Shapes

#### 5.3.1 Asset

`POST /api/v1/assets`
```json
{
  "tag": "PUMP-0042",                   // optional; auto-generated if omitted
  "name": "Stardust Coaster Lift Pump",
  "manufacturer": "Grundfos",
  "model": "CR 32-3",
  "serial_number": "9921-4471",
  "location": "Bay 7 / Lift House",
  "parent_asset_id": "uuid-or-null",
  "criticality": "high",                // low|medium|high|critical
  "install_date": "2024-08-01",
  "tags": ["pump","cooling","stardust"],
  "custom_fields": { "vfd_drive": "GS10-..." },
  "external_id": "sap-EQ-9921"          // for idempotent upsert from customer system
}
```

Response 201:
```json
{
  "id": "uuid",
  "tag": "PUMP-0042",
  "name": "...",
  "manufacturer": "Grundfos",
  "model": "CR 32-3",
  "serial_number": "9921-4471",
  "location": "Bay 7 / Lift House",
  "parent_asset_id": null,
  "criticality": "high",
  "install_date": "2024-08-01",
  "tags": ["pump","cooling","stardust"],
  "custom_fields": { "vfd_drive": "GS10-..." },
  "external_id": "sap-EQ-9921",
  "work_order_count": 0,
  "downtime_hours": 0,
  "last_maintenance_at": null,
  "qr_url": "https://factorylm.com/qr/uuid.png",
  "created_at": "2026-05-11T14:30:00Z",
  "updated_at": "2026-05-11T14:30:00Z",
  "i3x": {                              // forward-compat envelope
    "element_id": "uuid",
    "object_type": "Asset",
    "namespace": "factorylm/stardust/bay7/PUMP-0042"
  }
}
```

#### 5.3.2 Document

`POST /api/v1/documents` (multipart/form-data):
- `file` — binary, ≤ 20 MB
- `asset_id` *or* `asset_tag` (optional)
- `kind` — `manual` | `drawing` | `photo` | `nameplate` | `other`
- `title` (optional)
- `external_id` (optional)

Response 202 (async parse):
```json
{
  "id": "uuid",
  "status": "queued",                   // queued|fetching|parsing|parsed|failed
  "asset_id": null,
  "filename": "grundfos_cr32.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 2842113,
  "kind": "manual",
  "external_id": null,
  "created_at": "..."
}
```

`GET /api/v1/documents/{id}` returns the same shape with `status=parsed`,
`chunks_indexed: 142`, `pages: 84`, `extracted_pms: 7`.

#### 5.3.3 Work Order

`POST /api/v1/work-orders`
```json
{
  "asset_id": "uuid",                   // OR asset_tag
  "title": "Pump cavitation on startup",
  "description": "...",
  "fault_description": "Suction pressure drops below 2 psi within 5 s of start",
  "priority": "high",                   // low|medium|high|critical
  "type": "corrective",                 // corrective|preventive|inspection|safety
  "assigned_to": "user@plant.com",
  "due_date": "2026-05-15",
  "external_id": "maximo-WO-77241"
}
```

Response 201 — same shape as existing internal API (`work_order_number`,
`status: "open"`, etc.) + `external_id` + `i3x` envelope.

#### 5.3.4 Tag / Signal (UNS-compatible)

`POST /api/v1/tags` — batch up to 500:
```json
{
  "tags": [
    {
      "path": "factorylm/stardust/bay7/PUMP-0042/suction_psi",
      "value": 1.8,
      "quality": "good",                // good|bad|uncertain
      "timestamp": "2026-05-11T14:30:00.142Z",
      "unit": "psi",
      "type": "float"
    }
  ]
}
```

Response 202 `{ "accepted": 500, "rejected": 0 }`. Storage table
`uns_tag_values(tenant_id, path, value_json, quality, ts, ingested_at)` with
TimescaleDB hypertable (or Neon partitioned table) on `ts`.

#### 5.3.5 Event / Fault

`POST /api/v1/events`
```json
{
  "asset_id": "uuid",
  "event_type": "fault",                // fault|alarm|state_change|maintenance
  "severity": "warning",                // info|warning|error|critical
  "code": "E-1042",
  "description": "Bearing temp high",
  "timestamp": "2026-05-11T14:30:00Z",
  "context": { "temp_c": 92.1, "rpm": 1740 }
}
```

Writes to existing `equipment_faults` + emits an internal event bus message
that the auto-PM agent and diagnostic engine subscribe to.

#### 5.3.6 Knowledge

`POST /api/v1/knowledge`
```json
{
  "title": "Cavitation troubleshooting for Grundfos CR series",
  "content": "When suction pressure drops below NPSH...",
  "source_url": "https://...",
  "asset_id": "uuid-or-null",
  "manufacturer": "Grundfos",
  "model": "CR 32-3",
  "tags": ["pump","cavitation"],
  "external_id": "wiki-page-2412"
}
```

Chunks + embeds via existing `mira-mcp/_rest_embed` path, writes to
`knowledge_entries` with `tenant_id = ctx.tenantId` AND `is_private = true`.
(Public OEM corpus stays as-is, see §7.)

#### 5.3.7 Ask (the headline endpoint)

`POST /api/v1/ask`
```json
{
  "query": "Why is PUMP-0042 cavitating on startup?",
  "asset_id": "uuid",                   // optional context anchor
  "include_sources": true,
  "stream": false
}
```

Response:
```json
{
  "answer": "Likely causes ranked: (1) suction line air ingestion — your last fault log...",
  "sources": [
    { "type": "knowledge", "id": "...", "title": "...", "score": 0.87 },
    { "type": "work_order", "id": "...", "number": "WO-2024-0142" },
    { "type": "fault", "id": "...", "code": "E-1042" }
  ],
  "request_id": "req_...",
  "latency_ms": 1842,
  "cost_units": 1
}
```

Streaming variant returns `text/event-stream` SSE compatible with OpenAI
chat-completions clients. Backs onto `mira-pipeline:9099/v1/chat/completions`
(which already cascades Groq → Cerebras → Gemini → Open WebUI; never
Anthropic per CLAUDE.md §3).

---

## 6. New Tables Required

Only three. Everything else reuses existing tables.

### `public_api_keys`
```sql
CREATE TABLE public_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,              -- 'flm_live_a1b2' for display
  key_hash     TEXT NOT NULL,              -- argon2id of full key
  scopes       TEXT[] NOT NULL,
  tier         TEXT NOT NULL,              -- sandbox|individual|community|professional|enterprise
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,                -- NULL = no expiry
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX ON public_api_keys (tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX ON public_api_keys (key_hash) WHERE revoked_at IS NULL;
ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public_api_keys
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### `api_v1_audit_log` (append-only)
```sql
CREATE TABLE api_v1_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  key_id      UUID,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INT NOT NULL,
  latency_ms  INT,
  request_id  TEXT NOT NULL,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
```
Partition by month, auto-drop after 90 days for non-Enterprise tiers.

### `uns_tag_values` (P1, only when `/tags` ships)
```sql
CREATE TABLE uns_tag_values (
  tenant_id    UUID NOT NULL,
  path         TEXT NOT NULL,
  value_json   JSONB NOT NULL,
  quality      TEXT NOT NULL DEFAULT 'good',
  unit         TEXT,
  ts           TIMESTAMPTZ NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, path, ts)
) PARTITION BY RANGE (ts);
ALTER TABLE uns_tag_values ENABLE ROW LEVEL SECURITY;
```

`cmms_components` (P1) — if not already covered by `cmms_equipment.parent_asset_id`,
add a thin sub-component table; otherwise reuse parent_asset_id and ship a
`?as=tree` flag on `GET /assets`.

---

## 7. MCP Server — `mira_*` Tool Surface

Mirrors REST 1:1. Existing tools in `mira-mcp/server.py` keep their names for
backwards compatibility; new public tools get the `mira_` prefix and are
**tenant-scoped via API key passed as MCP server arg** (`MIRA_API_KEY` env
or `?api_key=` query string on the `/sse` endpoint).

### v1 tool list

| Tool | Maps to | Notes |
|---|---|---|
| `mira_create_asset` | POST `/assets` | Args mirror request body |
| `mira_get_asset` | GET `/assets/{id}` | Returns asset + components + recent WOs |
| `mira_list_assets` | GET `/assets` | Paginated, filter by `manufacturer`/`location` |
| `mira_update_asset` | PATCH `/assets/{id}` | |
| `mira_upload_document` | POST `/documents` | Accepts file bytes via MCP file primitive |
| `mira_get_document` | GET `/documents/{id}` | Status + chunks |
| `mira_list_documents` | GET `/documents` | |
| `mira_create_work_order` | POST `/work-orders` | Replaces internal `cmms_create_work_order` for public use |
| `mira_get_work_order` | GET `/work-orders/{id}` | |
| `mira_list_work_orders` | GET `/work-orders` | |
| `mira_close_work_order` | PATCH `/work-orders/{id}` | `{status: "closed", resolution: "..."}` |
| `mira_push_tag_value` | POST `/tags` | Batch up to 500 |
| `mira_get_tag_history` | GET `/tags/{path}/history` | |
| `mira_report_fault` | POST `/events` | |
| `mira_get_fault_history` | GET `/events` | Filter by asset/severity |
| `mira_push_knowledge` | POST `/knowledge` | |
| `mira_search_knowledge` | GET `/knowledge/search` | |
| `mira_ask` | POST `/ask` | **The headline tool.** NL Q&A over tenant data |
| `mira_whoami` | GET `/me` | Tenant, tier, quota, scopes |

### Transport
- Primary: streamable HTTP MCP at `https://mcp.factorylm.com` (one URL, no
  per-customer subdomain).
- Auth: `Authorization: Bearer flm_live_...` header on the MCP connection.
- Server resolves tenant from key → injects `current_setting('app.tenant_id')`
  on every DB call.
- All MCP tool calls flow through the **same** route-handler layer as REST
  (HTTP shim → handler function) so business logic is shared and tested
  once.

### Existing tool migration
- The current `cmms_*` tools in `mira-mcp/server.py` stay for internal/agent
  use but are marked `deprecated` in their description and removed in v2.
- The CMMS adapter layer (`mira-mcp/cmms/{maintainx,fiix,limble,atlas}.py`)
  is unaffected — it sits *below* the public API as one of many possible
  connectors a customer can configure.

---

## 8. Sandbox / Trial Experience — RECOMMENDED: Hybrid of A + B

The spec calls for "Option A: Instant sandbox" as the recommended path. After
reviewing the existing upload pipeline and Hub UX, **the trial should be a
hybrid of A and B**: instant sandbox is the trial *account*, but the first
thing a prospect *does* inside it is upload a manual (Option B) so they see
value in 60 seconds, not after they've read API docs.

### 8.1 Flow (5 minutes, no sales call)

1. **Sign-up** (`factorylm.com/start`) — email + plant name + role. No CC.
2. **Tenant provisioning** (~3 s):
   - Mint `tenant_id = uuid()`, mark `tier = 'sandbox'`,
     `sandbox_expires_at = now() + 7 days`.
   - Clone seed data: 5 assets (Stardust Racers lineup), 3 sample WOs,
     2 sample fault histories, 1 OEM manual already chunked.
   - Mint API key `flm_sbx_...`, scope = all, expires = +7d.
3. **Land on `/start/playground`** — split-screen:
   - **Left:** "Try it: upload a manual" — drop zone wired to `POST
     /api/v1/documents`. Shows parse progress (`queued → parsing → parsed`)
     with live polling. On `parsed`, shows extracted PM schedules + chunk
     count.
   - **Right:** Interactive Swagger UI (OpenAPI 3.1 served from
     `/api/v1/openapi.json`), pre-filled with the sandbox API key. Lets the
     prospect try `POST /assets`, `POST /work-orders`, `POST /ask` against
     either seed data or their just-uploaded manual.
4. **"Ask MIRA"** chat panel — wraps `POST /api/v1/ask`. Pre-suggested
   prompts: *"What are the PMs for the seed equipment?"*, *"Generate a
   troubleshooting checklist for fault E-1042"*, *"Summarize the manual I
   just uploaded."*
5. **Capture-on-success modal**: when the prospect successfully runs 3 API
   calls *or* gets one good `ask` answer, the modal asks for company name,
   plant size, current CMMS. Submit → flagged as MQL in HubSpot/Linear
   `Sales GTM` board.
6. **Day 7 lifecycle**:
   - Day 5 email: "your sandbox expires in 48 h, here's what you built"
     (summary of API calls + uploads).
   - Day 7: key auto-revoked, data preserved for 30 days, banner in UI
     says "Upgrade to keep building."
   - Day 30: data purged unless tenant converted.

### 8.2 What sandbox tenants CAN do
- All REST + MCP endpoints, scoped to their tenant.
- Upload up to 100 MB across documents.
- Read the **public OEM knowledge corpus** (the existing 83K-chunk
  knowledge_entries table — already non-tenant-scoped per
  `knowledge/route.ts` design comment).
- Push their own data alongside seed data.

### 8.3 What sandbox tenants CANNOT do
- Use real connectors (Nango, Atlas write-through) — those gate on
  `tier != 'sandbox'`. Sandbox shows a "connect MaintainX (Pro tier)" CTA
  that captures intent without authenticating.
- Exceed 100 req/hr or 25 `ask` calls/day.
- Invite teammates (single-user sandbox; collaboration unlocks on
  Community+).
- Opt out of the Knowledge Cooperative (Pro-tier setting).

### 8.4 Why not pure Option B (upload-only)
Pure upload-only demos parsing well but doesn't communicate the "Twilio
substrate" pitch — a system integrator evaluating us cares about the API
surface, not just "we OCR manuals." Hybrid lets the manual upload deliver the
emotional hook *while* the Swagger panel sells the platform.

### 8.5 Why not Option C (connector marketplace) in v1
Each connector OAuth dance is real engineering. We have MaintainX (PR #808
via Nango) — list it on the playground but mark "Pro tier" so it doesn't
gate the trial. Full marketplace is **P2** alongside the connector ecosystem
roadmap.

---

## 9. Security

### 9.1 Tenant isolation
- **Every** new table has RLS enabled with policy
  `tenant_id = current_setting('app.tenant_id')::uuid`.
- Route handlers MUST call `withTenantContext(tenantId, ...)` — never raw
  `pool.query`. Lint rule: ast-grep rule `no-raw-pool-query-in-api-v1.yml`
  added to `.ast-grep-rules/`.
- The existing `knowledge_entries` "public OEM corpus" pattern (no tenant
  filter) is preserved for *read* only on `/knowledge/search`. Customer
  writes via `/knowledge` always carry `tenant_id` + `is_private = true`.

### 9.2 File uploads
- Size: 20 MB per file, 500 MB/day per sandbox tenant, configurable per
  tier.
- MIME allowlist: `application/pdf`, `image/{jpeg,png,webp,heic}`,
  `application/dwg`, `text/plain`, `text/markdown`.
- Antivirus: ClamAV sidecar in the existing upload pipeline (add if not
  present). Reject on positive.
- Filename: never trust — store as `{uuid}.{ext}`, original name in DB.
- Path traversal: enforced via existing `asset_tag` validator pattern.

### 9.3 PII
- Inputs are sanitized **before** being passed to the LLM cascade by reusing
  `InferenceRouter.sanitize_context()` (`mira-bots/shared/inference/router.py`).
  This is already default-on (see `.claude/rules/security-boundaries.md`)
  but explicitly re-asserted here because `/api/v1/ask` is a new entry
  point.
- No PII stored beyond what the customer explicitly POSTs. Audit log stores
  IP + UA — disclosed in TOS, purged at 90 days.

### 9.4 API key hygiene
- Argon2id hashing, server-side only. Key never logged in plaintext.
- Display once on creation; UI shows masked thereafter.
- All key actions audited (`api_v1_audit_log` with `path = /me/api-keys/*`).
- Webhook to customer-configured URL on key creation/revocation (v2).

### 9.5 Rate limiting
- Token bucket per (tenant_id, endpoint_class). Stored in Redis (we already
  run one for Celery). Fail-open if Redis is down (log + counter).
- 429 with `Retry-After` header.

### 9.6 SOC 2 readiness notes
Not in scope for v1, but to ease the enterprise sale we should ensure:
- All audit events written to immutable log (append-only partition, no
  UPDATE/DELETE grants).
- Encryption at rest: Neon default + S3 SSE for uploads.
- Encryption in transit: HTTPS-only, HSTS, TLS 1.2+.
- Access reviews: quarterly export of `public_api_keys` per tenant.
- Backup/restore: Neon PITR (already on), upload bucket versioning.
- Incident response runbook: `wiki/runbooks/api-v1-incident.md` to be
  written before GA.
- Vendor list: maintain in `docs/security/subprocessors.md`.

---

## 10. i3X Compatibility

The emerging **i3X** standard (Industrial Information Interoperability
eXchange — see `docs/specs/ignition-exchange-spec.md` for the related
Ignition piece) models the world as Objects with ElementIds, hierarchical
namespaces, and VQT (Value/Quality/Timestamp) values.

We don't *adopt* i3X in v1 (the spec is still moving), but every response
shape includes a forward-compatible `i3x` envelope so we can flip the switch
later without breaking clients:

| FactoryLM concept | i3X mapping |
|---|---|
| Asset | Object (type=Asset, ElementId=asset.id) |
| Component | Object with `HasComponent` relationship to parent Asset |
| Tag path (`factorylm/site/area/asset/signal`) | Namespace + Element path |
| Tag value | Value with VQT triple |
| Work order | Object (type=WorkOrder) with `RelatesTo` Asset |
| Fault event | Object (type=Event) with VQT-style timestamp + severity |

Implementation: a single helper `toI3xEnvelope(row, kind)` in
`mira-hub/src/lib/i3x.ts` that every public route handler calls before
serialization. Zero per-endpoint logic.

---

## 11. Implementation Priority

| Phase | Scope | Endpoints | Tables | Trigger |
|---|---|---|---|---|
| **P0 — Before expo** | Core ingest + Ask | `/assets` (full), `/documents` (full), `/work-orders` (full), `/knowledge` + `/knowledge/search`, `/ask`, `/me`, `/me/api-keys`, `/usage` | `public_api_keys`, `api_v1_audit_log` | Expo demo readiness |
| **P0 — Sandbox** | Trial flow | `/start/playground` UI + `openapi.json` + sandbox provisioning | (uses P0 tables) | Expo demo readiness |
| **P1 — Post-expo** | Telemetry + lifecycle | `/components`, `/tags` (+ history), `/events`, `/pm-schedules` | `uns_tag_values` (+ `cmms_components` if needed) | After expo conversion data |
| **P2 — Q3** | Ecosystem | Full MCP server at mcp.factorylm.com, `/connectors` marketplace, Swagger playground polish, webhooks (outbound) | (none new) | Enterprise pipeline |

### P0 scoping notes
- "Mirrors existing route" endpoints are mostly a thin auth wrapper + shape
  translation — should be 1-2 days each.
- `/ask` is the only endpoint with real new latency-sensitive logic; budget
  3 days for streaming + source-attribution polish.
- Playground UI is the biggest unknown — reuse Swagger UI npm package and
  the existing Hub design system; budget 5 days end-to-end.

### P0 estimate (one engineer)
~3 weeks. Sandbox provisioning + key auth + 5 endpoints + Ask + playground.

### P1 estimate
~2 weeks. Telemetry-table partitioning is the only non-trivial bit.

---

## 12. Open Questions

1. **Do we mint a real sub-tenant per sandbox, or share a "demo" tenant
   with row-level partitioning by signup_id?** Spec assumes real sub-tenant
   (cleaner RLS), but storage cost matters at scale.
2. **Stripe metering**: do we charge per `ask` call on Pro tier, or flat
   monthly? Tier table shows daily limits, not pricing.
3. **OpenAPI generation**: hand-write `openapi.json` or generate from a
   schema-first tool (Zod → openapi)? Recommend Zod given Hub is already TS.
4. **MCP server hosting**: same Next.js process or a separate FastAPI like
   the existing `mira-mcp`? Recommend separate — keeps the public MCP
   surface decoupled from the internal one and lets us scale them
   independently.
5. **Sandbox seed data**: who owns curation? Suggest `tools/seed_sandbox.ts`
   committed to repo + reviewed quarterly.
6. **Audit log retention for SOC 2**: 90d for free tiers, 1y for Pro, 7y
   for Enterprise? Worth confirming with prospective enterprise customers
   before locking in.

---

## 13. Acceptance Criteria

Spec is considered complete when:
- [ ] Mike + one external system integrator can read this doc and `curl`
      every P0 endpoint without asking a follow-up question.
- [ ] Every endpoint has a documented request shape, response shape, error
      cases, and rate-limit headers.
- [ ] Sandbox flow is described step-by-step with explicit decision points.
- [ ] Security section addresses tenancy, file handling, PII, keys, and
      rate-limiting with concrete table/code references.
- [ ] Forward-compat envelope for i3X is specified, not hand-waved.
- [ ] Implementation can begin without any further design decisions on P0.

Implementation acceptance (separate doc when P0 lands):
- [ ] All P0 endpoints have integration tests against a real Neon branch.
- [ ] Sandbox provisioning runs in ≤ 5 s p95.
- [ ] `POST /api/v1/ask` p95 latency < 3 s on cached corpus.
- [ ] Playground walkthrough completes in ≤ 5 minutes for a fresh user
      (timed with 3 outside testers).
- [ ] Zero raw `pool.query` calls in `/api/v1/*` route handlers
      (ast-grep check passes).
