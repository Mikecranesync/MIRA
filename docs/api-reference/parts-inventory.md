# Parts, Inventory & Purchase Orders API

Parts and inventory management in MIRA goes beyond simple stock counts. Every stocked item carries an **ABC class** (value-based: A = top 20 % of spend, B = next 30 %, C = bottom 50 %) and an **XYZ class** (demand predictability: X = steady usage, Y = seasonal/variable, Z = sporadic). Combined, these classes drive reorder logic, storage strategy, and approval thresholds — without manual policy configuration.

Purchase orders use **dollar-threshold approval hierarchies**: POs under a configurable threshold are auto-approved; larger orders route to a supervisor queue; above a second threshold they require executive sign-off. Thresholds are set per-tenant via the Customer Settings resource (see [`openapi.yaml`](./openapi.yaml), tag `Customer Settings`).

**Mirrors f7i.ai endpoints:** `/parts`, `/inventory`, `/purchase-orders` + MIRA additions: ABC/XYZ classification, multi-vendor pricing, inventory adjust, and PO approval/receive actions.

---

## Data models

```ts
type Vendor = {
  vendorId:   string;    // uuid — references the Vendors resource
  name:       string;
  partNumber: string;    // vendor's own part number
  unitCost:   number;    // USD
  leadTimeDays: number;
  preferred:  boolean;
};

type Part = {
  id:           string;  // uuid
  tenantId:     string;
  partNumber:   string;  // customer-facing SKU, unique per tenant
  name:         string;
  description?: string;
  manufacturer: string;
  vendors:      Vendor[];          // ≥1 required; first preferred=true is primary
  unitCost:     number;            // USD — mirrors preferred vendor price; read-only
  uom:          string;            // unit of measure: "ea", "ft", "L", "kg", ...
  category?:    string;            // free-text e.g. "bearings", "belts", "lubricants"
  assetIds?:    string[];          // assets this part is used on (for BOM queries)
  createdAt:    string;
  updatedAt:    string;
};

type InventoryItem = {
  partId:        string;
  part:          Part;             // embedded on list responses
  onHand:        number;
  onOrder:       number;           // committed across open PO lines, not yet received
  reorderPoint:  number;
  reorderQty:    number;           // economic order quantity suggestion
  abcClass:      "A" | "B" | "C";
  xyzClass:      "X" | "Y" | "Z";
  location:      string;           // bin/aisle e.g. "W1-A3-B2"
  lastCounted:   string | null;    // ISO 8601 — last physical count
  updatedAt:     string;
};

type POLine = {
  lineNumber:  number;
  partId:      string;
  partNumber:  string;             // denormalized for readability
  description: string;
  qty:         number;
  unitCost:    number;
  totalUsd:    number;             // qty × unitCost
};

type POApproval = {
  approverId:  string;             // user uuid
  approverName: string;
  level:       "supervisor" | "executive";
  decision:    "approved" | "rejected";
  note?:       string;
  decidedAt:   string;
};

type PurchaseOrder = {
  id:         string;              // uuid
  tenantId:   string;
  poNumber:   string;              // auto-generated: PO-YYYY-NNNN
  vendorId:   string;
  vendorName: string;              // denormalized
  lines:      POLine[];
  totalUsd:   number;              // sum of line totals
  status:     "draft" | "pending_approval" | "approved" | "received";
  approvals:  POApproval[];
  notes?:     string;
  expectedDelivery?: string;       // ISO 8601 date
  receivedAt?: string;
  createdBy:  string;              // user uuid
  createdAt:  string;
  updatedAt:  string;
};
```

---

## Endpoints

### List parts

```http
GET /api/v1/parts
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `search` | string | Full-text over partNumber, name, description. |
| `manufacturer` | string | Filter by manufacturer name. |
| `category` | string | Filter by category. |
| `assetId` | string | Parts used on a specific asset (BOM filter). |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination. |

Response:

```json
{
  "items": [
    {
      "id": "part_01HN...",
      "partNumber": "BRG-6205-2RS",
      "name": "Deep Groove Ball Bearing 6205-2RS",
      "manufacturer": "SKF",
      "vendors": [
        { "vendorId": "vnd_01...", "name": "Motion Industries", "partNumber": "02-6205-2RS", "unitCost": 4.87, "leadTimeDays": 2, "preferred": true },
        { "vendorId": "vnd_02...", "name": "Grainger", "partNumber": "6X899", "unitCost": 5.42, "leadTimeDays": 1, "preferred": false }
      ],
      "unitCost": 4.87,
      "uom": "ea",
      "category": "bearings",
      "createdAt": "2026-01-10T08:00:00Z",
      "updatedAt": "2026-06-01T14:22:00Z"
    }
  ],
  "nextCursor": null
}
```

### Create part

```http
POST /api/v1/parts
```

Body:

```json
{
  "partNumber": "BRG-6205-2RS",
  "name": "Deep Groove Ball Bearing 6205-2RS",
  "manufacturer": "SKF",
  "uom": "ea",
  "category": "bearings",
  "vendors": [
    { "vendorId": "vnd_01...", "partNumber": "02-6205-2RS", "unitCost": 4.87, "leadTimeDays": 2, "preferred": true }
  ]
}
```

Required: `partNumber`, `name`, `manufacturer`, `uom`, `vendors` (at least one with `preferred: true`).

### Get part

```http
GET /api/v1/parts/{id}
```

### Update part

```http
PUT /api/v1/parts/{id}
```

Partial updates accepted. To add a vendor, include the full `vendors` array with the new entry appended. Setting a vendor's `preferred: true` automatically clears `preferred` on all other vendors for that part.

### Delete part

```http
DELETE /api/v1/parts/{id}
```

Returns `409 Conflict` if the part has open PO lines or non-zero `onHand` inventory. Pass `?force=true` to override (creates a deactivation tombstone rather than hard-deleting).

---

### List inventory (stock levels)

```http
GET /api/v1/inventory
```

Returns one `InventoryItem` per part stocked by this tenant, with ABC/XYZ classification embedded.

Query parameters:

| Name | Type | Description |
|---|---|---|
| `abcClass` | string | `A`, `B`, `C`, or comma-separated e.g. `A,B`. |
| `xyzClass` | string | `X`, `Y`, `Z`, or comma-separated. |
| `lowStock` | bool | When `true`, returns only items where `onHand ≤ reorderPoint`. |
| `location` | string | Filter by bin/aisle prefix (e.g. `W1-A3`). |
| `partId` | string | Single part lookup (returns one item). |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination. |

Response:

```json
{
  "items": [
    {
      "partId": "part_01HN...",
      "part": { "partNumber": "BRG-6205-2RS", "name": "Deep Groove Ball Bearing 6205-2RS", "uom": "ea" },
      "onHand": 3,
      "onOrder": 10,
      "reorderPoint": 5,
      "reorderQty": 24,
      "abcClass": "A",
      "xyzClass": "X",
      "location": "W1-A3-B2",
      "lastCounted": "2026-05-15T07:00:00Z",
      "updatedAt": "2026-06-14T09:11:00Z"
    }
  ],
  "nextCursor": null
}
```

`abcClass: "A"` means this part is in the top 20 % of annual spend — inspect it more often and keep tighter safety stock. `xyzClass: "X"` means demand is predictable — safe to order in fixed intervals. An `"A"` + `"Z"` combination (high-value, sporadic demand) flags a candidate for consignment or just-in-time sourcing.

### Adjust inventory

```http
POST /api/v1/inventory/adjust
```

Record a manual count correction, usage draw, or receipt outside of a PO. All adjustments are logged with actor and reason for audit.

Body:

```json
{
  "partId": "part_01HN...",
  "delta": -2,
  "reason": "consumed",
  "note": "Replaced drive-end bearing on MOTOR-001 — WO-2026-1142",
  "workOrderId": "wo_01HQ..."
}
```

`reason` enum: `consumed`, `count_correction`, `damaged`, `returned`, `transferred`.

`delta` is signed: negative = stock drawn, positive = stock added. Returns the updated `InventoryItem`.

---

### List purchase orders

```http
GET /api/v1/purchase-orders
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `status` | string | `draft`, `pending_approval`, `approved`, `received` — comma-separated ok. |
| `vendorId` | string | Filter by vendor. |
| `from` | string | ISO 8601 — `createdAt ≥ from`. |
| `to` | string | ISO 8601 — `createdAt ≤ to`. |
| `limit` | int | Default 50, max 200. |
| `cursor` | string | Pagination. |

### Create purchase order

```http
POST /api/v1/purchase-orders
```

Body:

```json
{
  "vendorId": "vnd_01...",
  "lines": [
    { "partId": "part_01HN...", "qty": 24, "unitCost": 4.87 },
    { "partId": "part_02HN...", "qty": 6,  "unitCost": 18.50 }
  ],
  "expectedDelivery": "2026-06-20",
  "notes": "Urgent — bearing stock critically low"
}
```

Required: `vendorId`, `lines` (at least one with `partId`, `qty`, `unitCost`).

On creation MIRA evaluates `totalUsd` against the tenant's approval thresholds (configured in Customer Settings):

| `totalUsd` | Resulting status |
|---|---|
| Below `auto_approve_threshold` (default $500) | `approved` immediately |
| Between thresholds | `pending_approval` — routes to supervisor queue |
| Above `executive_threshold` (default $5,000) | `pending_approval` — routes to executive queue |

### Get purchase order

```http
GET /api/v1/purchase-orders/{id}
```

### Update purchase order

```http
PUT /api/v1/purchase-orders/{id}
```

Partial updates accepted on `draft` and `pending_approval` POs only. Updating `lines` on a `pending_approval` PO resets approvals and re-evaluates thresholds. `approved` and `received` POs are immutable — file a new PO if a change order is needed.

### Approve purchase order

```http
POST /api/v1/purchase-orders/{id}/approve
```

Records an approval decision for the calling user. Only users with the `po:approve` permission (assigned via role; see the `Auth` tag in [`openapi.yaml`](./openapi.yaml)) may call this endpoint.

Body:

```json
{
  "decision": "approved",
  "note": "Approved — critical stock item"
}
```

`decision` enum: `approved` | `rejected`. A `rejected` decision moves the PO back to `draft`. Once all required approvals are recorded, status advances to `approved` automatically.

### Receive purchase order

```http
POST /api/v1/purchase-orders/{id}/receive
```

Marks the PO as received and increments `onHand` for each line's part. Partial receipts are supported via the `lines` array.

Body:

```json
{
  "lines": [
    { "partId": "part_01HN...", "qtyReceived": 24 },
    { "partId": "part_02HN...", "qtyReceived": 4 }
  ],
  "receivedAt": "2026-06-20T14:00:00Z",
  "note": "2 units of part_02HN... back-ordered, separate shipment expected"
}
```

If `qtyReceived` is less than the ordered qty for any line, the PO status becomes `received` (partial) and the remaining quantity remains `onOrder` until a second receive call closes it out.

---

## Examples

### curl

```bash
# List A-class low-stock items
curl "https://acme.factorylm.com/api/v1/inventory?abcClass=A&lowStock=true" \
  -H "Authorization: Bearer $MIRA_KEY"

# Create a purchase order
curl -X POST "https://acme.factorylm.com/api/v1/purchase-orders" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vendorId": "vnd_01...",
    "lines": [{ "partId": "part_01HN...", "qty": 24, "unitCost": 4.87 }]
  }'

# Approve a pending PO
curl -X POST "https://acme.factorylm.com/api/v1/purchase-orders/po_01HQ.../approve" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "approved", "note": "Approved — critical bearing stock" }'
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

// Find all A-class parts below reorder point
const lowStock = await mira.inventory.list({ abcClass: "A", lowStock: true });

for (const item of lowStock.items) {
  console.log(
    `${item.part.partNumber} — on hand: ${item.onHand}, reorder at: ${item.reorderPoint}`
  );

  // Auto-raise a PO to the preferred vendor
  const po = await mira.purchaseOrders.create({
    vendorId: item.part.vendors.find((v) => v.preferred)!.vendorId,
    lines: [{ partId: item.partId, qty: item.reorderQty, unitCost: item.part.unitCost }],
  });
  console.log(`Created ${po.poNumber} — status: ${po.status}`);
}
```

### Python

```python
import os
from mira import Mira

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

# Adjust inventory after a repair
mira.inventory.adjust(
    part_id="part_01HN...",
    delta=-2,
    reason="consumed",
    note="Replaced bearing on MOTOR-001 — WO-2026-1142",
    work_order_id="wo_01HQ...",
)

# Receive a PO
mira.purchase_orders.receive(
    "po_01HQ...",
    lines=[{"part_id": "part_01HN...", "qty_received": 24}],
)
```

---

## Webhooks emitted

- `part.low_stock` — fired when `onHand` drops to or below `reorderPoint` after an inventory adjust or PO receive. Payload includes `abcClass` and `xyzClass` so downstream automation can prioritize A-class items.
- `purchase_order.created` — fired on every PO creation, regardless of initial status.
- `purchase_order.approved` — fired when all required approvals are recorded and status transitions to `approved`.
- `purchase_order.received` — fired when a PO is fully or partially received; payload includes per-line `qtyReceived`.

See [Webhooks API](./webhooks.md) to subscribe.
