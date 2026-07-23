# API Changelog

This page records every notable change to the MIRA REST API (`/api/v1`).

## Changelog policy

**Additive changes are non-breaking and ship continuously under `/api/v1`.**
They appear in this log but require no client changes. **Breaking changes only
ship at a new major version** (`/api/v2`, `/api/v3`, …); old major versions are
supported for at least 12 months after a new major is released.

When a field or endpoint is deprecated, it is announced here with a sunset date.
The affected endpoint will also return a `Sunset` HTTP response header carrying
the RFC 8594 date string, and a `Link: <...>; rel="successor-version"` header
pointing to the replacement, until the field or endpoint is removed.

---

## Versioning & compatibility

### Breaking changes (require a new major version)

- Removing an endpoint or HTTP method
- Removing a response field
- Changing the type of an existing field (e.g. `string` → `integer`)
- Adding a **required** request parameter to an existing endpoint
- Changing an HTTP status code that clients are expected to branch on
- Narrowing an existing enum (removing a value clients may receive)

### Non-breaking changes (ship under current major)

- Adding a new endpoint or HTTP method
- Adding a new **optional** response field
- Adding a new **optional** request parameter with a documented default
- Adding a new enum value — **clients must tolerate unknown enum values**
- Adding a new webhook event type — **clients must tolerate unknown event types**
- Increasing a rate-limit tier
- Changing error message text (the `code` field is stable; `message` is not)

---

## 2026-05-28 — Idempotency keys

`POST` endpoints that create resources (`/assets`, `/workorders`,
`/purchase-orders`, `/external-events`, `/webhooks`, `/documents`) now honor an
optional `Idempotency-Key` request header. Replaying the same key within 24 hours
returns the original response without creating a duplicate. This is a
non-breaking additive header; clients that omit the header see no change in
behavior.

## 2026-05-21 — Knowledge Graph & UNS namespace endpoints (beta)

New tag: **Knowledge Graph**. Added under `/api/v1`:

- `GET /kg/entities` — list knowledge-graph entities scoped to the tenant's
  asset namespace (Unified Namespace ltree paths, ISO 14224 failure codes, and
  component relationships).
- `GET /kg/entities/{id}` — retrieve a single entity with its evidence sources.
- `GET /kg/relationships` — list relationships between entities with confidence
  bands and approval state (`proposed`, `verified`, `rejected`).
- `POST /kg/proposals` — submit an AI-generated entity or relationship proposal
  for human review. Accepted by the API but held in `proposed` state; promotion
  to `verified` requires an admin action through the Hub or
  `PUT /kg/proposals/{id}/decide`.
- `PUT /kg/proposals/{id}/decide` — approve or reject a proposal (`decision`:
  `approve` | `reject`).

UNS namespace read:

- `GET /uns/resolve` — resolve a free-text equipment description or partial UNS
  path string to a canonical `enterprise.*` ltree path, with a confidence band
  (`confirmed` | `high` | `medium` | `low`). Non-mutating; safe for client
  pre-flight checks.

These endpoints are in **public beta**. The schema may receive additive fields
before GA; no breaking changes within v1.

## 2026-05-14 — Public Ingest API + MCP tools surface (beta)

New tag: **Ingest**. Enables programmatic document ingestion without the Hub UI:

- `POST /ingest/documents` — upload a PDF, image, or plain-text file. Returns a
  job `id`; processing is asynchronous. Chunked extraction runs via the MIRA
  ingest pipeline and lands in the tenant knowledge base searchable by Chat.
  Payload: `multipart/form-data` with `file`, `assetId` (optional), and
  `languageHint` (optional BCP-47 tag).
- `GET /ingest/jobs/{id}` — poll job status (`queued` | `processing` | `done` |
  `failed`). When `done`, the response includes `chunkCount` and the
  `documentId` created.
- `DELETE /ingest/documents/{id}` — remove a previously ingested document and
  its chunks from the knowledge base.

MCP tools surface (read-only, separate auth scope `mcp:read`):

- `GET /mcp/tools` — enumerate the MCP tool definitions available to BYO-LLM
  chat integrations (equipment lookup, work-order history, sensor report, failure
  code search). Intended for LLM tool-calling preambles; the list is stable
  within v1.

Both surfaces are in **public beta**.

## 2026-05-07 — Cursor pagination GA

Cursor-based pagination (`cursor` / `nextCursor`) promoted from beta to **GA**
on all list endpoints. The response envelope shape (`items`, `count`,
`nextCursor`) is now stable and covered by the v1 compatibility guarantee.

Offset-based pagination (`page` / `pageSize` query parameters) was never
documented and is removed as of this date. If you relied on undocumented
offset parameters, migrate to `cursor`.

## 2026-04-24 — v1.0.0 public launch

Initial public release of the MIRA REST API. The following resource groups are
available at `/api/v1`:

| Tag | Key capabilities |
|---|---|
| **Assets** | Site → area → asset → component hierarchy; QR code generation; `?flat` tree traversal |
| **Work Orders** | 7-state lifecycle; safety-requirement acknowledgement gate before `in_progress` |
| **PM Procedures** | Preventive maintenance with first-class safety prerequisites; `createworkorder` action |
| **Maintenance Strategies** | 7 strategy types (CBM, TBM, RTF, …) with MTBF / availability / cost fields |
| **Failure Codes** | ISO 14224-aligned taxonomy — industry-standard, not proprietary |
| **Parts & Inventory** | ABC/XYZ classification, multi-vendor sourcing, stock-level reads |
| **Purchase Orders** | Dollar-threshold approval hierarchies |
| **External Events** | Inbound SCADA / ERP / MES / weather event ingest |
| **Notifications** | In-app and push notification reads |
| **Webhooks** | Outbound push with HMAC-SHA256 signing; `/rotate-secret`, `/test`, `/deliveries` |
| **Sensors** | Time-bucketed series; FFT vibration analysis with 1X/2X/BPFO/BPFI/gear-mesh peak labels |
| **Chat** | Asset-scoped streaming chat (SSE); BYO-LLM model selection; manual, sensor, and history grounding |
| **Templates** | Open-source component template catalog; `POST /assets/from-template` instantiation |
| **Documents** | Manual and document store; indexed for Chat grounding |
| **Customer Settings** | Tenant-level configuration reads and writes |
| **Auth** | SAML 2.0 SP metadata + ACS; OIDC callback; SCIM 2.0 user provisioning |
| **Feedback** | In-product feedback submission |

All endpoints are URL-path versioned (`/api/v1/...`). The current API version is
also returned in the `X-Mira-Api-Version` response header on every response.

---

## Deprecations

**None.** No endpoints or fields are currently deprecated.

---

## Upcoming

The following changes are planned for upcoming releases. They will be additive
(non-breaking) and will appear in this log when shipped:

- **Sensor telemetry ingest** (`POST /sensors/{id}/readings`) — push time-series
  readings from edge collectors without going through External Events.
- **Knowledge Graph GA** — removal of the `beta` designation on KG and UNS
  endpoints once the schema is declared stable.
- **Bulk asset import** (`POST /assets/import`) — CSV / Excel upload for
  initial asset-registry population.
- **Audit log export** (`GET /audit-log`) — paginated, filterable export of the
  per-tenant API call audit trail.

Subscribe to the [MIRA developer newsletter](https://factorylm.com/developers)
or watch the [changelog RSS feed](https://docs.factorylm.com/api-reference/changelog.rss)
to be notified when these ship.
