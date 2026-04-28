# MIRA Adapter Architecture

**Updated:** 2026-04-28  
**Status:** Production (Telegram, Slack, Teams, GChat, Email deployed); WhatsApp migrating; WebChat planned

---

## What This Doc Is

MIRA's diagnostic engine can respond on any messaging channel — Telegram, Slack, Microsoft Teams, WhatsApp, Email — because the business logic is completely separated from the delivery layer. This doc explains that separation, maps the current implementation, and defines what a new adapter needs to implement to plug in a new channel.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     DELIVERY LAYER                          │
│   (platform-specific: auth, webhooks, message formatting)   │
│                                                             │
│  Telegram   Slack    Teams   GChat   Email  WhatsApp  ...   │
│  bot.py     bot.py   bot.py  bot.py  bot.py  bot.py         │
│    │          │        │       │       │        │           │
│  TelegramCA SlackCA  TeamsCA GChatCA EmailCA  WA_CA        │
│  (chat_adapter.py per platform)                             │
└───────────────────────┬─────────────────────────────────────┘
                        │  NormalizedChatEvent
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   DISPATCH LAYER                            │
│                                                             │
│              ChatDispatcher                                 │
│   ┌─────────────────────────────────────────────┐          │
│   │  rate limiting · identity resolution        │          │
│   │  photo extraction · chat_id scoping         │          │
│   └─────────────────────────────────────────────┘          │
│                        │                                    │
└────────────────────────┼────────────────────────────────────┘
                         │  (chat_id, message, photo_b64)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  INTELLIGENCE LAYER                         │
│                                                             │
│              Supervisor (shared/engine.py)                  │
│   ┌────────┬──────────┬─────────────┬────────────────────┐ │
│   │  FSM   │ Guardrails│  Inference  │   Workers          │ │
│   │        │           │  Router     │   RAG/Vision/Print │ │
│   └────────┴──────────┴─────────────┴────────────────────┘ │
│                                                             │
│   Input:  (chat_id: str, message: str, photo_b64: str?)    │
│   Output: {"reply", "confidence", "trace_id", "next_state"} │
└─────────────────────────────────────────────────────────────┘
```

The engine knows nothing about Telegram, Slack, or WhatsApp. It only sees:
- A `chat_id` string (scoped by the dispatcher to `{platform}:{channel_id}`)
- A `message` string
- An optional `photo_b64` string

It always returns a plain text reply plus FSM metadata. The adapter's job is to translate from and back to the platform.

---

## The ChatAdapter Contract

**File:** `mira-bots/shared/chat/adapter.py`

Every platform adapter implements this Protocol:

```python
class ChatAdapter(Protocol):
    platform: str  # "telegram" | "slack" | "teams" | "gchat" | "email" | "whatsapp" | "webchat"

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert platform-specific payload to a NormalizedChatEvent."""
        ...

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send the response back to the platform (posts to API, sends TwiML, etc.)."""
        ...

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Download an attachment using platform-specific auth."""
        ...
```

This is a `runtime_checkable` Protocol (structural typing), not an ABC. You don't inherit — you just implement the three methods.

---

## Core Data Types

**File:** `mira-bots/shared/chat/types.py`

### NormalizedChatEvent (inbound)

```python
@dataclass
class NormalizedChatEvent:
    event_id: str
    platform: str              # "telegram" | "slack" | ...
    tenant_id: str             # MIRA tenant (used for engine routing)
    user_id: str               # canonical MIRA user ID (post identity-resolution)
    external_user_id: str      # platform-native user ID
    external_channel_id: str   # platform-native channel/chat ID
    external_thread_id: str    # thread ID if threaded (Slack/Teams)
    text: str
    attachments: list[NormalizedAttachment]
    event_type: str            # "message" | "mention" | "dm" | "file_share" | "command" | "photo"
    command: str               # "/mira" | "/work-order" | ...
    command_args: str
    timestamp: datetime
    raw: dict                  # original payload for debugging
```

### NormalizedChatResponse (outbound)

```python
@dataclass
class NormalizedChatResponse:
    text: str                  # plain-text fallback — always required
    blocks: list[ResponseBlock]  # rich content blocks (optional)
    thread_id: str             # reply in thread if set
    ephemeral: bool            # only visible to requester (Slack only)
    files: list[dict]          # file attachments to send back
    suggestions: list[str]     # suggestion chips (mobile-friendly)
```

### ResponseBlock kinds
`header`, `paragraph`, `bullet_list`, `key_value`, `button_row`, `divider`, `image`, `code`, `citation`, `warning`, `suggestion_chips`

Renderers in `shared/chat/renderers/` translate these to platform-specific formats:
- `slack_blocks.py` → Slack Block Kit JSON
- `teams_cards.py` → Adaptive Cards JSON
- `gchat_cards.py` → Google Chat Card JSON
- Telegram and Email use Markdown/HTML directly from `response.text`

---

## The Dispatcher

**File:** `mira-bots/shared/chat/dispatcher.py`

```python
class ChatDispatcher:
    def __init__(self, engine: Supervisor, identity_service: IdentityService | None = None)
    async def dispatch(self, event: NormalizedChatEvent) -> NormalizedChatResponse
```

What the dispatcher does that adapters don't need to:
- **Rate limiting** — 10 messages / 60s per `chat_id` (configurable via `RATE_LIMIT_MESSAGES`)
- **Identity resolution** — maps `external_user_id` → canonical MIRA user via `IdentityService`
- **Chat ID scoping** — constructs `{platform}:{channel}:{thread}` as the FSM session key
- **Photo extraction** — pulls `attachment.data` bytes → base64 for the engine
- **Engine call** — `Supervisor.process(chat_id, message, photo_b64)`

---

## Current Channel Status

| Channel | Adapter file | Pattern | Status |
|---------|-------------|---------|--------|
| Telegram | `telegram/chat_adapter.py` (165 lines) | ChatAdapter Protocol | **Production** |
| Slack | `slack/chat_adapter.py` (97 lines) | ChatAdapter Protocol | **Production** |
| Microsoft Teams | `teams/chat_adapter.py` (154 lines) | ChatAdapter Protocol | **Production** |
| Google Chat | `gchat/chat_adapter.py` (146 lines) | ChatAdapter Protocol | **Production** |
| Email | `email/chat_adapter.py` (204 lines) | ChatAdapter Protocol | **Production** |
| WhatsApp | `whatsapp/bot.py` — `WhatsAppAdapter` (legacy MIRAAdapter) | Legacy ABC | **Needs migration** |
| WebChat | — | — | **To build** |
| SMS (Twilio) | — | — | **Planned (post-MVP)** |
| Reddit | `reddit/bot.py` (standalone, no adapter pattern) | None | **Not integrated** |

---

## How Each Platform Bot Is Structured

Every `{platform}/bot.py` follows the same pattern:

```python
# 1. Init engine (once per process)
engine = Supervisor(db_path=..., openwebui_url=..., api_key=..., collection_id=...)

# 2. Init adapter (holds platform credentials)
adapter = SlackChatAdapter(bot_token=SLACK_BOT_TOKEN, signing_secret=SLACK_SIGNING_SECRET)

# 3. Init dispatcher (wires adapter to engine)
dispatcher = ChatDispatcher(engine)

# 4. Platform-specific receive loop
async def handle_message(raw_event: dict):
    event = await adapter.normalize_incoming(raw_event)
    response = await dispatcher.dispatch(event)
    await adapter.render_outgoing(response, event)
```

The engine, dispatcher, and types are shared across all platforms. Only the adapter and the receive loop (polling vs webhook vs Bot Framework) differ.

---

## Building a New Adapter: Step-by-Step

### What you need
1. **`{channel}/chat_adapter.py`** — implement the three Protocol methods
2. **`{channel}/bot.py`** — platform-specific receive loop + adapter/engine wiring
3. **`{channel}/Dockerfile`** — each channel runs as a separate container
4. **Doppler secrets** — `{CHANNEL}_*` credentials added to `factorylm/prd`
5. **`docker-compose.yml` entry** — `mira-bot-{channel}` service
6. **Hub channels page** — add `ConnectorCard` in `mira-hub/src/app/(hub)/channels/page.tsx`

### Receive loop patterns by platform type

| Platform type | Receive mechanism | Example |
|---|---|---|
| Polling bot | Long-poll loop | Telegram (`python-telegram-bot` `run_polling()`) |
| Event webhook | FastAPI POST endpoint | Slack Events API, Twilio |
| Bot Framework | Bot Framework SDK | Microsoft Teams |
| Push webhook | Google Pub/Sub or HTTP push | Google Chat |
| IMAP/SES | Email polling or SNS → Lambda | Email |
| REST API | Caller hits our endpoint | WebChat widget |

---

## Per-Channel Implementation Effort

### Already built (zero work)
| Channel | Notes |
|---|---|
| Telegram | Full production — polling, photo, voice stub |
| Slack | Block Kit rendering, thread scoping, file MIME allowlist |
| Teams | Bot Framework + Adaptive Cards + Graph API attachment download |
| Google Chat | Cards v2, event webhook |
| Email | SES inbound → SNS → FastAPI, thread tracking, PDF attachments |

### WhatsApp — migration needed (~2 hours)
**Current:** `WhatsAppAdapter(MIRAAdapter)` in `whatsapp/bot.py` — custom ABC, no `normalize_incoming`  
**Target:** `WhatsAppChatAdapter(ChatAdapter)` in `whatsapp/chat_adapter.py`  
**Work:** Extract Twilio webhook parsing into `normalize_incoming()`, Twilio reply into `render_outgoing()`, TwiML response stays in `bot.py`. Voice MMS → transcribe path needed.

### WebChat widget — new build (~4 hours)
**Target:** `webchat/chat_adapter.py` + `webchat/bot.py` (FastAPI SSE endpoint)  
**What it does:** Embeddable `<script>` snippet → JS widget → SSE or WebSocket → FastAPI → dispatcher → engine  
**Formatting:** Markdown → HTML in `render_outgoing()`. No Block Kit needed.  
**Auth:** Per-tenant `MIRA_WIDGET_KEY` in query string or `Authorization` header  

### SMS (Twilio) — planned (~2 hours after WhatsApp)
**Shares:** Twilio credentials, webhook validation, TwiML response format  
**Difference:** No media, 1600-char message limit, no markdown  
**When:** Post-MVP — ship WhatsApp first, SMS reuses 80% of its adapter

### Reddit — not in scope
`reddit/bot.py` exists as a standalone bot (comment monitoring, not a support channel). Not a customer-facing MIRA channel.

---

## WhatsApp Migration Plan

### Current (legacy)
```
Twilio webhook → bot.py → WhatsAppAdapter.send_text() → engine.process() → TwiML
```

### Target (modern)
```
Twilio webhook → bot.py → WhatsAppChatAdapter.normalize_incoming()
                        → ChatDispatcher.dispatch()
                        → WhatsAppChatAdapter.render_outgoing() → TwiML
```

`whatsapp/chat_adapter.py` — implements ChatAdapter Protocol:
- `normalize_incoming`: parses `From`, `Body`, `NumMedia`, `MediaUrl0` → `NormalizedChatEvent`
- `render_outgoing`: formats reply as TwiML `<Response><Message>` via Twilio REST API
- `download_attachment`: HTTP GET with Twilio Basic auth → bytes

---

## WebChat Widget Design

### API contract (`webchat/bot.py`)

```
POST /chat           — send message, get reply (JSON)
GET  /chat/stream    — SSE stream for typing indicator + streaming reply
GET  /health         — liveness check
```

### Embed snippet (hosted by mira-web)

```html
<script src="https://app.factorylm.com/widget.js"
        data-tenant="acme-corp"
        data-key="wk_live_..."></script>
```

The widget renders a chat bubble that posts to the WebChat bot endpoint. No iframe needed — pure JS overlay.

### `webchat/chat_adapter.py` — implements ChatAdapter Protocol
- `normalize_incoming`: JSON body `{tenant_id, user_id, text, image_b64?}` → `NormalizedChatEvent`
- `render_outgoing`: Markdown → HTML, JSON response `{reply, suggestions, confidence}`
- `download_attachment`: base64-decode the `image_b64` field (no external URL)

---

## Hub Channels Page (Current State)

**File:** `mira-hub/src/app/(hub)/channels/page.tsx`

### Section 1: Messaging Channels
| Channel | Status in Hub |
|---------|--------------|
| Telegram | `ConnectorCard` with bot-token config modal |
| Slack | `ConnectorCard` with OAuth flow |
| Microsoft Teams | `ConnectorCard` with Azure OAuth |
| WhatsApp | `ConnectorCard` — `comingSoon: true` |
| Email | `ConnectorCard` — `infoOnly: true` (enabled via Google/Microsoft connection) |
| Open WebUI | `ConnectorCard` with URL config modal |

### What to add for WebChat
When the WebChat adapter ships, add a `ConnectorCard` to the hub page:
```tsx
<ConnectorCard
  emoji="🌐" name="Web Widget"
  description="Embeddable chat widget for your internal maintenance portal"
  conn={webchatConn}
  onConnect={() => setModal("webchat")}  // shows embed snippet + API key
  onDisconnect={() => disconnect("webchat")}
  connectedLabel={webchatConn.workspace ?? "Widget active"}
/>
```

The modal should show: tenant API key (from `MIRA_WIDGET_KEY`), embed `<script>` snippet, and a copy button.

---

## What Ships This Week vs Later

### This week (in this PR)
- `docs/ADAPTER_ARCHITECTURE.md` — this document
- `mira-bots/whatsapp/chat_adapter.py` — WhatsApp migrated to ChatAdapter Protocol
- `mira-bots/shared/chat/adapters/webchat.py` — WebChat adapter skeleton

### Next sprint
- `mira-bots/webchat/bot.py` — FastAPI SSE endpoint
- `mira-bots/webchat/Dockerfile`
- Hub channels page — WebChat `ConnectorCard`
- `mira-web` widget JS embed snippet

### Post-MVP
- SMS via Twilio (reuses WhatsApp adapter scaffolding)
- Reddit integration (full ChatAdapter pattern, not just standalone bot)
- Voice channel (Twilio Voice → transcription → engine → TTS reply)

---

## Glossary

| Term | Definition |
|------|-----------|
| **ChatAdapter** | Protocol in `shared/chat/adapter.py` — 3 methods every adapter must implement |
| **ChatDispatcher** | Orchestrator in `shared/chat/dispatcher.py` — rate limiting, identity, engine call |
| **Supervisor** | The MIRA diagnostic engine in `shared/engine.py` — FSM + RAG + LLM |
| **NormalizedChatEvent** | Platform-agnostic inbound message type |
| **NormalizedChatResponse** | Platform-agnostic outbound response type |
| **MIRAAdapter** | Legacy ABC in `shared/adapters/base.py` — used only by WhatsApp (being replaced) |
| **chat_id** | Session key = `{platform}:{channel_id}[:{thread_id}]` — scopes FSM state |
