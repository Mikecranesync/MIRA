# MaintainX API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

## Auth Method

**Type:** Bearer Token (API Key)

All requests require:
```
Authorization: Bearer <api_key>
Content-Type: application/json
Accept: application/json
```

To obtain credentials: MaintainX account → Settings → Integrations → New Key → Generate Key. API keys are plan-gated (Business and above). Contact `api@getmaintainx.com` for access questions.

**Base URL:** `https://api.getmaintainx.com/v1`

## Key Endpoints We Need

| Endpoint | Method | What it does | Required params |
|----------|--------|--------------|-----------------|
| `/workorders` | GET | List work orders (cursor-paginated) | `Authorization` header; optional: `cursor`, `limit` (max 100) |
| `/workorders` | POST | Create work order | `title` (string) |
| `/workorders/{id}` | GET | Get single work order | path: `id` |
| `/workorders/{id}` | PATCH | Update work order | path: `id`, body fields to change |
| `/assets` | GET | List all assets | `Authorization` header |
| `/assets/{id}` | GET | Get single asset | path: `id` |
| `/locations` | GET | List locations | `Authorization` header |
| `/users` | GET | List users | `Authorization` header |
| `/parts` | GET | List parts | `Authorization` header |
| `/procedures` | GET | List procedures/checklists | `Authorization` header |
| `/workrequests` | POST | Create work request | `title` (string) |

**Work order create body fields:**
```json
{
  "title": "string (required)",
  "description": "string",
  "assetId": "integer",
  "locationId": "integer",
  "priority": "NONE | LOW | MEDIUM | HIGH",
  "status": "OPEN | IN_PROGRESS | ON_HOLD | COMPLETED | CLOSED",
  "dueDate": "ISO 8601 datetime",
  "assignees": [{"id": "integer", "type": "string"}],
  "categories": ["string"],
  "estimatedTime": "integer (seconds)",
  "procedure": {"id": "integer", "title": "string", "fields": []},
  "partsRequired": [],
  "notifyAssignees": "boolean"
}
```

**Work order status values:** `OPEN`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CLOSED`

**Work order response includes:** `id`, `title`, `description`, `status`, `priority`, `dueDate`, `assetId`, `locationId`, `assignees`, `categories`, `createdAt`, `updatedAt`, `workOrderNo`, `procedure`

## Webhook / Event Capabilities

MaintainX supports webhooks via a dedicated API endpoint (confirmed via Zapier and Make integrations, details in official docs at `api.getmaintainx.com/v1/docs`). Events include new work orders, work order completions, and work order category changes. Configuration via the API or the MaintainX UI (Settings → Integrations → Webhooks).

Rate limit headers `x-ratelimit-remaining` and `Retry-After` are returned in responses; honor them when processing webhook bursts.

**Note:** Webhook payload schema not publicly documented — verify via the Swagger UI at `https://api.getmaintainx.com/v1/docs` after authenticating.

## Rate Limits

- **10 requests per second** observed limit (inferred from Claude Code community skill implementation)
- **Max 5 concurrent requests** recommended
- **Max page size:** 100 items per cursor page
- **429 response** → read `Retry-After` header, apply exponential backoff (`baseDelay * 2^attempt + jitter`)
- Headers: `x-ratelimit-remaining` tracks remaining quota in current window

## SDK Availability

- **Official SDK:** None. MaintainX publishes no official Python or Node.js SDK.
- **Community ETL library (Python):** `https://github.com/pradeep-somasundaram/MaintainX` — extracts work orders, assets, locations, users, teams; handles cursor pagination and retries. Not a general-purpose client.
- **Integration platform connectors:** Pipedream, Make (Integromat), Zapier, Ibexa Connect — pre-built actions for common operations.

## Implementation Notes for MIRA

**MIRA WorkOrder → MaintainX field mapping:**

| MIRA field | MaintainX field | Notes |
|-----------|-----------------|-------|
| `title` | `title` | Required |
| `description` | `description` | |
| `asset_id` | `assetId` | integer |
| `location_id` | `locationId` | integer |
| `priority` | `priority` | Map `LOW/MED/HIGH` to `LOW/MEDIUM/HIGH`; MIRA has no "NONE" |
| `status` | `status` | MIRA uses `open/in_progress/closed`; map accordingly |
| `due_date` | `dueDate` | ISO 8601 |
| `assigned_to` | `assignees[].id` | Requires pre-fetching user IDs |

**MIRA Asset → MaintainX field mapping:**

| MIRA field | MaintainX field | Notes |
|-----------|-----------------|-------|
| `asset_id` | `id` | Read-only on MaintainX side |
| `name` | `name` | |
| `location` | `locationId` | |

**API quirks to handle:**
- **Cursor pagination only** — no page-number style. Store `nextCursor` from each response; loop until `null`.
- **Rate limit is per-second not per-minute** — unlike most APIs. Throttle aggressively with a request queue.
- **API keys are account-scoped** — one key per MaintainX account; no per-tenant keys for SaaS multi-tenancy. Design the MIRA connector to store one key per connected MaintainX account.
- **Procedures (checklists) are separate resources** — you must GET `/procedures` to find the right `id` before embedding in a work order.
- **Error format:** HTTP status code + JSON `{ "message": "..." }`. No structured error codes documented.
- **Official docs are behind a Redoc/Swagger UI** — interactive but not easily scraped. Use `https://api.getmaintainx.com/v1/docs#tag/Getting-Started` for live schema exploration.

## Links

- Official REST API docs (Swagger/Redoc): `https://api.getmaintainx.com/v1/docs`
- Getting started tag: `https://api.getmaintainx.com/v1/docs#tag/Getting-Started`
- Help center (redirects): `https://help.getmaintainx.com/` (most deep links redirect to root)
- Ibexa Connect integration docs: `https://doc.ibexa.co/projects/connect/en/latest/apps/maintainx/`
- Make.com integration docs: `https://apps.make.com/maintainx`
- Community rate-limit skill reference: `https://eliteai.tools/agent-skills/maintainx-rate-limits`
- Community Python ETL: `https://github.com/pradeep-somasundaram/MaintainX`
- API key management UI: `https://app.getmaintainx.com/settings/apikeys`
