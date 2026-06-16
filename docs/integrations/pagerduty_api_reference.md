# PagerDuty API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

PagerDuty provides two separate APIs: the **Events API v2** (for sending alert events from monitoring systems) and the **REST API v2** (for managing incidents, services, users, and webhooks). MIRA uses both — Events API to trigger safety alerts, REST API to list/acknowledge/resolve.

---

## Auth Method

### Events API v2
Uses an **Integration Key** (also called `routing_key`), not a user API key. Obtained from a PagerDuty service's Integrations tab when adding an "Events API v2" integration.

```
POST https://events.pagerduty.com/v2/enqueue
Content-Type: application/json

Body: { "routing_key": "<32-char integration key>", ... }
```

No `Authorization` header required — auth is embedded in the `routing_key` field.

### REST API v2
Two options:

| Method | Header | When to use |
|--------|--------|-------------|
| API Access Key | `Authorization: Token token=<key>` | Server-to-server (MIRA backend) |
| OAuth 2.0 Bearer | `Authorization: Bearer <access_token>` | User-delegated flows |

Additionally, all **write operations on incidents** (PUT) require:
```
From: <valid-pagerduty-user-email>
```
Set via `default_from` on the client or as a header on each request.

**Obtaining an API key:** PagerDuty → User Icon → My Profile → API Access → Create New API Key (read/write scope).

---

## Key Endpoints We Need

### Events API v2

| Endpoint | Method | What it does | Required fields |
|----------|--------|--------------|-----------------|
| `https://events.pagerduty.com/v2/enqueue` | POST | Trigger alert | `routing_key`, `event_action: "trigger"`, `payload.summary`, `payload.source`, `payload.severity` |
| `https://events.pagerduty.com/v2/enqueue` | POST | Acknowledge alert | `routing_key`, `event_action: "acknowledge"`, `dedup_key` |
| `https://events.pagerduty.com/v2/enqueue` | POST | Resolve alert | `routing_key`, `event_action: "resolve"`, `dedup_key` |

**Trigger payload structure:**
```json
{
  "routing_key": "<integration_key>",
  "event_action": "trigger",
  "dedup_key": "mira-asset-{asset_id}-{fault_type}",
  "payload": {
    "summary": "Arc flash risk detected on Motor Drive VFD-01",
    "source": "mira-diagnosis",
    "severity": "critical",
    "timestamp": "2026-04-28T14:30:00Z",
    "component": "VFD-01",
    "group": "Conveyor Line 3",
    "class": "electrical",
    "custom_details": {
      "asset_id": "VFD-01",
      "fault_code": "OC-001",
      "temperature_c": 87.4,
      "mira_session_id": "sess_abc123"
    }
  },
  "images": [],
  "links": [
    {
      "href": "https://mira.factorylm.com/incidents/abc123",
      "text": "View in MIRA"
    }
  ]
}
```

`severity` values: `critical` | `error` | `warning` | `info`

### REST API v2 — Base URL: `https://api.pagerduty.com`

| Endpoint | Method | What it does | Required fields / params |
|----------|--------|--------------|--------------------------|
| `/incidents` | GET | List incidents | `statuses[]`, `time_zone`, `limit` |
| `/incidents/{id}` | GET | Get single incident | — |
| `/incidents` | PUT | Bulk update incidents | `incidents[]` array with `id`, `type`, `status` |
| `/incidents/{id}` | PUT | Update single incident | `incident.type`, `incident.status`; `From` header |
| `/services` | GET | List services | — |
| `/webhook_subscriptions` | POST | Register v3 webhook | `delivery_method`, `events[]`, `filter` |

**List open incidents (Python):**
```python
import pagerduty
client = pagerduty.RestApiV2Client(API_KEY)
incidents = client.list_all('incidents',
    params={'statuses': ['triggered', 'acknowledged']})
```

**Acknowledge / Resolve via SDK:**
```python
# Resolve
client.rput(incident, json={
    'type': 'incident_reference',
    'status': 'resolved'
})
```

---

## Webhook / Event Capabilities

PagerDuty **v3 webhooks** push events to a MIRA endpoint when incident state changes.

**Register via REST API:**
```
POST https://api.pagerduty.com/webhook_subscriptions
Authorization: Token token=<key>
Content-Type: application/json

{
  "webhook_subscription": {
    "delivery_method": {
      "type": "http_delivery_method",
      "url": "https://mira.factorylm.com/webhooks/pagerduty",
      "custom_headers": [
        {"name": "X-MIRA-Secret", "value": "<secret>"}
      ]
    },
    "description": "MIRA incident state sync",
    "events": [
      "incident.triggered",
      "incident.acknowledged",
      "incident.resolved",
      "incident.escalated",
      "incident.priority_updated"
    ],
    "filter": {
      "type": "account_reference"
    },
    "type": "webhook_subscription"
  }
}
```

**Limit:** 10 subscriptions per unique service+team ID.

**Payload structure:**
```json
{
  "event": {
    "id": "evt_01ABC",
    "event_type": "incident.triggered",
    "resource_type": "incident",
    "occurred_at": "2026-04-28T14:30:01Z",
    "data": {
      "id": "Q1KFL24LR3",
      "title": "Arc flash risk detected",
      "status": "triggered",
      "urgency": "high",
      "service": { "id": "SVC001", "name": "MIRA Diagnosis" },
      "teams": [{ "id": "TEAM001" }]
    }
  }
}
```

**Signature verification:** PagerDuty sends `X-PagerDuty-Signature` header (HMAC-SHA256). Verify against the subscription secret.

---

## Rate Limits

REST API uses a **token-bucket** model. No fixed numbers are published; limits are adaptive.

| Signal | Detail |
|--------|--------|
| Exceeded response | HTTP 429 |
| `ratelimit-limit` header | Current bucket capacity |
| `ratelimit-remaining` header | Remaining calls |
| `ratelimit-reset` header | Seconds until reset |

**Best practice:** Check `ratelimit-remaining` before each batch; back off on 429 with `ratelimit-reset` delay.

Events API v2 has no published rate limit but is designed for high-volume monitoring traffic.

---

## SDK Availability

| SDK | Install | Notes |
|-----|---------|-------|
| `python-pagerduty` (official) | `pip install pagerduty` | Replaces deprecated `pdpyras`; supports REST + Events API v2 |
| `pdpyras` (deprecated) | `pip install pdpyras` | Still works but no new features |
| `go-pagerduty` | `go get github.com/PagerDuty/go-pagerduty` | Official Go client |
| Node.js | No official SDK; use `node-pagerduty` (community) | `npm install node-pagerduty` |

---

## Implementation Notes for MIRA

### Safety Alert → PagerDuty Severity Mapping

| MIRA severity | PagerDuty severity | Trigger condition |
|---------------|--------------------|-------------------|
| `CRITICAL` | `critical` | LOTO required, arc flash, confined space |
| `HIGH` | `error` | Motor overtemp, VFD fault requiring shutdown |
| `MEDIUM` | `warning` | Elevated vibration, trending fault |
| `LOW` | `info` | PM overdue, minor anomaly |

### dedup_key Strategy
Use `mira-{asset_id}-{fault_category}` as the `dedup_key`. This ensures:
- Re-triggers on the same asset/fault update the existing PagerDuty alert rather than creating duplicates
- Resolving in MIRA auto-closes the PagerDuty alert via `event_action: "resolve"` + same `dedup_key`

### Routing Key Management
Each PagerDuty **service** maps to one integration key. Recommended service layout:
- `MIRA Safety Alerts` service → safety escalation routing
- `MIRA Equipment Faults` service → maintenance team routing

Store routing keys in Doppler `factorylm/prd` as `PAGERDUTY_SAFETY_ROUTING_KEY` and `PAGERDUTY_FAULTS_ROUTING_KEY`.

### From Header Requirement
REST API PUT calls require `From: <email>`. Use a dedicated service-account email (e.g., `mira-bot@factorylm.com`) registered as a PagerDuty user. Set as `PAGERDUTY_FROM_EMAIL` in Doppler.

---

## Links

- [Events API v2 — Send Alert Event](https://developer.pagerduty.com/docs/events-api-v2/trigger-events/index.html)
- [REST API Reference](https://developer.pagerduty.com/api-reference/)
- [REST API Rate Limits](https://support.pagerduty.com/main/docs/rest-api-rate-limits)
- [V3 Webhooks Documentation](https://support.pagerduty.com/main/docs/webhooks)
- [python-pagerduty SDK User Guide](https://pagerduty.github.io/python-pagerduty/user_guide.html)
