# Google Workspace APIs Reference

**For:** MIRA Hub integration — KB document sync, email alerts, Calendar PM scheduling, Google Chat messaging
**Researched:** 2026-04-28
**Existing code:** `mira-hub/src/app/api/auth/google/` (OAuth flow), `mira-bots/gchat/workspace_client.py` (service account Chat+Drive)

---

## Auth Method (shared across all Google APIs)

Google APIs use **OAuth 2.0**. MIRA uses two distinct flows depending on the use-case:

### 1. User OAuth (3-Legged) — what mira-hub already does

Flow: User → Google consent screen → authorization code → access+refresh tokens stored in `bindings` table.

Key implementation files:
- `mira-hub/src/app/api/auth/google/route.ts` — builds the auth URL, sets state cookie
- `mira-hub/src/app/api/auth/google/callback/route.ts` — exchanges code for tokens, calls `upsertBinding()`
- `mira-hub/src/lib/token-refresh.ts` — `ensureFreshAccessToken("google")` — refresh logic (5-min skew window)

Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
Token URL: `https://oauth2.googleapis.com/token`
UserInfo URL: `https://www.googleapis.com/oauth2/v2/userinfo`

Required params for auth URL:
```
response_type=code
access_type=offline          # get refresh token
prompt=consent               # force consent screen (needed to get refresh_token every time)
scope=<space-separated list>
```

Env vars required (Doppler `factorylm/prd`):
- `GOOGLE_CLIENT_ID` — used by the workspace integration OAuth flow
- `GOOGLE_CLIENT_SECRET` — used by the workspace integration OAuth flow
- `HUB_AUTH_GOOGLE_CLIENT_ID` — used by NextAuth (login with Google)
- `HUB_AUTH_GOOGLE_CLIENT_SECRET` — used by NextAuth

Note: these are **two separate OAuth clients** — one for login identity, one for workspace data access. Keep them separate.

### 2. Service Account (2-Legged) — what mira-bots/gchat already does

`mira-bots/gchat/workspace_client.py` implements a self-contained service account client using PyJWT RS256 assertion → token exchange. No user interaction. Used for Chat bot messaging and Drive file downloads.

JWT assertion flow:
```
POST https://oauth2.googleapis.com/token
  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
  assertion=<RS256-signed JWT with iss, sub, aud, iat, exp, scope>
```

The service account JSON key (`private_key` + `client_email`) is stored in Doppler. `WorkspaceClient.__init__()` accepts the JSON as a dict, raw JSON string, or base64-encoded JSON.

### Choosing the Right Auth Method

| Use-case | Auth method | Reason |
|---|---|---|
| KB Drive sync — user's My Drive | User OAuth | Service accounts can't see users' personal files without DWD |
| KB Drive sync — Shared Drive | Service account | SA can be added as a member of Shared Drives directly |
| Gmail send (outbound alerts) | User OAuth | Service accounts need DWD + admin approval to send as a user |
| Calendar PM event creation | User OAuth | Events need to appear on the user's own calendar |
| Google Chat bot messaging | Service account | `chat.bot` scope works without user consent |
| Google Chat webhook | Neither — use webhook URL | Simplest for one-way push to a space |

### Domain-Wide Delegation (DWD)

For Google Workspace (paid) orgs only. Lets the service account impersonate any user in the domain. Setup:
1. Google Workspace Admin console → Security → API Controls → Domain-wide Delegation
2. Add service account Client ID + scopes
3. Can take up to 24h to propagate

For MIRA MVP (individual users signing in via OAuth), DWD is not needed. Consider for enterprise multi-tenant deployments.

---

## Google Drive

### Key Endpoints We Need

Base URL: `https://www.googleapis.com/drive/v3`

#### files.list — discover KB documents
```
GET /drive/v3/files
```
Key query parameters:
- `q` — search filter string (see query syntax below)
- `pageSize` — max results per page (default 100, max 1000)
- `pageToken` — pagination cursor from previous response
- `fields` — partial response mask, e.g. `files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken`
- `corpora` — `user` (My Drive) or `drive` (Shared Drive, requires `driveId`) or `allDrives`
- `includeItemsFromAllDrives` — `true` to include Shared Drives
- `driveId` — required when `corpora=drive`
- `supportsAllDrives` — `true` required when accessing Shared Drives

Query filter (`q` param) examples:
```
# All non-trashed PDFs modified in last 30 days
mimeType = 'application/pdf' and trashed = false and modifiedTime > '2026-03-28T00:00:00'

# All Google Docs in a specific folder
'FOLDER_ID' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false

# Files shared with the authenticated user
sharedWithMe = true and trashed = false

# Full-text search
fullText contains 'conveyor maintenance'
```

Google Workspace MIME types:
| Type | MIME |
|------|------|
| Google Doc | `application/vnd.google-apps.document` |
| Google Sheet | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Folder | `application/vnd.google-apps.folder` |

#### files.get — get metadata or download binary
```
GET /drive/v3/files/{fileId}
GET /drive/v3/files/{fileId}?alt=media   # download binary content
```
- Use `alt=media` for binary files (PDF, images)
- Use `files.export` for Google Workspace formats

#### files.export — export Google Docs/Sheets as PDF or text
```
GET /drive/v3/files/{fileId}/export?mimeType=application/pdf
GET /drive/v3/files/{fileId}/export?mimeType=text/plain
```
- Cannot use `alt=media` on Google Workspace docs — must export
- Export to `text/plain` for cheap LLM ingestion
- Export to `application/pdf` for full-fidelity KB chunks (then pass through mira-docling)

#### changes.getStartPageToken — baseline for incremental sync
```
GET /drive/v3/changes/startPageToken
```
Returns a `startPageToken`. Store it; use for polling `changes.list`.

#### changes.list — poll for changes since last sync
```
GET /drive/v3/changes?pageToken={token}&spaces=drive
```
Returns changed file IDs since the token. Update stored token after processing.

#### files.watch — push notification on a single file
```
POST /drive/v3/files/{fileId}/watch
{
  "id": "unique-channel-uuid",
  "type": "web_hook",
  "address": "https://app.factorylm.com/api/integrations/google/drive/webhook",
  "expiration": 1234567890000  // ms timestamp, max 86400s from now
}
```

#### changes.watch — push notification on all Drive changes
```
POST /drive/v3/changes/watch?pageToken={token}
{
  "id": "unique-channel-uuid",
  "type": "web_hook",
  "address": "https://app.factorylm.com/api/integrations/google/drive/webhook",
  "token": "tenant-123-verification-token"
}
```
Use `changes.watch` (not `files.watch`) for KB sync — one channel covers all changes.

### Webhook / Push Notifications (Drive changes)

How it works: POST requests sent to your HTTPS endpoint whenever a watched resource changes.

Notification headers:
```
X-Goog-Channel-ID: your-channel-uuid
X-Goog-Resource-State: change | sync
X-Goog-Resource-ID: stable opaque resource ID
X-Goog-Message-Number: incrementing (not sequential, gaps OK)
X-Goog-Channel-Token: your verification token
```

MIRA endpoint requirements:
- Must be public HTTPS with valid TLS (self-signed rejected)
- Respond with 200/201/202/204 to acknowledge
- User-Agent will be `APIs-Google`
- On `sync` state: a sync probe, not a real change — respond 200, ignore it

Expiration:
- Files channel: max 86,400 seconds (1 day)
- Changes channel: max 604,800 seconds (1 week)
- No auto-renewal — must re-call `watch` before expiry with a new channel UUID
- Run a daily cron in mira-hub to renew expiring channels

Alternative to webhooks: Poll `changes.list` on a schedule (hourly is fine for KB sync). Simpler to implement and sufficient for non-real-time use cases.

### Rate Limits

- **12,000 requests per 60 seconds** (global, per project)
- **12,000 requests per 60 seconds per user**
- No daily request limit (as long as per-minute limits are respected)
- Upload limit: 750 GB/day, 5 TB max file size
- Error 403 `userRateLimitExceeded` or 429 — implement exponential backoff (max 64s)

### Scopes Required

| Scope | Use-case |
|---|---|
| `https://www.googleapis.com/auth/drive.readonly` | Read files + metadata for KB sync (already in mira-hub route.ts) |
| `https://www.googleapis.com/auth/drive` | Full access — only if MIRA needs to write files back |
| `https://www.googleapis.com/auth/drive.activity.readonly` | View file activity log (optional, for audit trail) |

**Use `drive.readonly` for KB sync** — it covers `files.list`, `files.get`, `files.export`, `changes.list`, and `files.watch`.

---

## Gmail

### Key Endpoints We Need

Base URL: `https://gmail.googleapis.com`
All calls use `userId=me` (acts as the authenticated user).

#### messages.send — outbound alert emails
```
POST /gmail/v1/users/me/messages/send
Content-Type: application/json

{
  "raw": "<base64url-encoded RFC 2822 message>"
}
```
Message encoding: build RFC 2822 string → `base64url` encode (replace `+` with `-`, `/` with `_`, strip `=` padding).

Python example (using stdlib):
```python
import base64
from email.mime.text import MIMEText

msg = MIMEText("Work order WO-1234 is overdue. Asset: Conveyor Belt A.")
msg["to"] = "mike@factorylm.com"
msg["from"] = "mira@factorylm.com"
msg["subject"] = "[MIRA Alert] Overdue PM: Conveyor Belt A"

raw = base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("=")
# POST {"raw": raw} to /gmail/v1/users/me/messages/send
```

Attachments: use `email.mime.multipart.MIMEMultipart` with `MIMEBase` parts; same base64url encoding applies.

Threading: set `References` and `In-Reply-To` headers matching existing thread's `Message-ID` to keep alerts grouped.

#### messages.list — inbound parse (future: receive work orders via email)
```
GET /gmail/v1/users/me/messages?q=subject:"MIRA Work Order"&labelIds=INBOX
```
- `q` uses same Gmail search syntax as the web UI
- Returns message IDs only; use `messages.get` to fetch content

#### messages.get — fetch full message content
```
GET /gmail/v1/users/me/messages/{id}?format=full
GET /gmail/v1/users/me/messages/{id}?format=metadata  # headers only (fast)
```
- Body is base64url encoded in `payload.body.data` (or multipart `payload.parts`)
- Decode with `base64.urlsafe_b64decode(data + "==")`

#### users.watch — push notifications via Cloud Pub/Sub
```
POST /gmail/v1/users/me/watch
{
  "topicName": "projects/my-project/topics/mira-gmail-notifications",
  "labelIds": ["INBOX"],
  "labelFilterBehavior": "INCLUDE"
}
```
Setup steps:
1. Create a Cloud Pub/Sub topic in your GCP project
2. Grant `gmail-api-push@system.gserviceaccount.com` the `roles/pubsub.publisher` role on the topic
3. Create a Pub/Sub push subscription pointing to your HTTPS endpoint
4. Call `users.watch` with the topic name

Notification payload (base64url-decoded):
```json
{"emailAddress": "user@example.com", "historyId": "9876543210"}
```
After receiving: call `users.history.list?startHistoryId={historyId}` to get the actual changes.

Renewal: must call `watch` at least every **7 days** or notifications stop.

### Rate Limits

Gmail API uses **quota units** per call, not raw request counts. From Google's docs:
- `messages.send`: 100 quota units per call
- `messages.list`: 5 quota units per call
- `messages.get`: 5 quota units per call
- Default daily quota: **1,000,000,000 quota units/day** per project (effectively unlimited for MIRA-scale)
- Per-user send limit: Gmail enforces a **500 recipient/day** limit on personal accounts; Google Workspace accounts get 2,000
- Rate: **250 quota units/second per user**

For alert-only use (one email per alert), quota is never a concern. If doing inbound parsing at scale, batch `messages.list` calls with pagination.

### Scopes Required

| Scope | Use-case |
|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Send outbound alert emails only (minimal, recommended) |
| `https://www.googleapis.com/auth/gmail.readonly` | Read inbox for inbound work order parsing (already in mira-hub route.ts) |
| `https://www.googleapis.com/auth/gmail.modify` | Read + modify labels (mark parsed emails as processed) |
| `https://www.googleapis.com/auth/gmail.metadata` | Headers only — for routing/dedup without reading body |

**Start with `gmail.send` + `gmail.readonly`** — covers all current MIRA use-cases. The existing route.ts already requests `gmail.readonly`; add `gmail.send` when implementing outbound alerts.

---

## Google Calendar

### Key Endpoints We Need

Base URL: `https://www.googleapis.com/calendar/v3`

#### calendarList.list — discover user's calendars
```
GET /calendar/v3/users/me/calendarList
```
Returns all calendars the user has access to. Use to let users pick which calendar MIRA should write PM events to.

Key response fields per calendar: `id` (use as `calendarId`), `summary`, `primary`, `accessRole`.

#### events.list — read existing PM events
```
GET /calendar/v3/calendars/{calendarId}/events
  ?timeMin=2026-04-28T00:00:00Z
  &timeMax=2026-07-28T00:00:00Z
  &q=MIRA%20PM
  &singleEvents=true
  &orderBy=startTime
```
- `q` does full-text search on event fields
- `singleEvents=true` expands recurring events into individual instances
- `calendarId=primary` works as a shortcut for the user's default calendar

#### events.insert — create a PM scheduled event
```
POST /calendar/v3/calendars/{calendarId}/events
Content-Type: application/json

{
  "summary": "[MIRA PM] Conveyor Belt A — Lubrication",
  "description": "Preventive maintenance task auto-scheduled by MIRA.\nWork Order: WO-456\nAsset: Conveyor Belt A\nProcedure: Check tension + lubricate pulleys",
  "location": "Plant Floor, Station 3",
  "start": { "dateTime": "2026-05-15T08:00:00-05:00" },
  "end": { "dateTime": "2026-05-15T09:00:00-05:00" },
  "attendees": [
    { "email": "technician@factorylm.com" }
  ],
  "reminders": {
    "useDefault": false,
    "overrides": [
      { "method": "email", "minutes": 1440 },
      { "method": "popup", "minutes": 60 }
    ]
  },
  "recurrence": ["RRULE:FREQ=MONTHLY;INTERVAL=1"],
  "extendedProperties": {
    "private": {
      "mira_work_order_id": "WO-456",
      "mira_asset_id": "asset-123",
      "mira_pm_schedule_id": "pm-789"
    }
  }
}
```
`extendedProperties.private` is per-calendar-user, invisible to other attendees — use for MIRA IDs to enable sync-back.

Required fields: `start` and `end` only. Everything else is optional.

#### events.patch — update existing PM event (e.g., reschedule)
```
PATCH /calendar/v3/calendars/{calendarId}/events/{eventId}
Content-Type: application/json

{ "start": { "dateTime": "..." }, "end": { "dateTime": "..." } }
```
Patch semantics: only send fields to change; omitted fields are preserved.

#### events.get — check if MIRA-created event still exists
```
GET /calendar/v3/calendars/{calendarId}/events/{eventId}
```

### Webhook / Push Notifications

Subscribe to calendar changes to detect when a user moves/deletes a MIRA PM event:

```
POST /calendar/v3/calendars/{calendarId}/events/watch
{
  "id": "unique-channel-uuid",
  "type": "web_hook",
  "address": "https://app.factorylm.com/api/integrations/google/calendar/webhook",
  "token": "tenant-123-verification-token"
}
```

Notification format — HTTP POST headers (no body for most events):
```
X-Goog-Channel-ID: your-channel-uuid
X-Goog-Resource-State: exists | sync | not_exists
X-Goog-Channel-Token: your verification token
X-Goog-Resource-ID: stable resource identifier
```
On `exists`: fetch `events.list` with `updatedMin` to get the diff.

Important: notifications are **not 100% reliable** — small percentage can be dropped. Always reconcile with a periodic `events.list` poll as a fallback.

No auto-renewal — must watch for expiration and re-register.

### Rate Limits

Calendar API uses a sliding per-minute window:
- **Per project per minute**: visible in Google Cloud Console → Calendar API → Quotas tab
- **Per user per minute**: separate sub-limit
- Returns 403 `usageLimits` or 429 on breach
- Exact numbers are project-configurable in Cloud Console; default free tier is generous for PM scheduling at MIRA scale

For PM scheduling: `events.insert` once per PM task created — at MIRA scale (dozens/day max) quota is never a concern.

### Scopes Required

| Scope | Use-case |
|---|---|
| `https://www.googleapis.com/auth/calendar.events` | Read + write events on all accessible calendars (recommended for MIRA) |
| `https://www.googleapis.com/auth/calendar.events.owned` | Write events only to calendars the user owns |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Read-only (list existing PM events) |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | List user's calendars (let them pick which one) |
| `https://www.googleapis.com/auth/calendar.readonly` | Read all calendar data including settings |
| `https://www.googleapis.com/auth/calendar` | Full access including sharing permissions (more than needed) |

**Recommended minimum for MIRA:** `calendar.events` + `calendar.calendarlist.readonly`

---

## Google Chat

### Key Endpoints We Need

Base URL: `https://chat.googleapis.com/v1`

#### messages.create — send a message to a Chat space
```
POST /v1/{parent=spaces/SPACE_ID}/messages
Authorization: Bearer {service_account_token or user_token}
Content-Type: application/json

{
  "text": "MIRA Alert: Work order WO-456 is due in 24 hours.\nAsset: Conveyor Belt A"
}
```
Rich Cards v2 (structured messages):
```json
{
  "cardsV2": [{
    "cardId": "mira-alert-wo456",
    "card": {
      "header": { "title": "MIRA PM Alert", "subtitle": "Conveyor Belt A" },
      "sections": [{
        "widgets": [
          { "textParagraph": { "text": "Work Order WO-456 is due in 24 hours." } },
          { "buttonList": { "buttons": [{
            "text": "View Work Order",
            "onClick": { "openLink": { "url": "https://app.factorylm.com/work-orders/WO-456" }}
          }]}}
        ]
      }]
    }
  }]
}
```
The `WorkspaceClient.send_message()` in `mira-bots/gchat/workspace_client.py` already implements this with service account auth.

#### messages.list — retrieve messages from a space
```
GET /v1/spaces/SPACE_ID/messages
```

#### spaces.list — discover spaces the bot is a member of
```
GET /v1/spaces
```

#### spaces.members.list — list members in a space
```
GET /v1/spaces/SPACE_ID/members
```

### Webhook vs Bot App

| | Incoming Webhook | Bot App (service account) |
|---|---|---|
| Setup | Copy URL from Chat space settings | Deploy service account + register bot in GCP |
| Auth | No auth — URL is the secret | Service account JWT → OAuth token |
| Send messages | POST to webhook URL | POST to `/v1/spaces/{id}/messages` |
| Receive messages | Not possible | Via event subscriptions or interactive cards |
| Rate limit | 1 req/sec per space, shared across all webhooks | Standard API quotas |
| Use-case | Simple one-way notifications | Two-way bot, interactive alerts |
| MIRA use-case | Quick wins: alerts to a #mira-alerts space | Full bot integration |

**Webhook setup** (simplest path for MIRA alerts):
1. Open Chat in browser → target space → Apps & Integrations → Add webhooks
2. Name it "MIRA Alerts", copy the webhook URL
3. Store URL in Doppler as `GOOGLE_CHAT_WEBHOOK_URL`
4. `POST {"text": "..."}` to the URL — no auth headers needed

**Webhook message format:**
```python
import httpx

async def send_chat_alert(webhook_url: str, text: str) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(webhook_url, json={"text": text})
        resp.raise_for_status()
```

Threading with webhooks:
```
POST {webhook_url}?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD
{"text": "Reply...", "thread": {"threadKey": "wo-456"}}
```

**Bot App** (already partially implemented in `mira-bots/gchat/workspace_client.py`) is needed if MIRA needs to receive messages from Chat (e.g., technician replies, slash commands).

### Rate Limits

- **Webhook:** 1 request/second per space (shared across all webhooks posting to that space)
- **Chat API (bot):** Standard per-project per-minute quota; no published hard number — generous for notification use
- Rate limit response: `google.rpc.Status` JSON with appropriate HTTP error code
- Implement exponential backoff with jitter for 429/503 responses

### Scopes Required

**Service account (bot):**
| Scope | Notes |
|---|---|
| `https://www.googleapis.com/auth/chat.bot` | Default scope, no admin approval needed. Bot can send messages to spaces where it is a member. |
| `https://www.googleapis.com/auth/chat.app.*` | App-level scopes, require one-time Google Workspace admin approval. |

**User OAuth:**
| Scope | Use-case |
|---|---|
| `https://www.googleapis.com/auth/chat.messages.create` | Send messages on behalf of a user |
| `https://www.googleapis.com/auth/chat.messages` | Full message access |
| `https://www.googleapis.com/auth/chat.spaces.readonly` | List spaces the user is in |
| `https://www.googleapis.com/auth/chat.memberships.readonly` | See space members |

**For webhooks:** No OAuth scopes — the URL itself is the credential.

**Bot membership requirement:** When using service account + `chat.bot`, the bot must be manually added to the target space, OR create the space via API (bot auto-joins). Bot cannot send to spaces it's not a member of.

---

## SDK Availability

### Python (mira-bots, mira-pipeline)

```bash
# Low-level — use if you want httpx (already used in workspace_client.py)
pip install google-auth google-auth-httpx PyJWT

# High-level client library (wraps discovery API)
pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

# Chat-specific
pip install google-apps-chat
```

MIRA already uses the manual httpx approach in `workspace_client.py` — consistent with the project's httpx-only HTTP policy. Stick with that pattern.

Service account usage with google-auth:
```python
from google.oauth2 import service_account
import google.auth.transport.requests

creds = service_account.Credentials.from_service_account_info(
    sa_dict,
    scopes=["https://www.googleapis.com/auth/chat.bot"]
)
creds.refresh(google.auth.transport.requests.Request())
token = creds.token
```

### TypeScript / Node.js (mira-hub)

```bash
# Official Google API client for Node
npm install googleapis

# Chat-specific
npm install @googleapis/chat

# Auth only
npm install google-auth-library
```

Usage in mira-hub route handlers:
```typescript
import { google } from "googleapis";

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: storedRefreshToken });

const drive = google.drive({ version: "v3", auth });
const files = await drive.files.list({ q: "trashed = false", fields: "files(id,name)" });
```

---

## Implementation Notes for MIRA

### Adding Scopes to the Existing OAuth Flow

The current `mira-hub/src/app/api/auth/google/route.ts` requests:
```
drive.readonly, gmail.readonly, userinfo.email, userinfo.profile
```

To add Calendar and Chat user-auth scopes, append to the `SCOPES` array:
```typescript
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",               // add: outbound alerts
  "https://www.googleapis.com/auth/calendar.events",          // add: PM event create/update
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",  // add: list their calendars
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");
```

Because `prompt=consent` and `access_type=offline` are already set, existing users will see the consent screen again when they re-authorize. Store all granted scopes in `bindings.scopes` (already done by callback route) and check before calling an API.

### Service Account vs User Delegation — Decision Matrix

For MIRA Hub's per-tenant architecture:
- **Use user OAuth tokens** (stored in `bindings` table) for Drive, Gmail, Calendar — these act on the user's personal data
- **Use service account** (Doppler key, project-wide) for Chat bot messages — bot identity, not user identity
- **Use webhooks** (not service account, not user OAuth) for Chat alerts until bot interactions are needed

### Shared Drive for Enterprise KB Sync

If enterprise customers store OEM manuals in a Google Shared Drive:
1. Customer Workspace admin adds the service account email as a Shared Drive member (Viewer or Content Manager)
2. No user OAuth needed — service account can access the Shared Drive directly
3. Call `files.list` with `corpora=drive&driveId=SHARED_DRIVE_ID&includeItemsFromAllDrives=true&supportsAllDrives=true`
4. Export Docs to text/pdf via `files.export` for KB ingestion into Qdrant

### Token Storage Pattern

Tokens are stored in the `bindings` table per tenant. The `ensureFreshAccessToken("google", tenantId)` function in `token-refresh.ts` handles expiry detection and refresh automatically. Access tokens expire in 1 hour; refresh tokens are long-lived (until revoked or 6 months of non-use for test apps).

Keep OAuth app in "Testing" status during dev (100-user limit). Submit for verification before production launch to remove the "unverified app" warning and the 100-user cap.

### Key Gotchas

1. **Drive webhooks expire after 1 day (files) or 1 week (changes)** — need a scheduler in mira-hub to renew. Store channel expiry in DB.
2. **Gmail push requires Cloud Pub/Sub** — more infra than Drive webhooks. For MVP, poll `messages.list` hourly instead.
3. **Chat service account must be a space member** — bot cannot post to a space until it's been added. Document this in the setup guide for customers.
4. **Google Workspace Marketplace approval** required to publish a Chat bot publicly; not required for internal/webhook use.
5. **`prompt=consent` always required** to reliably get a refresh_token — without it, Google only returns refresh_token on first authorization.
6. **Sensitive scopes** (`gmail.send`, `calendar.events`) trigger Google's OAuth verification review — budget 1-4 weeks for approval before production.
7. **Service account DWD** — works only for Google Workspace orgs (paid accounts). Regular Gmail users cannot enable DWD.
8. **`files.export` size limit** — Google Docs exported as PDF are capped at 10MB. Very large documents must be handled in chunks or exported as plain text.
9. **Calendar `extendedProperties.private`** — per-user, not shared with event attendees. Safe to store MIRA internal IDs there.

---

## Links

- Drive API v3 reference: https://developers.google.com/drive/api/reference/rest/v3
- Drive push notifications guide: https://developers.google.com/drive/api/guides/push
- Drive search query syntax: https://developers.google.com/drive/api/guides/search-files
- Gmail API reference: https://developers.google.com/gmail/api/reference/rest
- Gmail push notifications (Pub/Sub): https://developers.google.com/gmail/api/guides/push
- Calendar API v3 reference: https://developers.google.com/calendar/api/v3/reference
- Calendar create events guide: https://developers.google.com/calendar/api/guides/create-events
- Chat API reference: https://developers.google.com/workspace/chat/api/reference/rest
- Chat incoming webhooks: https://developers.google.com/workspace/chat/quickstart/webhooks
- Chat auth guide (service accounts): https://developers.google.com/workspace/chat/api/guides/auth/service-accounts
- OAuth 2.0 scopes reference: https://developers.google.com/identity/protocols/oauth2/scopes
- Service accounts + DWD: https://developers.google.com/identity/protocols/oauth2/service-account
- google-api-python-client docs: https://googleapis.github.io/google-api-python-client/docs/dyn/
