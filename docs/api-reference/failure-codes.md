# Failure Codes API

Failure codes are MIRA's ISO 14224-aligned taxonomy of what goes wrong with industrial equipment. Factory AI's failure tagging is proprietary and flat; MIRA ships a structured, hierarchical catalog seeded from the ISO 14224 standard. Every failure event recorded against a [work order](./work-orders.md) references a code from this catalog, enabling cross-plant MTBF benchmarking and reliability analytics out of the box.

**Why ISO 14224 matters.** ISO 14224 is the international standard for reliability and maintenance data for the oil, gas, and process industries — and increasingly adopted across discrete manufacturing. Structuring failure events to this taxonomy means:
- MTBF calculations are segmented by *failure mechanism*, not free-text tag, so trends survive technician turnover.
- Cross-plant benchmarking becomes possible without a data-normalisation project.
- Reliability analytics (Weibull analysis, failure-mode Pareto) are pre-wired to your maintenance history the moment you go live.

The catalog ships seeded with the full ISO 14224 standard set. Tenants can extend it with custom codes; custom codes carry a `source: "tenant"` flag and are excluded from cross-tenant benchmarks.

---

## Data model

```ts
type FailureCode = {
  id: string;                      // uuid
  tenantId: string;                // scoped; "iso14224" for the seeded standard set
  code: string;                    // short identifier, unique per tenant e.g. "FM-EL-001"
  description: string;             // human-readable label
  isoCategory:
    | "failureMechanism"           // root cause type: corrosion, fatigue, wear, …
    | "failureMode"                // observable behaviour: leak, vibration, overheating, …
    | "failureCause";              // contributing factor: design, operation, maintenance
  equipmentClass?: string;         // ISO 14224 equipment class e.g. "centrifugal_pump", "motor"
  severity: "low" | "medium" | "high" | "critical";
  parentId?: string | null;        // null = top-level taxonomy node; enables hierarchy
  source: "iso14224" | "tenant";   // seeded standard vs tenant-defined extension
  createdAt: string;               // ISO 8601
  updatedAt: string;
};
```

### Hierarchy

The `parentId` self-reference models the ISO 14224 three-level tree:

```
Failure Mechanism (FM-EL)        ← isoCategory: failureMechanism, parentId: null
  └── Failure Mode (FM-EL-001)   ← isoCategory: failureMode, parentId: FM-EL
        └── Failure Cause (...)   ← isoCategory: failureCause, parentId: FM-EL-001
```

Use `?flat=false` (default) to receive the tree pre-nested in the response. Use `?flat=true` for a flat array suitable for populating a select list.

---

## Endpoints

### List failure codes

```http
GET /api/v1/failure-codes
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `equipmentClass` | string | Filter to codes relevant for a class e.g. `centrifugal_pump`. |
| `isoCategory` | string | `failureMechanism`, `failureMode`, or `failureCause`. |
| `source` | string | `iso14224` to view the seeded set only; `tenant` for extensions. |
| `search` | string | Full-text over code + description. |
| `flat` | bool | Default false. When true, returns a flat array (no children nested). |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Cursor pagination. |

Response (tree form, `flat=false`):

```json
{
  "items": [
    {
      "id": "fc_01HN...",
      "code": "FM-EL",
      "description": "Electrical failure mechanisms",
      "isoCategory": "failureMechanism",
      "equipmentClass": null,
      "severity": "medium",
      "parentId": null,
      "source": "iso14224",
      "children": [
        {
          "id": "fc_01HP...",
          "code": "FM-EL-001",
          "description": "Insulation breakdown",
          "isoCategory": "failureMode",
          "equipmentClass": "motor",
          "severity": "high",
          "parentId": "fc_01HN...",
          "source": "iso14224",
          "children": []
        }
      ],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "nextCursor": null
}
```

### Get one

```http
GET /api/v1/failure-codes/{id}
```

Returns a single `FailureCode` object. `children` is omitted; use the list endpoint with `?flat=false` for the subtree.

### Create (tenant extension)

```http
POST /api/v1/failure-codes
```

Body:

```json
{
  "code": "FM-MECH-CUSTOM-01",
  "description": "Premature seal wear — high-particulate process fluid",
  "isoCategory": "failureCause",
  "equipmentClass": "centrifugal_pump",
  "severity": "high",
  "parentId": "fc_01HQ..."
}
```

Required: `code`, `description`, `isoCategory`, `severity`. `source` is always set to `"tenant"` for created codes — the seeded ISO 14224 set is read-only.

Returns `201` with the created `FailureCode`.

### Update

```http
PUT /api/v1/failure-codes/{id}
```

Partial updates accepted. Fields: `description`, `equipmentClass`, `severity`, `parentId`. `code` and `isoCategory` are immutable after creation. Standard-set codes (`source: "iso14224"`) cannot be updated — returns `403 forbidden`.

### Delete

```http
DELETE /api/v1/failure-codes/{id}
```

Standard-set codes cannot be deleted — returns `403 forbidden`. Tenant-defined codes that are currently referenced by open work orders return `409 conflict`; close or re-code those work orders first.

Returns `204` on success.

---

## Attaching failure codes to work orders

A failure code is applied to a work order via the work order's `failureCodeId` field (see [Work Orders API](./work-orders.md)). One code per work order. The code is required before a work order can be moved to `resolved` status — this enforces a closed feedback loop where every resolution contributes to the failure-mode history for that asset.

```json
PUT /api/v1/workorders/{id}
{
  "failureCodeId": "fc_01HP...",
  "status": "resolved"
}
```

When `failureCodeId` is set, MIRA automatically:
- Increments the failure-mode count for the asset.
- Recalculates MTBF for the `(asset, failureCode)` pair.
- Emits `failure_code.applied` (see Webhooks below).

---

## Examples

### curl — list motor failure modes

```bash
curl "https://acme.factorylm.com/api/v1/failure-codes" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -G \
  --data-urlencode "equipmentClass=motor" \
  --data-urlencode "isoCategory=failureMode"
```

### curl — create a tenant extension code

```bash
curl -X POST "https://acme.factorylm.com/api/v1/failure-codes" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "FM-VIB-CUSTOM-01",
    "description": "High-frequency bearing noise — suspected lubrication starvation",
    "isoCategory": "failureCause",
    "equipmentClass": "motor",
    "severity": "high",
    "parentId": "fc_01HQ..."
  }'
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

// Browse the seeded ISO 14224 taxonomy for centrifugal pumps
const codes = await mira.failureCodes.list({
  equipmentClass: "centrifugal_pump",
  source: "iso14224",
});

for (const code of codes.items) {
  console.log(code.code, code.isoCategory, code.description);
}

// Resolve a work order with a failure code
await mira.workOrders.update("wo_01HN...", {
  failureCodeId: codes.items[0].id,
  status: "resolved",
});
```

### Python

```python
from mira import Mira
import os

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

# List all failure mechanisms for motors
codes = mira.failure_codes.list(
    equipment_class="motor",
    iso_category="failureMechanism",
)
for code in codes.items:
    print(code.code, code.description)

# Attach a failure code when resolving a work order
mira.work_orders.update(
    "wo_01HN...",
    failure_code_id=codes.items[0].id,
    status="resolved",
)
```

---

## Webhooks emitted

- `failure_code.created` — a tenant-defined code was added to the catalog.
- `failure_code.applied` — a failure code was attached to a work order (fires on `PUT /workorders/{id}` when `failureCodeId` is set).

See [Webhooks API](./webhooks.md) to subscribe. Common recipe: wire `failure_code.applied` to a reliability dashboard to keep MTBF displays live without polling.
