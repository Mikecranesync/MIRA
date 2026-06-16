# UpKeep API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

## Auth Method

**Type:** Session Token (login-first flow — NOT a static API key)

**Auth flow:**
1. POST credentials to auth endpoint → receive `sessionToken` + `expiresAt`
2. Include token in every subsequent request header: `Session-Token: <sessionToken>`
3. DELETE `/auth` to logout / invalidate token

```
POST https://api.onupkeep.com/api/v2/auth
Body: { "email": "...", "password": "..." }
Response: { "sessionToken": "r:ee091a894626a62d9dc09073884d91ba", "expiresAt": "..." }
```

All subsequent requests:
```
Session-Token: <sessionToken>
Content-Type: application/json
upkeep-version: 2022-09-14   # optional but recommended to pin version
```

To obtain credentials: UpKeep account → Settings → integrations, or use any account user's email/password. Note: the **API is Enterprise plan only**.

**Base URL:** `https://api.onupkeep.com/api/v2/`

There is also a legacy v1 base (`https://api.onupkeep.com/api/public/`) — still documented but v2 is preferred.

## Key Endpoints We Need

| Endpoint | Method | What it does | Required params |
|----------|--------|--------------|-----------------|
| `/auth` | POST | Login, get session token | `email`, `password` |
| `/auth` | DELETE | Logout / invalidate token | `Session-Token` header |
| `/work-orders` | POST | Create work order | `Session-Token`, `title` |
| `/work-orders` | GET | List all work orders | `Session-Token`; optional: `offset`, `limit`, `status` filter |
| `/work-orders/<ID>` | GET | Get single work order | `Session-Token`, path `ID` |
| `/work-orders/<ID>` | PATCH | Update work order | `Session-Token`, body fields |
| `/work-orders/<ID>` | DELETE | Delete work order | `Session-Token` |
| `/work-orders/<ID>/workers/<userID>` | POST | Assign worker to WO | `Session-Token` |
| `/work-orders/<ID>/teams/<teamID>` | POST | Assign team to WO | `Session-Token` |
| `/assets` | POST | Create asset | `Session-Token`, `name` |
| `/assets` | GET | List all assets | `Session-Token`; optional: `offset`, `limit` |
| `/assets/<ID>` | GET | Get single asset | `Session-Token` |
| `/assets/<ID>` | PATCH | Update asset | `Session-Token`, body fields |
| `/assets/<ID>` | DELETE | Delete asset | `Session-Token` |
| `/assets/downtime` | POST | Record downtime event (bulk) | `Session-Token`, downtime data |
| `/preventive-maintenance` | POST/GET/PATCH/DELETE | CRUD PM triggers | `Session-Token` |
| `/files` | POST | Upload file attachment | `Session-Token`, multipart/form-data |
| `/webhooks` | POST | Register webhook | `Session-Token`, URL, events |
| `/webhooks` | GET | List registered webhooks | `Session-Token` |
| `/webhooks/<ID>` | PATCH | Update webhook | `Session-Token` |
| `/webhooks/<ID>` | DELETE | Delete webhook | `Session-Token` |

**Work order create body fields:**
```json
{
  "title": "string (required)",
  "additionalInfo": "string",
  "priority": 0,
  "dueDate": 1714300800000,
  "assetId": "string",
  "locationId": "string",
  "userAssignedId": "string"
}
```

**Priority values:** `0` = None (default), `1` = Low, `2` = Medium, `3` = High

**Status values:** `open`, `complete`, `onHold`, `inProgress`

**Work order response fields:** `id`, `status`, `title`, `description`, `dueDate`, `endDueDate`, `dateCompleted`, `completedBy`, `completedById`, `createdAt`, `workOrderNo`, `category`, `time`, `cost`, `assignedBy`, `assignedById`, `assignedTo`, `assignedToId`, `asset`, `assetId`, `location`, `locationId`, `team`, `teamId`, `requestedBy`, `requestedById`, `formItems`

**Asset response fields:** `id`, `location` (object: `id`, `name`, `address`, `longitude`, `latitude`), `name`, `model`, `barcodeSerial`, `parentAssetId`, `description`, `isActive`, `additionalInformation`

## Webhook / Event Capabilities

**Plan gate:** Enterprise only.

**Setup:** Settings → Webhooks → "+ Add Webhook" → provide title, endpoint URL, and select event triggers.

**Known event types:**
- `Reactive Work Order Created` — fires when a new reactive work order is submitted
- Work order closure events (e.g., triggers cost sync to QuickBooks integration)

**Registration via API:** Full CRUD at `/webhooks` endpoint (POST to register, GET to list, PATCH to update, DELETE to remove).

**Payload format:** JSON. Specific schema not publicly documented — intercept via a test endpoint to capture live payloads.

**Alternative to polling:** Webhooks are the recommended approach for real-time integration; the REST API does not offer server-sent events or GraphQL subscriptions.

## Rate Limits

- **HTTP 429** returned when throttled; no published per-plan request/minute numbers in public docs.
- Use `offset` + `limit` query params for pagination; no cursor style.
- Recommended: implement exponential backoff on 429 responses.
- The `upkeep-version` header pins API behavior to a dated version — avoids surprises on breaking changes.

**API versioning model:** Breaking changes create new dated versions (current: `2022-09-14`). Non-breaking additions (new fields, optional params) are added in-place without version bump.

## SDK Availability

- **Official SDK:** None published by UpKeep.
- **No official Python or Node.js library** found in npm or PyPI.
- **Integration platforms:** Pipedream, Zapier, Make.com — pre-built connectors.
- **UpKeep Studio** (`run.upkeep.com`) — a low-code app platform built on UpKeep data; not an API client library.
- Community REST wrappers exist but are unmaintained; prefer direct httpx calls for MIRA.

## Implementation Notes for MIRA

**MIRA WorkOrder → UpKeep field mapping:**

| MIRA field | UpKeep field | Notes |
|-----------|--------------|-------|
| `title` | `title` | Required |
| `description` | `additionalInfo` | Different field name |
| `priority` | `priority` | 0–3 integer, not string enum |
| `due_date` | `dueDate` | Unix milliseconds (not seconds, not ISO 8601) |
| `asset_id` | `assetId` | String ID |
| `location_id` | `locationId` | String ID |
| `assigned_to` | `userAssignedId` | Single user only on create; use `/workers/<id>` POST to add more |
| `status` | call `/work-orders/<ID>` PATCH | PATCH the status field directly |

**MIRA Asset → UpKeep field mapping:**

| MIRA field | UpKeep field | Notes |
|-----------|--------------|-------|
| `name` | `name` | |
| `serial_number` | `barcodeSerial` | |
| `description` | `description` | |
| `parent_asset` | `parentAssetId` | Hierarchical assets supported |
| `location` | `locationId` | |
| `active` | `isActive` | Boolean |

**API quirks to handle:**
- **Session token expiry** — tokens are short-lived. MIRA must re-authenticate when a 401 is returned mid-session. Store `expiresAt` and proactively refresh before expiry.
- **Date format is Unix milliseconds** — `dueDate` takes integer milliseconds since epoch, not ISO 8601 strings. Convert with `int(datetime.timestamp() * 1000)`.
- **Status update** — there is no dedicated status-change endpoint in v2; PATCH the work order with `{ "status": "inProgress" }`.
- **v1 legacy endpoints** use POST for list operations (e.g., `POST /api/public/workorders` to list) — avoid v1 for new integrations.
- **Work order status filter** — the list endpoint only supports filtering by `status` field (not by asset, date range, etc.). For filtered queries by asset, fetch all and filter client-side.
- **Expandable responses** — use `includes` query param (array or comma-separated) to embed related objects (e.g., `includes=asset,location`) and avoid N+1 fetches.
- **Enterprise gate** — if a customer is not on Enterprise, API calls return 401/403. Surface this clearly in MIRA's connection setup UI.
- **Error format:** `{ "message": "field cannot be null" }` with appropriate HTTP status code.

## Links

- Official developer reference: `https://developers.onupkeep.com/`
- Legacy/community-maintained docs: `https://upkeepinfo.github.io/upkeep/`
- REST API product page: `https://upkeep.com/integrations/rest-api/`
- Help center — API & webhooks collection: `https://help.onupkeep.com/en/collections/1791249-using-upkeep-s-apis-and-webhooks`
- API tracker profile: `https://apitracker.io/a/onupkeep`
