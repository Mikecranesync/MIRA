# Jira (Atlassian Cloud) API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

Jira Cloud REST API v3 is used to create and manage work order tickets for maintenance tasks identified by MIRA. Base URL pattern: `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/` (OAuth 2.0) or `https://{your-domain}.atlassian.net/rest/api/3/` (API token).

---

## Auth Method

### Option A: API Token + Basic Auth (simpler, recommended for MIRA backend)
```
Authorization: Basic <base64(email:api_token)>
```
- Obtain token at: https://id.atlassian.com/manage-profile/security/api-tokens
- Encode as: `base64("user@example.com:ATATT3xFfGF0...")` 
- Store in Doppler as `JIRA_EMAIL` and `JIRA_API_TOKEN`

```python
import httpx, base64

credentials = base64.b64encode(f"{email}:{token}".encode()).decode()
headers = {
    "Authorization": f"Basic {credentials}",
    "Accept": "application/json",
    "Content-Type": "application/json"
}
```

### Option B: OAuth 2.0 (3LO) — for user-delegated flows
**Authorization URL:**
```
https://auth.atlassian.com/authorize
  ?audience=api.atlassian.com
  &client_id=<CLIENT_ID>
  &scope=<SCOPES>
  &redirect_uri=<CALLBACK_URL>
  &state=<CSRF_TOKEN>
  &response_type=code
  &prompt=consent
```

**Token exchange:**
```
POST https://auth.atlassian.com/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "<CLIENT_ID>",
  "client_secret": "<CLIENT_SECRET>",
  "code": "<AUTH_CODE>",
  "redirect_uri": "<CALLBACK_URL>"
}
```

**OAuth scopes needed for MIRA:**
| Scope | Purpose |
|-------|---------|
| `read:jira-work` | Read issues, projects |
| `write:jira-work` | Create/update issues, add comments |
| `read:jira-user` | Resolve user accounts |
| `offline_access` | Refresh tokens (no re-auth needed) |

**API call with OAuth:**
```
https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/{endpoint}
Authorization: Bearer <access_token>
```

Get `cloudId` via: `GET https://api.atlassian.com/oauth/token/accessible-resources`

---

## Key Endpoints We Need

Base URL (API token): `https://{domain}.atlassian.net/rest/api/3`

| Endpoint | Method | What it does | Required fields |
|----------|--------|--------------|-----------------|
| `/project` | GET | List all projects | — |
| `/issuetype` | GET | List issue types globally | — |
| `/issue` | POST | Create issue | `fields.project.key`, `fields.issuetype.name`, `fields.summary` |
| `/issue/bulk` | POST | Create up to 50 issues | `issueUpdates[]` array |
| `/issue/{issueIdOrKey}` | GET | Get issue details | — |
| `/issue/{issueIdOrKey}` | PUT | Update issue | `fields` or `update` object |
| `/issue/{issueIdOrKey}/comment` | POST | Add comment | `body` (Atlassian Document Format) |
| `/issue/{issueIdOrKey}/transitions` | POST | Transition status | `transition.id` |
| `/issue/{issueIdOrKey}/assignee` | PUT | Assign issue | `accountId` |
| `/myself` | GET | Get current user info | — (verifies auth) |

### Create Issue — Full Request Example

```
POST /rest/api/3/issue
Content-Type: application/json

{
  "fields": {
    "project": { "key": "MAINT" },
    "summary": "VFD-01 — Motor overtemperature fault (MIRA-sess_abc123)",
    "issuetype": { "name": "Task" },
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "MIRA detected overtemperature on VFD-01 at 87.4°C. Fault code OC-001. Inspect cooling system and check motor load."
            }
          ]
        }
      ]
    },
    "priority": { "name": "High" },
    "assignee": { "accountId": "5b10ac8d82e05b22cc7d4ef5" },
    "labels": ["mira-auto", "vfd", "overtemp"],
    "duedate": "2026-04-29"
  }
}
```

Response: `{ "id": "10001", "key": "MAINT-42", "self": "https://..." }`

### Add Comment — ADF Format

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "MIRA resolved: fault cleared after cooling fan replacement." }]
      }
    ]
  }
}
```

### Get Issue Types for a Project

```
GET /rest/api/3/issue/createmeta?projectKeys=MAINT&expand=projects.issuetypes.fields
```
Returns all valid `issuetype` names and their required fields for a given project.

---

## Webhook / Event Capabilities

Jira Cloud can push events to MIRA when issues are created, updated, or transitioned.

**Register webhook (requires admin scope):**
```
POST /rest/api/3/webhook
Authorization: Basic <credentials>
Content-Type: application/json

{
  "url": "https://mira.factorylm.com/webhooks/jira",
  "webhooks": [
    {
      "events": [
        "jira:issue_created",
        "jira:issue_updated",
        "jira:issue_deleted",
        "comment_created",
        "comment_updated"
      ],
      "filters": {
        "issue-related-events-section": "project = MAINT"
      }
    }
  ]
}
```

**Supported events:** `jira:issue_created`, `jira:issue_updated`, `jira:issue_deleted`, `comment_created`, `comment_updated`, `worklog_updated`, `issuelink_created`

**Payload structure:**
```json
{
  "timestamp": 1714305000000,
  "webhookEvent": "jira:issue_updated",
  "issue": {
    "id": "10001",
    "key": "MAINT-42",
    "fields": {
      "summary": "VFD-01 — Motor overtemperature",
      "status": { "name": "In Progress" },
      "assignee": { "accountId": "...", "displayName": "Tech A" }
    }
  },
  "user": { "accountId": "...", "displayName": "Mike Harper" }
}
```

**Note:** Dynamic webhooks (registered via API) expire after 30 days. Use the Jira admin UI for permanent webhooks, or refresh programmatically before expiry.

---

## Rate Limits

Jira Cloud uses a **points-based quota** plus burst limits. Numbers are adaptive and not published as fixed values.

| Limit type | Detail |
|------------|--------|
| Points quota | ~65,000 points/hour (global pool); each request costs 1 base point + 1 per affected object |
| GET burst | ~100 requests/second per endpoint |
| POST/PUT burst | ~50–100 requests/second per endpoint |
| Per-issue writes | 20 writes per 2 seconds; 100 writes per 30 seconds on a single issue |
| Exceeded response | HTTP 429 |

**Response headers on 429:**
```
Retry-After: <seconds>
X-RateLimit-Limit: <capacity>
X-RateLimit-Remaining: <available>
X-RateLimit-Reset: <ISO8601 timestamp>
RateLimit-Reason: quota-based | burst-based | per-issue-on-write
```

**Retry strategy:** Exponential backoff with jitter — start at 2s, double each attempt, add ±30% random jitter, cap at 30s, max 4 attempts.

---

## SDK Availability

| SDK | Install | Notes |
|-----|---------|-------|
| `atlassian-python-api` (community, popular) | `pip install atlassian-python-api` | Supports Jira, Confluence, Bitbucket; `Jira` class wraps all endpoints |
| `jira` (community) | `pip install jira` | Python 3 compatible; simpler interface for issue CRUD |
| No official Atlassian Python SDK | — | Atlassian provides SDKs for Connect apps (Node.js), not REST API wrappers |

**atlassian-python-api usage:**
```python
from atlassian import Jira

jira = Jira(
    url="https://yourcompany.atlassian.net",
    username="user@example.com",
    password="ATATT3x...",  # API token
    cloud=True
)

# Create issue
issue = jira.issue_create(fields={
    "project": {"key": "MAINT"},
    "summary": "VFD-01 overtemp",
    "issuetype": {"name": "Task"}
})

# Add comment
jira.issue_add_comment("MAINT-42", "Fault confirmed by tech.")

# List projects
projects = jira.projects()
```

---

## Implementation Notes for MIRA

### Project Key + Issue Type Requirements
Before creating issues, MIRA must know:
1. `project.key` — the Jira project key (e.g., `MAINT`, `OPS`). Store as `JIRA_DEFAULT_PROJECT_KEY` in Doppler.
2. `issuetype.name` — must exactly match an issue type in that project. Call `GET /rest/api/3/issue/createmeta?projectKeys=MAINT` on startup to cache valid types.

Recommended issue types for MIRA: `Task` (standard work order), `Bug` (urgent fault), `Story` (PM task).

### Description: Use Atlassian Document Format (ADF)
Jira Cloud v3 **requires ADF** for `description` fields — plain strings are rejected. The minimum valid structure is:
```json
{
  "type": "doc",
  "version": 1,
  "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }]
}
```

### Linking MIRA Sessions to Jira Issues
Store `MAINT-42` in the MIRA session/incident record so tech follow-up in Jira can be synced back. Use `labels: ["mira-auto"]` on all MIRA-created issues for easy JQL filtering: `project = MAINT AND labels = mira-auto ORDER BY created DESC`.

### Base URL Selection
- API token auth: use `https://{domain}.atlassian.net/rest/api/3/`
- OAuth 2.0: use `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/`

Store the domain as `JIRA_DOMAIN` in Doppler (e.g., `yourcompany.atlassian.net`).

---

## Links

- [Jira Cloud REST API v3 — Issues Group](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Jira Cloud REST API v3 — Overview](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [OAuth 2.0 (3LO) Apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [atlassian-python-api Jira docs](https://atlassian-python-api.readthedocs.io/jira.html)
