# ServiceNow API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

ServiceNow's **Table API** is the primary REST interface for CRUD operations on any ServiceNow table. For MIRA, this means creating and updating incidents in the `incident` table, and optionally looking up CMDB Configuration Items (CIs) in `cmdb_ci_hardware`. Base URL: `https://{instance}.service-now.com/api/now/table/{table_name}`.

---

## Auth Method

ServiceNow supports three authentication methods. **OAuth 2.0 is strongly recommended for production.**

### Option A: Basic Authentication (simplest, dev/testing only)

```
Authorization: Basic <base64(username:password)>
```

Use a **dedicated service account** — not a personal user account. The service account must have roles: `itil` (for incident CRUD) and `snc_platform_rest_api_access`.

```python
import httpx

resp = await client.post(
    f"https://{instance}.service-now.com/api/now/table/incident",
    auth=(username, password),
    json=payload
)
```

### Option B: OAuth 2.0 — Client Credentials (recommended for MIRA)

1. In ServiceNow: **System OAuth → Application Registry** → create OAuth API endpoint for external clients
2. Enable "Client Credentials" grant type
3. Note the `client_id` and `client_secret`

**Token endpoint:**
```
POST https://{instance}.service-now.com/oauth_token.do
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<client_id>
&client_secret=<client_secret>
```

**API call with token:**
```
Authorization: Bearer <access_token>
Accept: application/json
Content-Type: application/json
```

**Token lifetime:** Configurable per OAuth application (default 1800s). Refresh before expiry or re-request on 401.

Store in Doppler: `SERVICENOW_INSTANCE`, `SERVICENOW_CLIENT_ID`, `SERVICENOW_CLIENT_SECRET` (or `SERVICENOW_USERNAME` / `SERVICENOW_PASSWORD` for basic auth).

### Option C: API Key (on-prem instances, some versions)
Some ServiceNow instances support `X-UserToken` header auth. Check with the customer's ServiceNow admin.

---

## Key Endpoints We Need

Base URL: `https://{instance}.service-now.com/api/now/table`

### Incident Operations

| Endpoint | Method | What it does | Required fields |
|----------|--------|--------------|-----------------|
| `/incident` | POST | Create incident | `short_description` |
| `/incident/{sys_id}` | GET | Get single incident | — |
| `/incident` | GET | List incidents | `sysparm_query`, `sysparm_limit` |
| `/incident/{sys_id}` | PUT | Full update | fields to overwrite |
| `/incident/{sys_id}` | PATCH | Partial update | fields to change |

### CMDB Operations

| Endpoint | Method | What it does |
|----------|--------|--------------|
| `/cmdb_ci_hardware` | GET | Look up hardware CI by name/serial |
| `/cmdb_ci` | GET | Generic CI lookup |
| `/cmdb_relationship` | GET | Get CI relationships |

### Create Incident — Full Request Example

```
POST https://{instance}.service-now.com/api/now/table/incident
Authorization: Bearer <token>
Accept: application/json
Content-Type: application/json

{
  "short_description": "VFD-01 Motor overtemperature — MIRA alert",
  "description": "MIRA diagnostic session sess_abc123 detected overtemperature at 87.4°C on VFD-01. Fault code OC-001. Recommend inspection of cooling system and motor load.",
  "category": "hardware",
  "subcategory": "motor",
  "impact": "2",
  "urgency": "2",
  "priority": "2",
  "state": "1",
  "caller_id": "mira.bot",
  "assignment_group": "Maintenance Team",
  "cmdb_ci": "VFD-01",
  "u_mira_session_id": "sess_abc123",
  "work_notes": "Auto-created by MIRA AI diagnostics."
}
```

**Response wraps result in `result` key:**
```json
{
  "result": {
    "sys_id": "1a2b3c4d5e6f7g8h9i0j",
    "number": "INC0010042",
    "short_description": "VFD-01 Motor overtemperature — MIRA alert",
    "state": { "value": "1", "display_value": "New" },
    "priority": { "value": "2", "display_value": "High" }
  }
}
```

Store the `sys_id` and `number` for subsequent updates and linking.

### Key Incident Fields

| Field | Type | Values / Notes |
|-------|------|----------------|
| `short_description` | string | Required. Max 160 chars. |
| `description` | string | Full description, multiline |
| `state` | integer | 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed |
| `impact` | integer | 1=High, 2=Medium, 3=Low |
| `urgency` | integer | 1=High, 2=Medium, 3=Low |
| `priority` | integer | Auto-calculated from impact+urgency, or override: 1=Critical, 2=High, 3=Moderate, 4=Low |
| `category` | string | `hardware`, `software`, `network`, `inquiry` |
| `cmdb_ci` | string | CI name or sys_id — links to CMDB asset |
| `caller_id` | string | Username of requester |
| `assignment_group` | string | Group name or sys_id |
| `assigned_to` | string | Username or sys_id of technician |
| `work_notes` | string | Internal notes (not visible to caller) |
| `comments` | string | Public comments (visible to caller) |
| `resolved_at` | datetime | ISO 8601 — set when resolving |
| `resolution_code` | string | e.g., `Solved (Permanently)` |
| `close_notes` | string | Required when closing |

### List Incidents with Query

```
GET /api/now/table/incident
  ?sysparm_query=state=1^ORstate=2^assigned_to=mira.bot
  &sysparm_limit=50
  &sysparm_offset=0
  &sysparm_fields=sys_id,number,short_description,state,priority,cmdb_ci
  &sysparm_display_value=true
```

`sysparm_display_value=true` returns human-readable values (e.g., `"New"`) alongside raw values.

### Update Incident (resolve)

```
PATCH https://{instance}.service-now.com/api/now/table/incident/{sys_id}
Content-Type: application/json

{
  "state": "6",
  "resolved_at": "2026-04-28T15:00:00Z",
  "resolution_code": "Solved (Permanently)",
  "close_notes": "Cooling fan replaced. Motor temperature normalized."
}
```

### CMDB CI Lookup

```
GET /api/now/table/cmdb_ci_hardware
  ?sysparm_query=name=VFD-01
  &sysparm_fields=sys_id,name,serial_number,model_id,location
  &sysparm_limit=1
```

---

## Webhook / Event Capabilities

ServiceNow does not expose traditional inbound webhooks. Instead it uses **outbound REST messages** triggered by **Business Rules** to push events to external systems.

### Setting Up Outbound Notifications to MIRA

**Step 1 — Create REST Message** (System Web Services → Outbound → REST Message):
- Name: `MIRA Incident Sync`
- Endpoint: `https://mira.factorylm.com/webhooks/servicenow`
- HTTP method: POST
- Authentication: Basic or OAuth
- HTTP Request headers: `Content-Type: application/json`, `X-MIRA-Secret: <secret>`

**Step 2 — Create Business Rule** (System Definition → Business Rules):
```javascript
// Business Rule: "Notify MIRA on incident state change"
// Table: incident | When: after | Insert: false | Update: true
// Condition: state changed

(function executeRule(current, previous) {
    var r = new sn_ws.RESTMessageV2('MIRA Incident Sync', 'notify');
    r.setStringParameterNoEscape('sys_id', current.sys_id);
    r.setStringParameterNoEscape('number', current.number);
    r.setStringParameterNoEscape('state', current.state.toString());
    r.setStringParameterNoEscape('assigned_to', current.assigned_to.toString());
    try {
        var response = r.execute();
    } catch(ex) {
        gs.error('MIRA Sync failed: ' + ex.message);
    }
})(current, previous);
```

**Events MIRA should receive:**
- Incident state change (New → In Progress → Resolved)
- Assignment changes
- Work notes added

**MIRA webhook endpoint** (`/webhooks/servicenow`) verifies the `X-MIRA-Secret` header and maps incoming `sys_id` to the MIRA session that created the incident.

---

## Rate Limits

ServiceNow rate limits are **instance-configurable** — there is no universal published limit. Defaults vary by ServiceNow version and license tier.

| Behavior | Detail |
|----------|--------|
| Default limit (common) | ~1,000 requests/hour per user/service account |
| Exceeded response | HTTP 429 |
| Response headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Rule` |
| Config location | ServiceNow admin: System Properties → REST API → Rate Limiting |
| Config activation delay | Up to 30 seconds after changing limits |
| On-prem vs SaaS | On-prem instances: no default limit unless configured; SaaS: may have tenant limits |

**Ask the customer's ServiceNow admin** for the actual limit on their instance before integration. Set `sysparm_limit` appropriately on list calls and implement exponential backoff on 429.

---

## SDK Availability

| SDK | Install | Notes |
|-----|---------|-------|
| `pysnow` (community, stable) | `pip install pysnow` | Python; stable maintenance mode; covers Table API well |
| `aiosnow` (community, async) | `pip install aiosnow` | Async successor to pysnow; use for MIRA's async stack |
| `servicenow-sdk` (community) | `pip install servicenow-sdk` | Newer option; less adoption |
| No official Python SDK | — | ServiceNow does not publish an official Python client |

**aiosnow usage (async, recommended for MIRA):**
```python
import aiosnow

async with aiosnow.Client(
    "https://{instance}.service-now.com",
    basic_auth=(username, password)
) as client:
    incident_model = await client.get_model(aiosnow.models.TableModel, "incident")
    
    # Create
    result = await incident_model.create({
        "short_description": "VFD-01 overtemp — MIRA",
        "impact": "2",
        "urgency": "2"
    })
    sys_id = result["sys_id"]
    
    # Update
    await incident_model.update({"sys_id": sys_id}, {"state": "6"})
```

**Direct httpx (no SDK, explicit control):**
```python
import httpx

async with httpx.AsyncClient(
    base_url=f"https://{instance}.service-now.com/api/now/table",
    auth=(username, password),
    headers={"Accept": "application/json", "Content-Type": "application/json"},
    timeout=30
) as client:
    resp = await client.post("/incident", json=payload)
    resp.raise_for_status()
    sys_id = resp.json()["result"]["sys_id"]
```

---

## Implementation Notes for MIRA

### Table Name for Incidents
Always `incident` — this is the standard ServiceNow ITSM incident table. Never use `task` (parent table, too broad) or `u_incident` (custom table some orgs create).

### Authentication Gotchas (On-Prem Instances)
- **Basic auth may be disabled** on some hardened on-prem instances. Always attempt OAuth first.
- **On-prem behind VPN:** MIRA must have network access to the ServiceNow instance. May require Tailscale or customer VPN peering.
- **SSL cert issues:** On-prem instances often use self-signed or internal CA certs. Set `verify=False` only in dev; in production, provide the customer's CA bundle via `verify=/path/to/ca.pem`.
- **`channel_binding` errors on Windows hosts** — not applicable to MIRA (macOS/Linux), but noted in gotchas.

### CMDB CI Linking
When MIRA knows the asset (e.g., `VFD-01`), set `cmdb_ci` in the incident payload. This links the incident to the CMDB record and enables asset history reporting in ServiceNow. Resolve the CI's `sys_id` first via a CMDB lookup, or use the display name if the instance accepts it.

### Custom Fields
Enterprise customers often have custom fields (prefixed `u_`). Common ones:
- `u_external_id` — store MIRA session ID here
- `u_source_system` — set to `"MIRA"` for filtering

Ask the customer's ServiceNow admin for the field list on their instance.

### Bidirectional Sync Loop Prevention
If MIRA creates an incident and ServiceNow Business Rules fire back to MIRA, implement idempotency: tag MIRA-created incidents with `work_notes: "mira_created"` and skip webhook processing for updates where `u_source_system = MIRA` to prevent infinite loops.

---

## Links

- [ServiceNow REST API Reference (Washington DC)](https://docs.servicenow.com/bundle/washingtondc-api-reference/page/integrate/inbound-rest/concept/c_RESTAPI.html)
- [Table API Overview — Hevo Data guide](https://hevodata.com/learn/servicenow-rest-apis/)
- [ServiceNow Rate Limit Community Article](https://www.servicenow.com/community/developer-articles/understanding-servicenow-rest-api-rate-limits-key-concepts-amp/ta-p/3407367)
- [aiosnow GitHub](https://github.com/rbw/aiosnow)
- [pysnow Documentation](https://pysnow.readthedocs.io/en/latest/)
