# Microsoft Teams Bot Framework API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

---

## Auth Method

Teams bots use **OAuth 2.0 via Microsoft Entra ID (formerly Azure AD)** with two distinct flows:

### Bot-to-Bot-Service Auth (always required)
The bot authenticates to the Bot Connector Service using **client credentials flow** (app ID + client secret or certificate). This is the baseline auth that lets your bot send/receive messages via the Bot Framework relay.

- Register an app in Azure Entra ID → get an **App ID** (client_id) and **Client Secret**
- Bot Framework Token Service issues bearer tokens; these are sent on every outbound API call
- Token endpoint: `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`
- Scope: `https://api.botframework.com/.default`

### SSO / User-Delegated Auth (optional, for Graph access on behalf of user)
When the bot needs to act as the user (read their files, calendar, etc.):

- Uses **OBO (On-Behalf-Of)** flow: Teams sends a token to the bot, the bot exchanges it at Entra ID for a Graph token
- Requires configuring an **OAuth Connection** in the Bot Framework registration (Azure Portal → Bot resource → OAuth Connections)
- SSO is supported in personal scope and group chat; **not** supported in channel scope
- App users consent once; Bot Framework Token Store caches the token
- Key scopes for SSO: `openid`, `profile`, `email` — then add Graph scopes as needed (`User.Read`, `Files.Read`, etc.)
- Admin consent required for high-privilege scopes (e.g., `Sites.ReadWrite.All`)

### App Manifest Requirement
The `webApplicationInfo` section in the Teams app manifest must declare the Entra app ID and application ID URI (`api://botid-{bot-app-id}`) to enable token exchange.

---

## Key Endpoints We Need

All bot messaging goes through the **Bot Connector Service**. The `serviceUrl` is provided in every incoming activity from Teams and must be used for replies. For proactive messages, use the global fallback URLs below.

| Endpoint | Method | What it does | Required params |
|---|---|---|---|
| `{serviceUrl}/v3/conversations` | POST | Create a new conversation (1:1 or channel thread) | `bot.id`, `members[].id`, `channelData.tenant.id` |
| `{serviceUrl}/v3/conversations/{conversationId}/activities` | POST | Send a message or Adaptive Card into a conversation | `conversationId`, activity payload (type, text or attachments) |
| `{serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}` | PUT | Update an existing message in-place | `conversationId`, `activityId`, updated activity body |
| `{serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}` | DELETE | Delete an existing bot message | `conversationId`, `activityId` |
| `{serviceUrl}/v3/conversations/{conversationId}/members` | GET | List members of a conversation/channel | `conversationId` |
| `https://smba.trafficmanager.net/teams/` | — | Global public service URL for proactive messages (use when no incoming `serviceUrl` available) | — |

**Adaptive Cards:** Sent as part of the activity payload under `attachments`, with `contentType: "application/vnd.microsoft.card.adaptive"`. Supported in Teams for interactive notifications, forms, and action buttons.

**Proactive messages flow:**
1. Store `conversationId`, `tenantId`, and `serviceUrl` from any incoming activity OR retrieve via Graph API
2. Call `continueConversation(conversationReference, callback, appId)` via Bot Framework SDK
3. Inside callback, call `turnContext.sendActivity(...)`

---

## Webhook / Event Capabilities

Teams delivers events to the bot's **messaging endpoint** (a public HTTPS URL you register during bot setup) as HTTP POST requests. The bot must respond with HTTP 200 within a few seconds.

**Key activity types received:**

| Activity type | When it fires |
|---|---|
| `message` | User sends a message to the bot |
| `conversationUpdate` | Bot added/removed from team or chat; members added/removed (`membersAdded`, `membersRemoved`) |
| `messageReaction` | User reacts to a message with an emoji |
| `invoke` | Action from an Adaptive Card button, message extension, or SSO token exchange |
| `installationUpdate` | App installed or uninstalled in a team/chat |
| `event` | Subscription-based notification events (e.g., meeting start/end) |

There is no separate webhook subscription management for Teams bots — all events are pushed to your registered messaging endpoint automatically once the app is installed in a Team or chat.

---

## Rate Limits

Limits are per-bot-per-thread (single conversation). The global app-wide cap is **50 Requests Per Second (RPS) per app per tenant**.

| Scenario | Window | Max operations |
|---|---|---|
| Send to conversation (per bot) | 1 sec | 7 |
| Send to conversation (per bot) | 2 sec | 8 |
| Send to conversation (per bot) | 30 sec | 60 |
| Send to conversation (per bot) | 3600 sec | 1800 |
| Create conversation (per bot) | 1 sec | 7 |
| Create conversation (per bot) | 3600 sec | 1800 |
| Get conversation members (per bot) | 3600 sec | 3600 |
| Send to conversation (all bots combined) | 1 sec | 14 |
| Send to conversation (all bots combined) | 2 sec | 16 |

- Throttled requests return HTTP **429 Too Many Requests**
- Also retry on: 412, 502, 504
- Recommended strategy: exponential backoff with random jitter (2s min, 20s max, ±20% delta)
- Rate limits are subject to change; do not hardcode thresholds — implement adaptive backoff

---

## SDK Availability

| SDK | Language | Package | Status |
|---|---|---|---|
| Teams SDK (recommended, formerly Teams AI Library) | JavaScript/TypeScript | `@microsoft/teams-ai` | GA |
| Teams SDK | C# | `Microsoft.Teams.AI` | GA |
| Teams SDK | Python | `teams-ai` | Developer preview |
| Bot Framework SDK v4 | Python | `botbuilder-core`, `botbuilder-integration-aiohttp` | Active (legacy path) |
| Bot Framework SDK v4 | JavaScript | `botbuilder` | Active (legacy path) |
| Bot Framework SDK v4 | C# | `Microsoft.Bot.Builder` | Active (legacy path) |
| Microsoft 365 Agents SDK | C#, JS, Python | `microsoft-agents` | New recommended framework |

**Note:** The classic Bot Framework SDK GitHub repo has been archived and support ended December 31, 2025. Microsoft now recommends the **Microsoft 365 Agents SDK** for new projects targeting Teams, or the **Teams SDK** for Teams-specific builds. Existing botbuilder-python code still runs but should be migrated.

**Python install (legacy path, still functional):**
```
pip install botbuilder-core botbuilder-integration-aiohttp botframework-connector
```

---

## Implementation Notes for MIRA

### Azure App Registration
1. Create an app registration in Azure Entra ID (portal.azure.com → Entra ID → App registrations)
2. Note the **Application (client) ID** — this is the bot's `MicrosoftAppId`
3. Create a **Client Secret** under Certificates & secrets → this is `MicrosoftAppPassword`
4. Set the Application ID URI to `api://botid-{MicrosoftAppId}` for SSO
5. Under Expose an API, add the scope `access_as_user`
6. Under Authorized client applications, add Teams client IDs: `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams desktop/mobile) and `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams web)

### Azure Bot Resource
- Create an **Azure Bot** resource (not a Bot Channels Registration — that's being retired)
- Set the messaging endpoint to your MIRA service URL: `https://<your-host>/api/messages`
- Add the **Microsoft Teams** channel in the bot resource
- Configure OAuth connections here if using SSO / Graph-on-behalf-of

### Teams App Manifest
- The manifest (`manifest.json`) must include a `bots` section with the bot's App ID
- Set `supportsFiles`, `isNotificationOnly`, and `scopes` (personal, team, groupchat) as needed
- For proactive installs, the app must be in your org's app catalog (Teams Admin Center upload)
- Package as a `.zip` (manifest + two icon files) and sideload for dev; publish via Teams Admin Center for org-wide

### MIRA-specific Gotchas
- **Proactive messages require prior installation**: The bot cannot cold-message a user who has never installed the app; use Graph API (`/v1.0/users/{id}/teamwork/installedApps`) to proactively install first
- **`serviceUrl` must not be hardcoded**: Capture it from the first incoming activity and persist it (per tenant, per conversation) — it can differ by region
- **Channel scope SSO**: SSO token exchange is not supported in channel scope; fall back to OAuth card flow for channel bots needing user identity
- **403 `MessageWritesBlocked`**: User has blocked or uninstalled the bot; log this per-user to avoid repeated attempts
- **`aadObjectId` vs `userId`**: The `aadObjectId` (Entra user GUID) is portable across bots; `userId` is bot-specific. Use `aadObjectId` for Graph lookups and proactive message targeting
- **Government cloud**: Use dedicated service URLs for GCC/GCC-High/DoD — do not use the public `smba.trafficmanager.net` endpoint

---

## Links

- Teams bots overview: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/overview
- Send proactive messages: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
- Rate limiting for bots: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit
- Bot SSO overview: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-overview
- Teams SDK (formerly Teams AI Library): https://learn.microsoft.com/en-us/microsoftteams/platform/teams-ai-library/welcome
- Microsoft 365 Agents SDK migration guide: https://aka.ms/bfmigrationguidance
- Teams samples repo: https://github.com/OfficeDev/Microsoft-Teams-Samples
