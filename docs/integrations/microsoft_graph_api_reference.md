# Microsoft Graph API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

---

## Auth Method

Microsoft Graph uses **OAuth 2.0 via Microsoft Entra ID** exclusively. All API calls require a bearer token in the `Authorization` header.

### Two permission models

**Delegated permissions** — the app acts on behalf of a signed-in user. The token represents both the app and the user. Requires an interactive login flow (Authorization Code or Device Code). Users can consent to lower-privilege scopes themselves; admins must consent to sensitive scopes.

**Application permissions** — the app acts as itself with no user context (daemon/service). Uses **Client Credentials flow**: `client_id` + `client_secret` (or certificate) → token. No user required. Almost always requires **admin consent** from a tenant administrator.

### Token endpoint
```
POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
```
For multi-tenant apps use `common` or `organizations` in place of `{tenant_id}`.

### Common scopes MIRA will need

| Scope | Type | What it grants | Admin consent? |
|---|---|---|---|
| `Mail.Read` | Delegated / Application | Read email messages | Delegated: No / Application: Yes |
| `Mail.Send` | Delegated / Application | Send email as user or app | Delegated: No / Application: Yes |
| `Calendars.Read` | Delegated / Application | Read calendar events | Delegated: No / Application: Yes |
| `Calendars.ReadWrite` | Delegated / Application | Create/edit calendar events | Delegated: No / Application: Yes |
| `Files.Read.All` | Delegated / Application | Read all files (OneDrive, SharePoint) | Delegated: No / Application: Yes |
| `Files.ReadWrite.All` | Delegated / Application | Read/write all files | Delegated: No / Application: Yes |
| `Sites.Read.All` | Delegated / Application | Read SharePoint sites | Delegated: No / Application: Yes |
| `User.Read` | Delegated | Read signed-in user's profile | No |
| `User.Read.All` | Application | Read all user profiles in tenant | Yes |
| `ChannelMessage.Read.All` | Application | Read Teams channel messages | Yes |
| `Chat.Read` / `Chat.ReadWrite` | Delegated | Read/write Teams chats for signed-in user | No |

**Rule of thumb for MIRA**: Background service workers reading mail/files/calendar without user interaction need **Application permissions** and require a one-time admin consent grant in the customer's tenant.

---

## Key Endpoints We Need

**Base URL:** `https://graph.microsoft.com/v1.0/` (stable, production)
Use `https://graph.microsoft.com/beta/` only for preview features — do not take production dependencies on beta.

### Email (Outlook / Exchange Online)

| Endpoint | Method | What it does | Required permission |
|---|---|---|---|
| `/me/messages` | GET | List messages in signed-in user's mailbox | `Mail.Read` (delegated) |
| `/users/{userId}/messages` | GET | List messages for a specific user | `Mail.Read` (application) |
| `/me/messages/{messageId}` | GET | Get a single message (all properties) | `Mail.Read` |
| `/me/sendMail` | POST | Send an email immediately | `Mail.Send` |
| `/me/messages` | POST | Create a draft message | `Mail.ReadWrite` |
| `/me/messages/{messageId}/send` | POST | Send a previously created draft | `Mail.Send` |
| `/me/messages/{messageId}/reply` | POST | Reply to a message | `Mail.Send` |
| `/me/messages/{messageId}/forward` | POST | Forward a message | `Mail.Send` |
| `/me/mailFolders/{folderId}/messages` | GET | List messages in a specific folder | `Mail.Read` |

**Message object key properties:** `id`, `subject`, `body` (HTML or text), `from`, `toRecipients`, `ccRecipients`, `bccRecipients`, `receivedDateTime`, `sentDateTime`, `hasAttachments`, `isDraft`, `isRead`, `importance`, `conversationId`, `internetMessageId`

**Recipient limit:** Maximum 500 total recipients (to + cc + bcc) per message from Exchange Online.

### Calendar (Outlook / Exchange Online)

| Endpoint | Method | What it does | Required permission |
|---|---|---|---|
| `/me/events` | GET | List calendar events | `Calendars.Read` |
| `/me/events` | POST | Create a calendar event | `Calendars.ReadWrite` |
| `/me/events/{eventId}` | PATCH | Update an event | `Calendars.ReadWrite` |
| `/me/events/{eventId}` | DELETE | Delete an event | `Calendars.ReadWrite` |
| `/me/calendarView?startDateTime=&endDateTime=` | GET | Get events in a time window | `Calendars.Read` |
| `/me/findMeetingTimes` | POST | Suggest optimal meeting times for attendees | `Calendars.Read` |

### OneDrive / Files

| Endpoint | Method | What it does | Required permission |
|---|---|---|---|
| `/me/drive/root/children` | GET | List files in root of user's OneDrive | `Files.Read` |
| `/me/drive/items/{itemId}` | GET | Get a file item by ID | `Files.Read` |
| `/me/drive/root:/{path}` | GET | Get a file by path | `Files.Read` |
| `/me/drive/items/{itemId}/content` | GET | Download file content | `Files.Read` |
| `/me/drive/root/children` | POST | Upload a new file | `Files.ReadWrite` |
| `/drives/{driveId}/items/{itemId}` | GET | Access a specific SharePoint drive item | `Files.Read.All` |

### SharePoint

| Endpoint | Method | What it does | Required permission |
|---|---|---|---|
| `/sites/{siteId}` | GET | Get a SharePoint site | `Sites.Read.All` |
| `/sites/{siteId}/drives` | GET | List document libraries in a site | `Sites.Read.All` |
| `/sites/{siteId}/lists` | GET | List SharePoint lists | `Sites.Read.All` |
| `/sites/{siteId}/lists/{listId}/items` | GET | List items in a SharePoint list | `Sites.Read.All` |

### Teams (via Graph)

| Endpoint | Method | What it does | Required permission |
|---|---|---|---|
| `/users/{userId}/teamwork/installedApps` | POST | Proactively install a Teams app for a user | `TeamsAppInstallation.ReadWriteForUser.All` |
| `/chats/{chatId}/messages` | GET | Read messages in a Teams chat | `Chat.Read` |
| `/teams/{teamId}/channels/{channelId}/messages` | GET | Read channel messages | `ChannelMessage.Read.All` |
| `/me/joinedTeams` | GET | List teams the user is a member of | `Team.ReadBasic.All` |

---

## Webhook / Event Capabilities

Microsoft Graph uses **change notification subscriptions** — you register a webhook endpoint and Graph pushes notifications when resources change.

**Create a subscription:**
```
POST https://graph.microsoft.com/v1.0/subscriptions
{
  "changeType": "created,updated",
  "notificationUrl": "https://your-mira-host/graph/notifications",
  "resource": "/me/messages",
  "expirationDateTime": "2026-05-05T00:00:00Z",
  "clientState": "your-secret-validation-string"
}
```

**Key subscribable resources:**

| Resource | Change types | Use case |
|---|---|---|
| `/me/messages` | created, updated, deleted | Incoming email monitoring |
| `/me/events` | created, updated, deleted | Calendar change alerts |
| `/me/drive/root` | updated | OneDrive file changes |
| `/communications/calls` | — | Teams call state changes |
| `/chats/{chatId}/messages` | created | New Teams chat messages |
| `/teams/{teamId}/channels/{channelId}/messages` | created | New channel messages |

**Subscription management:**
- Subscriptions expire (max ~3 days for most resources, up to 4230 minutes)
- Must renew via `PATCH /subscriptions/{id}` before expiry
- Validation: Graph sends a POST with a `validationToken` query param to your endpoint on creation — respond with `200 OK` and the token as plain text within 10 seconds
- Payload is a lightweight notification (resource URL + change type); you must call Graph separately to fetch the changed data

**Prefer change tracking (delta queries)** over subscriptions for bulk polling — use `/me/messages/delta` to get incremental changes without per-item polling.

---

## Rate Limits

Graph throttling is **service-specific** and does not publish fixed per-minute numbers in the main docs. The pattern is consistent:

- Throttled request returns **HTTP 429 Too Many Requests**
- Response includes a `Retry-After` header (seconds to wait)
- If no `Retry-After` header: use exponential backoff
- Throttling can be per-app, per-tenant, or per-user depending on the service

**Key throttling rules:**
- Throttling is evaluated per service (Outlook, SharePoint, OneDrive, Teams each have their own limits)
- Both reads and writes are throttled, but high-volume writes are more likely to trigger throttling
- Error codes 412, 502, and 504 should also be retried (not just 429)
- **Bulk data access**: Use Microsoft Graph Data Connect (Azure Data Factory pipeline) instead of REST APIs for large-scale extractions — Data Connect bypasses throttling limits

**Graph SDK retry behavior:** The official Graph SDKs include a built-in retry handler that respects `Retry-After` and implements exponential backoff automatically. Use the SDK rather than raw HTTP for robustness.

**JSON batching**: Combine up to 20 requests in a single HTTP call using `POST /v1.0/$batch`. Each sub-request is evaluated individually against throttling; throttled sub-requests return 429 within the 200 batch response. Retry only the failed sub-requests.

---

## SDK Availability

| SDK | Language | Package | Notes |
|---|---|---|---|
| Microsoft Graph Python SDK | Python | `msgraph-sdk` (v1+) | Async support; built-in auth, retry, pagination handlers |
| Microsoft Graph JavaScript SDK | JavaScript/TypeScript | `@microsoft/microsoft-graph-client` | Browser + Node |
| Microsoft Graph .NET SDK | C# | `Microsoft.Graph` | Fluent API |
| MSAL (auth only) | Python | `msal` | Token acquisition; use alongside graph SDK |
| MSAL (auth only) | JavaScript | `@azure/msal-node` | Token acquisition for Node services |
| Azure Identity | Python | `azure-identity` | `ClientSecretCredential`, `DeviceCodeCredential`, `InteractiveBrowserCredential` — recommended auth layer |

**Recommended Python pattern for MIRA:**
```python
from azure.identity import ClientSecretCredential
from msgraph import GraphServiceClient

credential = ClientSecretCredential(
    tenant_id=os.getenv("AZURE_TENANT_ID"),
    client_id=os.getenv("AZURE_CLIENT_ID"),
    client_secret=os.getenv("AZURE_CLIENT_SECRET"),
)
client = GraphServiceClient(credentials=credential, scopes=["https://graph.microsoft.com/.default"])
```

**npm equivalent for Node services:**
```
npm install @microsoft/microsoft-graph-client @azure/identity
```

---

## Implementation Notes for MIRA

### Azure App Registration (one per customer tenant or MIRA's own tenant)
1. Register in Azure Entra ID → note `tenant_id`, `client_id`
2. Add a client secret → note `client_secret` (store in Doppler `factorylm/prd`)
3. Under API Permissions, add the Microsoft Graph permissions MIRA needs
4. For **Application permissions**: click "Grant admin consent for [tenant]" — a tenant admin must do this, or MIRA must redirect them through the admin consent URL:
   ```
   https://login.microsoftonline.com/{tenant_id}/adminconsent?client_id={client_id}
   ```
5. For **multi-tenant MIRA SaaS**: register as a multi-tenant app; each customer org's admin must grant consent separately

### Delegated vs Application — MIRA Decision Guide
- **Background diagnostic workers** (read maintenance logs, email alerts, OEM files from SharePoint): use **Application permissions** — no user session needed
- **User-triggered actions** (send email on behalf of tech, create calendar event): use **Delegated permissions** — requires the technician to have signed in at least once
- **Proactive Teams bot installs**: use **Application permissions** (`TeamsAppInstallation.ReadWriteForUser.All`) — admin consent required

### Admin Consent Requirement — Customer Impact
Most permissions MIRA needs for unattended operation require a customer's Microsoft 365 admin to grant consent. This is a **sales/onboarding friction point**: plan a guided admin consent flow in the MIRA Hub activation sequence (similar to how mira-relay handles Ignition activation).

### Versioning
- Always use `v1.0` endpoint in production — beta APIs break without notice
- Check the [Graph changelog](https://developer.microsoft.com/graph/changelog) before upgrading SDK major versions

### Gotchas
- **Subscription `notificationUrl` must be HTTPS** and publicly reachable — local dev requires ngrok or tunnel; mira-relay is the right candidate for this endpoint in production
- **Subscription expiry**: Outlook message subs expire in ~3 days; set up a background job to renew before expiry
- **User vs `/me`**: Application-permission requests must use `/users/{userId}` not `/me` — `/me` only works with delegated tokens
- **Immutable IDs**: Message IDs change when items are moved between folders; use `Prefer: IdType="ImmutableId"` header if you need stable IDs across moves
- **Exchange Online recipient limit**: 500 recipients max per send call
- **`clientState` validation on webhooks**: always validate the `clientState` on incoming notifications to prevent spoofed webhook calls

---

## Links

- Graph overview: https://learn.microsoft.com/en-us/graph/overview
- Graph API v1.0 reference: https://learn.microsoft.com/en-us/graph/api/overview?view=graph-rest-1.0
- Message resource (email): https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
- Throttling guidance: https://learn.microsoft.com/en-us/graph/throttling
- Service-specific throttling limits: https://learn.microsoft.com/en-us/graph/throttling-limits
- Change notifications (webhooks): https://learn.microsoft.com/en-us/graph/change-notifications-overview
- msgraph-sdk-python: https://github.com/microsoftgraph/msgraph-sdk-python
- Graph Explorer (live API tester): https://developer.microsoft.com/graph/graph-explorer
