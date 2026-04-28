# Slack API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

---

## Auth Method

**OAuth 2.0 (three-step flow)**

1. **Request scopes** — Redirect users to:
   ```
   https://slack.com/oauth/v2/authorize?client_id=YOUR_ID&scope=SCOPES&redirect_uri=HTTPS_CALLBACK
   ```
   - `scope` = bot token scopes (comma-separated), e.g. `chat:write,channels:read,channels:history,app_mentions:read`
   - `user_scope` = optional user token scopes (separate param)
   - Include a `state` param and validate it on return to prevent CSRF

2. **User approves** — Slack redirects back to your `redirect_uri` with a temporary `code` (valid 10 minutes)

3. **Exchange code for token** — POST to:
   ```
   https://slack.com/api/oauth.v2.access
   ```
   Params: `code`, `client_id`, `client_secret`, `redirect_uri`

   Response includes:
   - `access_token` — Bot token (`xoxb-...`), used for all API calls
   - `bot_user_id` — Bot's Slack user ID
   - `scope` — Granted scopes
   - `authed_user.access_token` — User token (`xoxp-...`) if user scopes were requested

**Token usage:** All Web API calls use `Authorization: Bearer xoxb-YOUR-BOT-TOKEN` header.

Tokens do not expire but can be revoked via `auth.revoke`. Store securely (Doppler `factorylm/prd`).

---

## Key Endpoints We Need

All methods POST to `https://slack.com/api/<method>` with `Authorization: Bearer xoxb-...`.

| Method | HTTP | What it does | Required params | Rate tier |
|--------|------|--------------|-----------------|-----------|
| `chat.postMessage` | POST | Send a message to a channel or DM | `channel`, one of: `text` or `blocks` | Special: 1 msg/sec/channel |
| `chat.postEphemeral` | POST | Send a message visible only to one user | `channel`, `user`, `text` | Tier 4 |
| `conversations.list` | POST | List all channels the bot can see | — (paginate with `cursor`) | Tier 2 (20+/min) |
| `conversations.history` | POST | Fetch message history for a channel | `channel` | Tier 3 (50+/min) |
| `conversations.replies` | POST | Fetch a message thread | `channel`, `ts` (parent msg timestamp) | Tier 3 |
| `conversations.members` | POST | List members of a channel | `channel` | Tier 4 |
| `users.list` | POST | List all users in workspace | — (paginate with `cursor`) | Tier 2 |
| `users.info` | POST | Get profile for one user | `user` | Tier 4 |
| `reactions.add` | POST | Add emoji reaction to a message | `channel`, `name` (emoji name), `timestamp` | Tier 3 |
| `auth.test` | POST | Verify token and get bot identity | — | Tier 4 |

**Sending a threaded reply:** Include `thread_ts` (the `ts` of the parent message) in `chat.postMessage`. Add `reply_broadcast: true` to also surface it in the main channel.

**Blocks vs text:** Use `text` as a fallback. Rich messages use the `blocks` array (Block Kit format). Always include `text` even when using `blocks` — it's used for notifications and accessibility.

---

## Webhook / Event Capabilities

**Delivery methods (choose one per app):**
- **HTTP (Events API)** — Slack POSTs events to your public HTTPS endpoint
- **Socket Mode** — Persistent WebSocket; no public endpoint needed (good for dev/internal tools)

**Setup:** Enable Event Subscriptions in app settings → provide your Request URL → subscribe to event types.

**URL Verification (one-time, on endpoint registration):**
Slack sends:
```json
{ "type": "url_verification", "challenge": "abc123xyz", "token": "legacy_token" }
```
Respond immediately with: `{ "challenge": "abc123xyz" }` (HTTP 200, `Content-Type: application/json`)

**Event payload format** (all subscribed events):
```json
{
  "type": "event_callback",
  "team_id": "T12345",
  "api_app_id": "A12345",
  "event_id": "Ev12345",
  "event_time": 1700000000,
  "event": {
    "type": "app_mention",
    "user": "U12345",
    "text": "<@BOTID> help with pump 4",
    "ts": "1700000000.000100",
    "channel": "C12345",
    "event_ts": "1700000000.000100"
  },
  "authorizations": [{ "enterprise_id": null, "team_id": "T12345", "user_id": "U12345", "is_bot": true }]
}
```

**Signature verification (REQUIRED — verify every request):**
```python
import hmac, hashlib, time

def verify_slack_signature(signing_secret: str, body: bytes, timestamp: str, signature: str) -> bool:
    # Reject requests older than 5 minutes (replay attack prevention)
    if abs(time.time() - float(timestamp)) > 300:
        return False
    basestring = f"v0:{timestamp}:{body.decode('utf-8')}".encode()
    computed = "v0=" + hmac.new(signing_secret.encode(), basestring, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature)

# Headers to read: X-Slack-Signature, X-Slack-Request-Timestamp
```
Use `hmac.compare_digest` — never `==` — to prevent timing attacks.

**Key event types for MIRA:**

| Event type | Scope required | Trigger |
|-----------|---------------|---------|
| `app_mention` | `app_mentions:read` | Bot is @-mentioned in any channel |
| `message.channels` | `channels:history` | Message posted in public channel bot is in |
| `message.groups` | `groups:history` | Message in private channel bot is in |
| `message.im` | `im:history` | Direct message to the bot |
| `message.mpim` | `mpim:history` | Group DM including the bot |
| `reaction_added` | `reactions:read` | User adds emoji to a message |
| `member_joined_channel` | `channels:read` | User joins a channel |

**Retry behavior:** Slack retries up to 3 times with exponential backoff (~1 min, then ~5 min). Retry headers: `x-slack-retry-num` (attempt number), `x-slack-retry-reason`. To suppress retries for a known-good event: respond with `x-slack-no-retry: 1`. Must respond HTTP 2xx within **3 seconds**.

**Event rate cap:** 30,000 events per workspace per app per 60 minutes. Exceeding this triggers `app_rate_limited` events.

---

## Rate Limits

Web API rate limits are per method, per workspace, evaluated per minute:

| Tier | Limit | Example methods |
|------|-------|----------------|
| Tier 1 | 1+ req/min | Rarely-used admin methods |
| Tier 2 | 20+ req/min | `conversations.list`, `users.list` |
| Tier 3 | 50+ req/min | `conversations.history`, `conversations.replies`, `reactions.add` |
| Tier 4 | 100+ req/min | `chat.postEphemeral`, `users.info`, `auth.test` |
| Special | 1 msg/sec/channel | `chat.postMessage` |

When exceeded: `HTTP 429 Too Many Requests` with `Retry-After: <seconds>` header. Design for 1 req/sec baseline; Slack tolerates occasional bursts.

---

## SDK Availability

**Python — two packages, use both:**

| Package | Install | Purpose |
|---------|---------|---------|
| `slack_sdk` | `pip install slack-sdk` | Low-level: WebClient, AsyncWebClient, OAuth, Socket Mode |
| `slack_bolt` | `pip install slack-bolt` | High-level framework: event routing, middleware, OAuth flow |

```python
# Low-level send (slack_sdk)
from slack_sdk import WebClient
client = WebClient(token="xoxb-...")
client.chat_postMessage(channel="#mira-alerts", text="Pump 4 anomaly detected")

# Async (AsyncWebClient)
from slack_sdk.web.async_client import AsyncWebClient
client = AsyncWebClient(token="xoxb-...")
await client.chat_postMessage(channel="C12345", text="...")

# Event handling (slack_bolt)
from slack_bolt import App
app = App(token="xoxb-...", signing_secret="...")
@app.event("app_mention")
def handle_mention(event, say):
    say(f"On it! Diagnosing {event['text']}")
```

**Node.js:**
- `@slack/web-api` — `npm install @slack/web-api` — WebClient
- `@slack/bolt` — `npm install @slack/bolt` — Full framework

---

## Implementation Notes for MIRA

1. **Bot token scopes to request at install time:**
   `chat:write`, `app_mentions:read`, `channels:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`, `reactions:read`

2. **The `ts` field is the message ID** — it's a string timestamp like `"1700000000.000100"`. You need it to reply in a thread (`thread_ts`) or add a reaction (`timestamp`).

3. **Bot only receives DMs if explicitly added** — `im:history` scope alone isn't enough; the user must open a DM with the bot. Use `message.im` event.

4. **`app_mention` fires even in DMs** — but only in channels. For DMs, use `message.im`. For full coverage, subscribe to both.

5. **Respond to Slack events within 3 seconds** — if your LLM cascade takes longer (it will), immediately return HTTP 200 and process asynchronously. Use the response URL or `chat.postMessage` to send the reply once ready. Slack will retry if you don't respond in time.

6. **Channel IDs vs names** — Always use channel IDs (`C12345`) in API calls, not display names. IDs are stable; names change. `conversations.list` gives you the mapping.

7. **Rate limit guard for MIRA:** At 1 msg/sec/channel cap on `chat.postMessage`, if MIRA sends bulk alerts to the same channel queue them with a 1-second delay.

8. **Competing event consumers** — Only one Slack app can consume each event stream. Unlike Telegram, there's no multi-consumer issue, but make sure Socket Mode and HTTP mode aren't both enabled for the same app.

9. **Block Kit for rich diagnostics** — Use blocks to send structured fault reports with sections, fields, and action buttons. Text-only messages are fine for MVP.

10. **`WaId` field equivalent** — In Slack, the unique user identifier is the `user` field in the event (e.g., `"U12345"`). Combined with `team_id` it's globally unique.

---

## Links

- Slack app management console: https://api.slack.com/apps
- OAuth v2 install flow: https://docs.slack.dev/authentication/installing-with-oauth
- Events API guide: https://docs.slack.dev/apis/events-api/
- Signature verification: https://docs.slack.dev/authentication/verifying-requests-from-slack
- Python SDK (slack_sdk): https://docs.slack.dev/tools/python-slack-sdk
- chat.postMessage reference: https://docs.slack.dev/reference/methods/chat.postMessage
- Block Kit Builder (interactive UI designer): https://app.slack.com/block-kit-builder
