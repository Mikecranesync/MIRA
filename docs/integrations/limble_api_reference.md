# Limble CMMS API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

## Auth Method

**Type:** HTTP Basic Authentication using Client ID + Client Secret

Every API request must include:
```
Authorization: Basic <base64(clientId:clientSecret)>
Content-Type: application/json
```

**To generate credentials:**
1. Log into Limble → Settings → Configuration → API Keys (Super User access required)
2. Click "Add" → assign a name (permanent — cannot be changed after creation)
3. Copy both `ClientID` and `Client Secret` immediately — the secret is only shown once
4. If secret is lost: use "Refresh Client ID/Secret" (invalidates old credentials)

**Regional Base URLs** (use the one matching your customer's account):

| Region | Base URL |
|--------|----------|
| Default (US) | `https://api.limblecmms.com` |
| Canada | `https://ca-api.limblecmms.com` |
| Australia | `https://au-api.limblecmms.com` |
| Europe | `https://eu-api.limblecmms.com` |
| 21 CFR (pharma) | `https://21cfr-api.limblecmms.com` |

API version: v2. Full docs at `https://apidocs.limblecmms.com/`.

## Key Endpoints We Need

| Endpoint | Method | What it does | Required params |
|----------|--------|--------------|-----------------|
| `/tasks` | GET | List tasks (WOs, PMs, WRs) | `Authorization` header; optional: `taskType`, `assetID`, `locationID`, `taskID` |
| `/tasks` | POST | Create a work order/task | `Authorization`, task body |
| `/tasks/{id}` | GET | Get single task | `Authorization`, path `id` |
| `/tasks/{id}` | PATCH | Update task (status, fields) | `Authorization`, body fields |
| `/tasks/{id}` | DELETE | Delete task | `Authorization` |
| `/assets` | GET | List assets with hierarchy, meters | `Authorization` |
| `/assets/{id}` | GET | Get single asset | `Authorization` |
| `/pm-schedules` | GET | List PM schedules + next due dates | `Authorization` |
| `/locations` | GET | List locations | `Authorization` |
| `/parts` | GET | List parts + current quantities | `Authorization` |
| `/parts` | POST | Create part | `Authorization`, part body |
| `/users` | GET | List users | `Authorization` |
| `/vendors` | GET | List vendors | `Authorization` |
| `/purchase-orders` | GET | List purchase orders | `Authorization` |
| `/webhooks` | GET | List registered webhooks | `Authorization` |
| `/webhooks` | POST | Register webhook | `Authorization`, webhook config |

**Task type filter values for GET `/tasks`:**
- `wo` — Work Orders
- `pm` — Planned Maintenance
- `wr` — Work Requests
- `pwo` — Planned Work Orders

**Task create body fields (confirmed available, exact schema in Swagger at apidocs.limblecmms.com):**
- `title` / task name
- `assetID` — target asset
- `locationID` — location
- `taskType` — `wo`, `pm`, `wr`, `pwo`
- `priority` — Limble uses configurable priority levels (verified: customizable per account in Settings → Task Priority Levels)
- `status` — configurable per account (Settings → Task Status Configuration)
- `assignees` — user/team assignments
- `dueDate` / scheduled date

**Resources also accessible via API:** Roles, Teams, General Ledgers, Budgets, Tags, Statuses, Bills, Regions, Units of Measure (UOM).

## Webhook / Event Capabilities

Limble API v2 includes a `/webhooks` resource (confirmed in API resource list). Webhooks provide asynchronous delivery for events including:
- PM generation
- Work order status changes

**Registration:** POST to `/webhooks` with endpoint URL and event type configuration.

**Payload format:** JSON. Specific event schema not publicly documented in accessible sources — intercept a test delivery to capture the live format.

**Note:** The Make.com integration confirms "watch task changes" is available as an event trigger, meaning the webhook system supports at minimum task create/update/delete events.

## Rate Limits

Not publicly documented. Limble describes their system as "tuned for enterprise throughput while honoring customer entitlements and usage controls" — specific numbers are not published.

**Practical guidance:**
- Implement standard exponential backoff on HTTP 429 responses
- Do not parallelize more than 5–10 concurrent requests
- Limble is REST over HTTPS with no documented per-second or per-minute cap in public docs — test against your tenant and observe

## SDK Availability

- **Official SDK:** None. No official Python or Node.js client published by Limble.
- **Official Postman workspace:** `https://www.postman.com/limbleapiqa/limble-solutions-llc-s-public-workspace/documentation/zskh2o7/limble-api-v2` — use this to explore and test the full v2 API interactively.
- **Integration platforms:** Make.com (`apps.make.com/limble-cmms`), Zapier — pre-built connectors with 16 actions (create/update/delete tasks, instructions, parts; list assets, teams, users).
- **Unified API wrapper:** Makini (`makini.io/integrations/limble`) — commercial normalized layer across CMMS providers.
- **MCP server:** Limble has published a Limble MCP (Model Context Protocol) server — see `help.limblecmms.com/en/articles/12902567-limble-mcp-user-setup-guide`. Could be useful for MIRA's LLM-driven maintenance queries.

## Implementation Notes for MIRA

**MIRA WorkOrder → Limble field mapping:**

| MIRA field | Limble field | Notes |
|-----------|--------------|-------|
| `title` | `title` (task name) | |
| `asset_id` | `assetID` | Integer |
| `location_id` | `locationID` | Integer |
| `priority` | `priority` | Account-specific values — must fetch priority list first |
| `status` | `status` | Account-specific values — must fetch status list first |
| `type` | `taskType` | Map MIRA `work_order` → `wo`, `pm` → `pm` |
| `assigned_to` | `assignees` | |
| `due_date` | `dueDate` | Confirm date format in Swagger (ISO 8601 expected) |

**MIRA Asset → Limble field mapping:**

| MIRA field | Limble field | Notes |
|-----------|--------------|-------|
| `asset_id` | `id` (from GET response) | |
| `name` | asset name field | |
| `location` | `locationID` | |
| Meters/readings | `meters` | Limble assets include meter data in GET response |

**API quirks to handle:**
- **Account-specific priority and status values** — Limble allows full customization of both. Before creating tasks, always GET `/priorities` and `/statuses` (or the equivalent resource in v2) to map MIRA's standard values to the customer's configured IDs. Do not assume numeric 1/2/3 priorities.
- **Regional endpoint routing** — MIRA must determine the customer's region during connection setup (ask or detect from their Limble account URL) and store the correct base URL per tenant. Using the wrong regional URL returns auth errors.
- **Super User requirement for API keys** — customers must grant MIRA a Super User-level credential. Document this clearly in the MIRA connection setup flow.
- **Secret is one-time visible** — MIRA must capture and store the Client Secret in Doppler at connection setup time; there is no way to retrieve it later from Limble.
- **Pagination** — Limble uses consistent resource schemas with pagination across modules. Specific params (offset/limit vs cursor) confirmed as present but the exact parameter names must be verified in the Swagger UI at `apidocs.limblecmms.com`.
- **Tasks are the unified type** — Limble does not have separate "work order" and "PM" endpoints; everything is a `/tasks` resource filtered by `taskType`. Map accordingly.
- **Error format:** Standard HTTP status codes + JSON error body. Specific schema in Swagger.
- **Limble MCP server** — if MIRA ever needs to expose Limble data to an LLM agent directly, the Limble MCP is the fastest path.

## Links

- Official Swagger/API docs: `https://apidocs.limblecmms.com/`
- Official Postman workspace: `https://www.postman.com/limbleapiqa/limble-solutions-llc-s-public-workspace/documentation/zskh2o7/limble-api-v2`
- API key management guide: `https://help.limblecmms.com/en/articles/11932574-managing-api-keys-in-limble`
- Limble MCP setup: `https://help.limblecmms.com/en/articles/12902567-limble-mcp-user-setup-guide`
- Make.com integration docs: `https://apps.make.com/limble-cmms`
- Task status configuration: `https://help.limblecmms.com/en/articles/2993175-task-status-configuration`
- Task priority configuration: `https://help.limblecmms.com/en/articles/8672978-task-priority-levels`
