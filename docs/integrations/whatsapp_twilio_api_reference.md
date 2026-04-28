# WhatsApp (via Twilio) API Reference
**For:** MIRA Hub integration | **Researched:** 2026-04-28

---

## Auth Method

**HTTP Basic Authentication** using Twilio Account credentials.

Every API request authenticates with:
- **Username:** `TWILIO_ACCOUNT_SID` (looks like `ACxxxxxxxxxxxxxxxxx`)
- **Password:** `TWILIO_AUTH_TOKEN`

Store both in Doppler `factorylm/prd`. The official Python SDK (`twilio`) handles this automatically when initialized:

```python
from twilio.rest import Client
client = Client(account_sid, auth_token)
```

No OAuth flow required for server-to-server API calls. For inbound webhooks (Twilio → your server), Twilio signs each request — verify with the `twilio` library's `RequestValidator`.

---

## Key Endpoints We Need

**Base URL:** `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/`

All WhatsApp addresses use E.164 format prefixed with `whatsapp:` — e.g. `whatsapp:+14155238886`.

| Operation | HTTP | Endpoint | Required params | Notes |
|-----------|------|----------|-----------------|-------|
| Send message (text) | POST | `/Messages.json` | `From`, `To`, `Body` | Both From/To must use `whatsapp:+...` format |
| Send message (media) | POST | `/Messages.json` | `From`, `To`, `MediaUrl` | Up to 16 MB per file; JPEG/PNG/PDF/audio |
| Send template | POST | `/Messages.json` | `From`, `To`, `ContentSid`, `ContentVariables` | Pre-approved template required for business-initiated messages |
| Get message status | GET | `/Messages/{MessageSid}.json` | — | Returns delivery status |
| List messages | GET | `/Messages.json` | — | Paginated; supports date filters |
| Status callback | — | Your URL (configured in console) | — | Twilio POSTs delivery events to this URL |

**Python SDK send example:**
```python
from twilio.rest import Client
import os

client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])

# Freeform message (within 24h session window)
message = client.messages.create(
    from_="whatsapp:+14155238886",
    to="whatsapp:+16285550100",
    body="Pump 4 fault detected — vibration exceeds threshold. Assign a work order?"
)
print(message.sid)  # e.g. SM1234567890abcdef

# Template message (business-initiated, outside 24h window)
message = client.messages.create(
    from_="whatsapp:+14155238886",
    to="whatsapp:+16285550100",
    content_sid="HXb5b62575e6e4ff6129ad7c8efe1f983e",
    content_variables='{"1": "Pump 4", "2": "vibration fault"}'
)
```

---

## Webhook / Event Capabilities

**Inbound messages (user → MIRA):**
Configure a webhook URL in Twilio Console under the WhatsApp Sender settings ("When a message comes in"). Twilio POSTs to this URL on every inbound message.

**Inbound webhook payload fields (POST form-encoded):**

| Field | Example | Description |
|-------|---------|-------------|
| `AccountSid` | `ACxxxxxxxxx` | Your Twilio account ID |
| `MessageSid` | `SMxxxxxxxxx` | Unique message ID |
| `From` | `whatsapp:+16285550100` | Sender's WhatsApp number |
| `To` | `whatsapp:+14155238886` | Your MIRA WhatsApp number |
| `Body` | `Pump 4 is leaking` | Message text content |
| `NumMedia` | `0` | Count of attached media files |
| `MediaUrl0` | `https://api.twilio.com/...` | First media file URL (if NumMedia > 0) |
| `MediaContentType0` | `image/jpeg` | MIME type of first media file |
| `WaId` | `16285550100` | Sender's WhatsApp ID (no `whatsapp:` prefix, no `+`) |
| `ProfileName` | `Mike Harper` | Sender's WhatsApp display name |

Additional media files use `MediaUrl1`, `MediaUrl2`, etc. up to the value of `NumMedia`.

**Signature verification (REQUIRED — verify every inbound webhook):**
```python
from twilio.request_validator import RequestValidator
import os

validator = RequestValidator(os.environ["TWILIO_AUTH_TOKEN"])

def verify_twilio_request(url: str, post_params: dict, signature: str) -> bool:
    return validator.validate(url, post_params, signature)

# The signature is in the X-Twilio-Signature header
# url must be the exact URL Twilio POSTed to (including query string if any)
# post_params is the parsed form body as a dict
```

**Status callbacks (outbound delivery tracking):**
Configure a `StatusCallback` URL when sending, or set a default in console. Twilio POSTs when status changes to: `queued`, `sent`, `delivered`, `read`, `failed`, `undelivered`.

```python
message = client.messages.create(
    from_="whatsapp:+14155238886",
    to="whatsapp:+16285550100",
    body="Work order WO-4421 created",
    status_callback="https://mira.example.com/webhooks/twilio/status"
)
```

**Respond to inbound messages with TwiML:**
```python
from twilio.twiml.messaging_response import MessagingResponse
from fastapi import Request, Response

@app.post("/webhooks/whatsapp")
async def whatsapp_webhook(request: Request):
    form_data = await request.form()
    # ... process message, call MIRA diagnostic engine ...
    resp = MessagingResponse()
    resp.message("Analyzing fault. Will respond in <30 seconds.")
    return Response(content=str(resp), media_type="text/xml")
```

---

## Rate Limits

Twilio does not publish a single WhatsApp rate limit figure publicly — it depends on your WhatsApp Business Account tier and Meta's messaging limits. Verified numbers from Twilio docs and sandbox behavior:

| Context | Limit |
|---------|-------|
| Sandbox (development) | 1 message every 3 seconds; max 50 messages/day on free trial |
| Production — inbound | No hard limit documented; design for concurrent processing |
| Production — outbound | Verify current limits in Twilio Console and Meta Business Manager |
| Message size | 16 MB per media file |
| Phone numbers per unverified Meta Business | 2 |
| Phone numbers per verified Meta Business | Up to 20 (50 via support) |

For production, check your specific messaging tier limits in the Twilio Console under "WhatsApp Senders." Meta imposes per-phone-number daily limits that increase as you build quality scores.

---

## SDK Availability

**Python (official):**
```bash
pip install twilio
```
- Package: `twilio` (version 9.10.5 as of 2026-04-14)
- Supports Python 3.7–3.13
- Async: yes — `AsyncTwilioHttpClient` + `*_async` methods
- Covers: Messages, Voice, TwiML, RequestValidator, Content API

**Node.js (official):**
```bash
npm install twilio
```
- Package: `twilio`
- Supports TypeScript out of the box

**No Twilio-specific Bolt/framework** — it's a REST client library. You handle webhook routing yourself (FastAPI recommended for MIRA).

---

## Implementation Notes for MIRA

1. **The 24-hour session window is critical.** WhatsApp only allows freeform (unstructured) messages within 24 hours of the user's last message to you. Outside that window, you MUST use a pre-approved Content Template (`ContentSid`). Templates must be submitted to Meta via Twilio Console and approved before use. Plan for a "re-engagement template" for dormant users.

2. **Explicit opt-in is mandatory.** WhatsApp requires users to explicitly opt in before receiving messages from your business number. Collect and store opt-in records. Twilio can be fined/banned for violations. For MIRA: add an opt-in step during onboarding (e.g., "Reply YES to receive MIRA alerts").

3. **`WaId` is your stable user identifier.** The `WaId` field in inbound webhooks (e.g., `16285550100`) is the user's WhatsApp ID without country code prefix. Combined with your WABA, it uniquely identifies the user. Use this as the key in NeonDB for session/conversation state.

4. **One WABA per Twilio account (currently).** Twilio enforces one WhatsApp Business Account per Twilio account. Plan your production number accordingly.

5. **Media download requires auth.** `MediaUrl0` URLs are Twilio-hosted and require Basic Auth to download. Use the Twilio Python client or pass credentials:
   ```python
   import httpx, base64
   creds = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
   async with httpx.AsyncClient() as c:
       r = await c.get(media_url, headers={"Authorization": f"Basic {creds}"})
   ```

6. **Sandbox vs production number.** The sandbox number (`+14155238886`) is shared — all Twilio sandbox users use it. For production, provision a dedicated WhatsApp-enabled Twilio number. Users must join the sandbox by sending `join <your-code>` — this is not scalable for production.

7. **Respond quickly but process async.** Twilio expects a response to the inbound webhook within a few seconds. Return TwiML immediately (even an empty `<Response/>`) and process the MIRA diagnostic engine asynchronously, then send the result via `client.messages.create`. This avoids webhook timeouts.

8. **Status: `read` requires user's WhatsApp read receipts to be on.** Don't rely on `read` status for delivery confirmation — use `delivered` as your success signal.

9. **Profile name in `ProfileName` field** — use this as the display name for MIRA's user context, since WhatsApp doesn't expose email. Map `WaId` → `ProfileName` in your user registry.

10. **No channel concept.** Unlike Slack, WhatsApp has no concept of channels. Every conversation is 1:1 between MIRA and a user, or within a WhatsApp group. Group messaging via Twilio's API has separate requirements — scope MIRA to 1:1 DMs for MVP.

---

## Links

- Twilio WhatsApp API overview: https://www.twilio.com/docs/whatsapp/api
- WhatsApp quickstart (Python): https://www.twilio.com/docs/whatsapp/quickstart
- WhatsApp Sandbox setup: https://www.twilio.com/docs/whatsapp/sandbox
- Twilio Python library (GitHub): https://github.com/twilio/twilio-python
- Twilio Console (manage numbers + webhooks): https://console.twilio.com/
- Request validation (signature verification): https://www.twilio.com/docs/usage/security
- WhatsApp Content Templates: https://www.twilio.com/docs/content-api
