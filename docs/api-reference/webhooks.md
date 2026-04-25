# Webhooks API

Factory AI does not have outbound webhooks. MIRA does. Configure once and every alert, work-order state change, or asset event is pushed to Slack, Microsoft Teams, PagerDuty, Jira, ServiceNow, or any HTTPS URL you control.

**Does not mirror f7i.ai** — this is net-new.

---

## Model

```ts
type Webhook = {
  id: string;
  tenantId: string;
  name: string;
  url: string;                       // https:// only; localhost allowed in dev tenant
  secret: string;                    // returned once at creation, never again
  eventTypes: EventType[];
  headers?: Record<string, string>;  // optional custom headers (e.g., auth for your system)
  active: boolean;
  lastDeliveryAt?: string;
  lastStatus?: number;               // HTTP status of last attempt
  failureCount: number;              // consecutive failures — auto-disable at 50
  createdAt: string;
  updatedAt: string;
};

type EventType =
  | "asset.created" | "asset.updated" | "asset.deleted"
  | "asset.criticality_changed" | "asset.status_changed"
  | "workorder.created" | "workorder.assigned"
  | "workorder.status_changed" | "workorder.completed" | "workorder.overdue"
  | "workorder.safety_acknowledged"
  | "alert.opened" | "alert.resolved" | "alert.escalated"
  | "pm.scheduled" | "pm.due_soon"
  | "po.approved" | "po.received"
  | "inventory.reorder_needed" | "inventory.stockout"
  | "sensor.threshold_breached" | "sensor.offline"
  | "security.api_key_rotated" | "security.login_failed_repeated";
```

---

## Endpoints

### List

```http
GET /api/v1/webhooks
```

### Create

```http
POST /api/v1/webhooks
```

```json
{
  "name": "Ops Slack — critical alerts",
  "url": "https://hooks.slack.com/services/T.../B.../xxx",
  "eventTypes": ["alert.opened", "workorder.overdue", "sensor.threshold_breached"]
}
```

Response includes the `secret` **once** (save it — you will need it to verify signatures, and MIRA will not show it again).

```json
{
  "id": "wh_01HV...",
  "secret": "whsec_abcd1234efgh5678...",
  "...": "..."
}
```

### Update

```http
PUT /api/v1/webhooks/{id}
```

### Delete

```http
DELETE /api/v1/webhooks/{id}
```

### Rotate secret

```http
POST /api/v1/webhooks/{id}/rotate-secret
```

Old secret invalidated; new one returned once.

### Test delivery

```http
POST /api/v1/webhooks/{id}/test
```

Dispatches a `{"type": "test.ping"}` event to the endpoint. Returns the response.

### Delivery log

```http
GET /api/v1/webhooks/{id}/deliveries
```

Returns last 100 delivery attempts with status, latency, response body (truncated), and retry count.

---

## Payload shape

All events share a stable envelope:

```json
{
  "id": "evt_01HW...",
  "type": "workorder.status_changed",
  "tenantId": "tenant_01HA...",
  "createdAt": "2026-04-24T20:30:00Z",
  "data": { /* event-specific */ },
  "apiVersion": "v1"
}
```

Example — `workorder.status_changed`:

```json
{
  "id": "evt_01HW...",
  "type": "workorder.status_changed",
  "tenantId": "tenant_01HA...",
  "createdAt": "2026-04-24T20:30:00Z",
  "apiVersion": "v1",
  "data": {
    "workOrderId": "wo_01HX...",
    "assetId": "asset_01HR...",
    "from": "scheduled",
    "to": "in_progress",
    "actorId": "user_01HT...",
    "at": "2026-04-24T20:30:00Z"
  }
}
```

---

## Signature verification

Every delivery includes:

```
X-Mira-Signature: t=1745524200,v1=abcd1234...
X-Mira-Event-Id: evt_01HW...
X-Mira-Event-Type: workorder.status_changed
```

`v1` = HMAC-SHA256 of `${timestamp}.${rawBody}` using your webhook secret.

### Node example

```js
import crypto from "node:crypto";

function verify(rawBody, sigHeader, secret) {
  const [tPart, vPart] = sigHeader.split(",");
  const t = tPart.replace("t=", "");
  const sig = vPart.replace("v1=", "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("bad signature");
  }
  // reject if timestamp older than 5 min to block replay
  if (Date.now() / 1000 - Number(t) > 300) throw new Error("stale");
}
```

### Python example

```python
import hmac, hashlib, time

def verify(raw: bytes, sig_header: str, secret: str):
    parts = dict(p.split("=", 1) for p in sig_header.split(","))
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(parts["v1"], expected):
        raise ValueError("bad signature")
    if time.time() - int(parts["t"]) > 300:
        raise ValueError("stale")
```

---

## Delivery guarantees

- **At-least-once.** Expect occasional duplicates; dedupe on `X-Mira-Event-Id`.
- **Ordering is not guaranteed** across event types. Within a resource (same `workOrderId`), events are delivered in order of creation.
- **Retries:** 3 attempts at 0 / 30s / 5m with jitter. After that, delivery is marked failed in the log; the event is **not** re-attempted.
- **Auto-disable** at 50 consecutive failures. Caller must re-enable via `PUT /webhooks/{id}` with `active: true`.
- **Timeout:** 10 seconds per attempt.
- **Payload size:** capped at 256 KB.

---

## Recipes

First-class integrations with prebuilt UI at `/hub/integrations/webhooks`:

| Target | Config needed | Notes |
|---|---|---|
| **Slack** | Incoming webhook URL | Rich message blocks with asset link |
| **Microsoft Teams** | Connector URL | Adaptive Card |
| **PagerDuty** | Integration Key (Events v2) | Auto-deduplicates on `asset.id` |
| **Jira** | Site URL + project key + auth | Creates issues on `alert.opened` |
| **ServiceNow** | Instance URL + auth | Creates incidents |
| **Generic** | Any HTTPS URL | Raw JSON payload |

---

## Comparison

| Factory AI `/notifications` | MIRA `/webhooks` |
|---|---|
| GET-only, poll model | Push model with retries |
| No signature verification | HMAC-SHA256 signed |
| No Slack/Teams/PD recipes | 5 first-class recipes + generic |
| No delivery log | Full log with latency + response |
| No secret rotation | Rotate without downtime |
