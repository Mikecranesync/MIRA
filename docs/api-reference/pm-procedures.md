# PM Procedures API

PM Procedures are the scheduled preventive maintenance templates MIRA executes against assets. Unlike Factory AI's flat PM model, MIRA PMs carry **first-class safety requirements** — LOTO, arc-flash, confined-space, and custom plant-specific controls — that must be individually acknowledged before a spawned work order can transition to `in_progress`. Trigger modes include calendar schedules, meter-based thresholds, and condition-based rules fired by live tag data from Ignition or the MIRA relay.

**Mirrors f7i.ai endpoint:** `/pms` + our additions `/pms/{id}/createworkorder` and safety-requirement acknowledgement.

---

## Data model

```ts
type SafetyRequirement = {
  id: string;
  type: "loto" | "arc_flash" | "confined_space" | "hot_work" | "working_at_height" | "custom";
  label: string;              // e.g. "De-energize and lock MCC-3A before opening panel"
  permitRequired: boolean;
  acknowledgedAt?: string;    // ISO 8601 — set when the spawned WO technician acknowledges
  acknowledgedBy?: string;    // userId
};

type PMTask = {
  id: string;
  order: number;
  description: string;        // e.g. "Inspect drive belt for cracking and tension"
  estimatedMinutes?: number;
  requiredParts?: string[];   // part ids
};

type PMProcedure = {
  id: string;                             // uuid
  tenantId: string;                       // scoped
  assetId: string;                        // ISA-95 asset the PM is bound to
  title: string;
  description?: string;
  triggerMode: "calendar" | "meter" | "condition";
  intervalDays?: number;                  // calendar: repeat every N days
  meterThreshold?: number;               // meter: trigger at N units (hours, cycles, km)
  meterUnit?: string;                    // e.g. "operating_hours", "cycles"
  conditionTag?: string;                 // condition: Ignition/UNS tag path, e.g. "enterprise.site.area.line.cv_101.vibration_rms"
  conditionOperator?: "gt" | "lt" | "gte" | "lte";
  conditionValue?: number;
  tasks: PMTask[];
  safetyRequirements: SafetyRequirement[];
  estimatedDurationMin: number;
  assignedTo?: string;                   // userId or team id
  lastCompletedAt?: string;              // ISO 8601
  nextDueAt?: string;                    // ISO 8601 — computed from trigger mode
  status: "active" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
};
```

---

## Endpoints

### List PMs

```http
GET /api/v1/pms
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `assetId` | string | Filter by asset. |
| `status` | string | `active`, `paused`, `archived` — comma-separated ok. |
| `triggerMode` | string | `calendar`, `meter`, `condition`. |
| `due` | bool | When true, returns only PMs whose `nextDueAt` ≤ now (overdue + due today). |
| `dueBefore` | string | ISO 8601 date — PMs due before this date. |
| `dueAfter` | string | ISO 8601 date — PMs due after this date. |
| `search` | string | Full-text over title/description. |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination cursor. |

Response:

```json
{
  "items": [
    {
      "id": "pm_01JA...",
      "assetId": "asset_01HQ...",
      "title": "Monthly Belt & Bearing Inspection — CV-101",
      "triggerMode": "calendar",
      "intervalDays": 30,
      "estimatedDurationMin": 45,
      "lastCompletedAt": "2026-05-15T08:22:00Z",
      "nextDueAt": "2026-06-15T00:00:00Z",
      "status": "active",
      "safetyRequirements": [
        { "id": "sr_01...", "type": "loto", "label": "Lock MCC-3A, tag out at VFD isolator", "permitRequired": false }
      ]
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

### Get one

```http
GET /api/v1/pms/{id}
```

Returns the full `PMProcedure` object including all tasks and safety requirements.

### Create

```http
POST /api/v1/pms
```

Body:

```json
{
  "assetId": "asset_01HQ...",
  "title": "Monthly Belt & Bearing Inspection — CV-101",
  "triggerMode": "calendar",
  "intervalDays": 30,
  "estimatedDurationMin": 45,
  "tasks": [
    { "order": 1, "description": "Visually inspect drive belt for cracking, glazing, and fraying", "estimatedMinutes": 5 },
    { "order": 2, "description": "Check belt tension with tension gauge — target 40–45 lbf", "estimatedMinutes": 5 },
    { "order": 3, "description": "Inspect drive-end and non-drive-end bearings for unusual heat or noise", "estimatedMinutes": 10 },
    { "order": 4, "description": "Lubricate bearings per OEM spec (2 pumps Mobilux EP2)", "estimatedMinutes": 10 },
    { "order": 5, "description": "Record nameplate readings and sign off", "estimatedMinutes": 5 }
  ],
  "safetyRequirements": [
    { "type": "loto", "label": "Lock MCC-3A, tag out at VFD isolator before opening guard", "permitRequired": false },
    { "type": "arc_flash", "label": "PPE Cat 2 required if panel open while energised", "permitRequired": false }
  ]
}
```

Required: `assetId`, `title`, `triggerMode`, `estimatedDurationMin`. For `calendar`: `intervalDays`. For `meter`: `meterThreshold` + `meterUnit`. For `condition`: `conditionTag`, `conditionOperator`, `conditionValue`.

### Update

```http
PUT /api/v1/pms/{id}
```

Partial updates accepted. Fields: `title`, `description`, `intervalDays`, `meterThreshold`, `conditionValue`, `tasks`, `safetyRequirements`, `estimatedDurationMin`, `assignedTo`, `status`.

Updating `tasks` or `safetyRequirements` replaces the full array — send the complete list.

### Delete

```http
DELETE /api/v1/pms/{id}
```

Soft-archives the PM (sets `status: "archived"`). Active work orders previously spawned from this PM are unaffected. Pass `?hard=true` to permanently delete (irreversible; requires admin scope).

### Spawn a work order

```http
POST /api/v1/pms/{id}/createworkorder
```

Instantiates a work order from this PM template. The spawned WO inherits all tasks and safety requirements; safety requirements must be individually acknowledged (via `POST /workorders/{woId}/safety/{reqId}/acknowledge`) before the WO may transition to `in_progress`.

Body (all optional):

```json
{
  "assignedTo": "user_01JB...",
  "scheduledStart": "2026-06-16T07:00:00Z",
  "priority": "high",
  "notes": "Overdue — complete before shift end"
}
```

Response `201`:

```json
{
  "workOrderId": "wo_01JC...",
  "pmId": "pm_01JA...",
  "status": "open",
  "safetyRequirements": [
    { "id": "sr_01...", "type": "loto", "label": "Lock MCC-3A, tag out at VFD isolator", "permitRequired": false, "acknowledgedAt": null }
  ],
  "message": "Work order created. 1 safety requirement must be acknowledged before work can begin."
}
```

See [Work Orders API](./work-orders.md) for the full WO lifecycle and the safety acknowledgement endpoint.

---

## Examples

### curl — list overdue PMs for an asset

```bash
curl "https://acme.factorylm.com/api/v1/pms" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -G \
  --data-urlencode "assetId=asset_01HQ..." \
  --data-urlencode "due=true"
```

### curl — spawn a work order from a PM

```bash
curl -X POST "https://acme.factorylm.com/api/v1/pms/pm_01JA.../createworkorder" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "assignedTo": "user_01JB...", "priority": "high" }'
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

// Fetch all calendar PMs due this week
const dueSoon = await mira.pms.list({
  triggerMode: "calendar",
  dueBefore: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  status: "active",
});

for (const pm of dueSoon.items) {
  // Spawn a work order for each
  const wo = await mira.pms.createWorkOrder(pm.id, { priority: "medium" });
  console.log(`Spawned ${wo.workOrderId} for PM: ${pm.title}`);
}
```

### Python

```python
from mira import Mira
from datetime import datetime, timedelta

mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

# List condition-based PMs on a critical asset
pms = mira.pms.list(asset_id="asset_01HQ...", trigger_mode="condition", status="active")

for pm in pms:
    print(f"{pm.title} — condition: {pm.condition_tag} {pm.condition_operator} {pm.condition_value}")

# Spawn a work order
wo = mira.pms.create_work_order("pm_01JA...", assigned_to="user_01JB...")
print(f"WO {wo.work_order_id} created — {len(pm.safety_requirements)} safety req(s) to acknowledge")
```

---

## Webhooks emitted

- `pm.created` — new PM procedure created
- `pm.updated` — any field changed (title, schedule, tasks, safety requirements)
- `pm.due` — `nextDueAt` crossed; fired at midnight UTC on the due date
- `pm.overdue` — PM not completed within `intervalDays` of `lastCompletedAt` (calendar mode only)
- `pm.completed` — linked work order transitions to `completed`; PM's `lastCompletedAt` and `nextDueAt` updated
- `pm.workorder_spawned` — work order created from this PM via `createworkorder`

See [Webhooks API](./webhooks.md) to subscribe. Wire `pm.due` to your on-call rotation to ensure PMs never slip.
