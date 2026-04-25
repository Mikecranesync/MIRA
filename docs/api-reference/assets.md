# Assets API

Assets are the physical equipment MIRA tracks. Unlike Factory AI's flat model, MIRA supports unbounded hierarchy: `Site → Area → Asset → Component` with `parent_id` self-references for arbitrarily deep component trees (motor → bearing → inner race).

**Mirrors f7i.ai endpoint:** `/assets` + our additions `/components` (tree), `/qr`, `/chat`, `/charts`.

---

## Data model

```ts
type Asset = {
  id: string;                     // uuid
  tenantId: string;               // scoped
  tag: string;                    // customer-facing equipment number, unique per site
  name: string;
  type?: string;                  // "motor", "pump", "plc", ...
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  parentId?: string | null;       // null = site-level root
  siteId?: string;                // denormalized for fast site queries
  areaId?: string;
  location?: string;              // free-text e.g. "Building A - Line 3"
  department?: string;
  criticality: "low" | "medium" | "high" | "critical";
  installDate?: string;           // ISO 8601
  specifications?: Record<string, string | number | boolean>;
  operationalStatus?: "running" | "idle" | "down" | "unknown";
  qrCodeUrl?: string;             // rendered on demand, not stored
  createdAt: string;
  updatedAt: string;
};
```

---

## Endpoints

### List assets

```http
GET /api/v1/assets
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `flat` | bool | Default false. When true, returns a flat array (no children nested). |
| `siteId` | string | Filter by site. |
| `parentId` | string | `null` for roots only, or a specific parent id. |
| `type` | string | Filter by type. |
| `criticality` | string | `low,medium,high,critical` — comma-separated ok. |
| `search` | string | Full-text over name/tag/model. |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination. |

Response (tree form):

```json
{
  "items": [
    {
      "id": "asset_01HN...", "tag": "SITE-A", "name": "North Plant",
      "children": [
        {
          "id": "asset_01HP...", "tag": "LINE-3", "name": "Assembly Line 3",
          "children": [
            {
              "id": "asset_01HQ...", "tag": "MOTOR-001", "name": "Drive Motor",
              "children": [
                { "id": "asset_01HR...", "tag": "BRG-001", "name": "Drive-end bearing", "children": [] }
              ]
            }
          ]
        }
      ]
    }
  ],
  "nextCursor": null
}
```

### Get one

```http
GET /api/v1/assets/{id}
```

### Create

```http
POST /api/v1/assets
```

Body:

```json
{
  "tag": "MOTOR-001",
  "name": "Drive Motor",
  "type": "motor",
  "manufacturer": "Baldor",
  "model": "CM3558T",
  "serialNumber": "4F1234",
  "parentId": "asset_01HP...",
  "criticality": "high",
  "specifications": { "voltage": 480, "hp": 5, "rpm": 1750 }
}
```

Required: `name`, `manufacturer`. `tag` auto-generated if omitted.

### Update

```http
PUT /api/v1/assets/{id}
```

Partial updates accepted. Fields: `name`, `status`, `lastMaintenanceDate`, `description`, `specifications`, `criticality`.

### Delete

```http
DELETE /api/v1/assets/{id}
```

Soft-delete by default (sets `deletedAt`). Returns 409 if the asset has child components — delete children first or use `?cascade=true`.

### Import (CSV)

```http
POST /api/v1/assets/import
Content-Type: multipart/form-data
```

CSV columns: `tag,name,type,manufacturer,model,serialNumber,parentTag,criticality,location`.

### List child components

```http
GET /api/v1/assets/{id}/components
```

Shortcut for `GET /api/v1/assets?parentId={id}&flat=1`.

### QR code

```http
GET /api/v1/assets/{id}/qr
Accept: image/png
```

Returns a PNG label encoding `https://{tenant}.factorylm.com/hub/assets/{id}?from=qr`. Pass `?size=512` for larger.

### Bulk QR export

```http
GET /api/v1/assets/qr.pdf?assetIds=a1,a2,a3
Accept: application/pdf
```

Returns a ready-to-print PDF sheet of labels (Avery 5160 by default; `?layout=avery-5163` for larger).

### Asset-scoped chat

See [Chat API](./chat.md). Summary:

```http
POST /api/v1/assets/{id}/chat
Content-Type: application/json

{ "messages": [...], "stream": true, "model": "claude-opus-4-7" }
```

Returns SSE stream if `stream=true`. BYO-LLM via `model` parameter (Claude / GPT / Gemini / Groq / Cerebras / ollama:*).

### Photos

Factory AI parity:

```http
GET  /api/v1/assets/{id}/photos
POST /api/v1/assets/{id}/photos/presigned-url   → { uploadUrl, mediaId }
POST /api/v1/assets/{id}/photos                  → attach uploaded photo metadata
DELETE /api/v1/assets/{id}/photos/{mediaId}
```

10MB per image limit. Accepted: jpeg, png, webp, heic.

### Charts

```http
GET /api/v1/assets/{id}/charts?window=7d&metric=vibration,temperature
```

Returns one series per attached sensor, bucketed. See [Sensors & FFT](./sensors.md) for details.

---

## Examples

### curl

```bash
curl https://acme.factorylm.com/api/v1/assets \
  -H "Authorization: Bearer $MIRA_KEY" \
  -G --data-urlencode "type=motor" --data-urlencode "criticality=high,critical"
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

const assets = await mira.assets.list({ type: "motor", criticality: ["high", "critical"] });
for (const asset of assets.items) console.log(asset.tag, asset.name);
```

### Python

```python
from mira import Mira
mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

for asset in mira.assets.list(type="motor", criticality=["high", "critical"]):
    print(asset.tag, asset.name)
```

---

## Webhooks emitted

- `asset.created` — new asset created
- `asset.updated` — any field changed
- `asset.deleted` — soft-deleted
- `asset.criticality_changed` — criticality changed (frequently wired to PagerDuty)
- `asset.status_changed` — operationalStatus changed

See [Webhooks API](./webhooks.md) to subscribe.
