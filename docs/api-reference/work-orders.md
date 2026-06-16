# Work Orders API

A Work Order (WO) is a scoped unit of maintenance work against an asset. MIRA's WO model mirrors Factory AI's 7-state lifecycle and sub-resources (tasks, parts, notes, media) and adds a **required safety-checklist gate** before any WO can move to `in_progress`.

**Mirrors f7i.ai endpoint:** `/work-orders` — full parity plus safety-gate.

---

## Lifecycle

```
Requested → Approved → Scheduled → In Progress → Waiting → Completed → Closed
     ↓         ↓          ↓              ↓
   (reject)  (hold)    (cancel)      (escalate)
```

Illegal transitions return `409 conflict` with `{"error": {"code": "invalid_transition"}}`.

---

## Data model

```ts
type WorkOrder = {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  assetId: string;
  parentWorkOrderId?: string;     // for follow-up WOs
  pmId?: string;                  // if spawned from a PM procedure
  type: "corrective" | "preventive" | "emergency" | "project";
  priority: "low" | "medium" | "high" | "critical";
  status: "requested" | "approved" | "scheduled" | "in_progress"
        | "waiting" | "completed" | "closed";
  requestedBy: string;            // user id
  assignedTo?: string | null;     // user id or team id
  department?: "maintenance" | "facilities" | "external";
  failureCodeId?: string;
  requiredSkills?: string[];
  safetyRequirements?: SafetyReq[];  // LOTO, PPE, confined space, etc.
  scheduledDate?: string;            // ISO 8601
  estimatedDuration?: number;        // minutes
  actualDuration?: number;
  completionDate?: string;
  progress?: number;                 // 0..100
  createdAt: string;
  updatedAt: string;
};

type SafetyReq = {
  id: string;
  kind: "loto" | "ppe" | "confined_space" | "hot_work" | "electrical" | "arc_flash" | "custom";
  label: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
};
```

---

## Endpoints

### List

```http
GET /api/v1/workorders
```

Query params: `limit`, `cursor`, `search`, `status`, `priority`, `type`, `assetId`, `assignedTo`, `createdAfter`, `createdBefore`, `department`.

### Get

```http
GET /api/v1/workorders/{id}
```

### Create

```http
POST /api/v1/workorders
```

```json
{
  "title": "Bearing replacement — drive motor",
  "description": "Elevated vibration on 1X + BPFO peak. Replace drive-end bearing.",
  "assetId": "asset_01HR...",
  "type": "corrective",
  "priority": "high",
  "assignedTo": "user_01HT...",
  "failureCodeId": "fc_bearing_defect",
  "scheduledDate": "2026-04-29T14:00:00Z",
  "estimatedDuration": 180,
  "safetyRequirements": [
    { "kind": "loto", "label": "LOTO — MCC panel 3A breaker" },
    { "kind": "ppe",  "label": "Arc-flash PPE cat 2" }
  ],
  "tasks": [
    { "description": "Isolate + verify zero energy",       "estimatedTime": 20 },
    { "description": "Remove coupling + bearing housing",  "estimatedTime": 60 },
    { "description": "Install new bearing, torque to spec","estimatedTime": 60 },
    { "description": "Reassemble + commission + verify",    "estimatedTime": 40 }
  ],
  "requiredParts": [
    { "partId": "part_brg_6310", "quantity": 1 }
  ]
}
```

### Update

```http
PUT /api/v1/workorders/{id}
```

Body fields: `status`, `priority`, `assignedTo`, `scheduledDate`, `completionDate`, `actualDuration`, `progress`, `notes`.

### Transition

State changes go through `PUT /workorders/{id}` with `status`. The server enforces:

- `requested → approved` — approver role required
- `scheduled → in_progress` — **all safety requirements must be acknowledged** (`422` with `code=safety_not_acknowledged` otherwise)
- `in_progress → completed` — all tasks done AND at least one "after" photo uploaded
- `completed → closed` — supervisor sign-off

### Delete

```http
DELETE /api/v1/workorders/{id}
```

Only allowed in `requested` or `approved` state.

---

## Sub-resources

### Tasks

```http
GET    /api/v1/workorders/{id}/tasks
POST   /api/v1/workorders/{id}/tasks      { description, estimatedTime, order, assignedTo }
PUT    /api/v1/workorders/{id}/tasks/{taskId}   { status, actualTime, notes }
DELETE /api/v1/workorders/{id}/tasks/{taskId}
```

### Parts

```http
GET    /api/v1/workorders/{id}/parts
POST   /api/v1/workorders/{id}/parts      { partId, quantity, unitCost }
PUT    /api/v1/workorders/{id}/parts/{partId}   { quantity, status, actualCost }
DELETE /api/v1/workorders/{id}/parts/{partId}
```

Creating a part entry **reserves** inventory immediately. Reservation converts to consumption on WO completion.

### Notes

```http
GET  /api/v1/workorders/{id}/notes
POST /api/v1/workorders/{id}/notes    { text }
```

### Media

```http
GET    /api/v1/workorders/{id}/media
POST   /api/v1/workorders/{id}/media/presigned-url   { filename, contentType, size }
POST   /api/v1/workorders/{id}/media                 { mediaId, kind: "before"|"after"|"other", caption? }
DELETE /api/v1/workorders/{id}/media/{mediaId}
```

Use the presigned URL pattern for direct S3 uploads; post metadata after successful upload.

### Safety acknowledgements

```http
POST /api/v1/workorders/{id}/safety/{reqId}/acknowledge
```

Marks one safety requirement acknowledged by the current user. Required before moving to `in_progress`.

---

## Webhooks emitted

- `workorder.created`
- `workorder.assigned` — `assignedTo` changed
- `workorder.status_changed` — includes `{from, to}`
- `workorder.completed`
- `workorder.overdue` — scheduledDate passed with status != completed|closed
- `workorder.safety_acknowledged`

See [Webhooks API](./webhooks.md).

---

## Differences from Factory AI

| Feature | Factory AI | MIRA |
|---|---|---|
| 7-state lifecycle | ✓ | ✓ |
| Sub-resources (tasks/parts/notes/media) | ✓ | ✓ |
| Presigned S3 upload | ✓ | ✓ |
| **Safety-gate enforcement in state machine** | ✗ (T&Cs disclaimer) | ✓ (hard stop) |
| **Webhooks out to Slack/Teams/PagerDuty** | ✗ | ✓ |
| **ISO 14224 failure code link** | ✗ (proprietary) | ✓ |
| Mobile offline edit + sync | ✓ (native) | ✓ (PWA) |
| BYO-LLM work-order summary | ✗ | ✓ |
