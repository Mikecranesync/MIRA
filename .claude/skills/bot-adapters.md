---
name: bot-adapters
description: MIRA bot adapter pattern — 4 platform implementations, how to add a new adapter, Docker patterns, env vars per platform
---

# Bot Adapters

## Source Files

- `mira-bots/telegram/bot.py` — most mature adapter; reference implementation
- `mira-bots/slack/bot.py` — Socket Mode; channel allowlist; dedup set
- `mira-bots/teams/bot.py` — Microsoft Teams adapter
- `mira-bots/whatsapp/bot.py` — WhatsApp adapter
- `mira-bots/shared/gsd_engine.py` — shared engine imported by all adapters

---

## Adapter Pattern

All four adapters share the same structure:

```
1. Import GSDEngine from shared/gsd_engine.py
2. Instantiate engine with env vars at module load
3. Register platform-specific event handlers
4. Each handler:
   a. Extract chat_id (platform-specific session key)
   b. Extract text and optional photo/file
   c. Resize image to MAX_VISION_PX if photo (cuts latency)
   d. Call engine.process(chat_id, text, photo_b64=...) → reply
   e. Send reply through platform API
```

The `GSDEngine` (and underlying `Supervisor`) is platform-agnostic. The adapter's only job is translating platform events into `(chat_id, text, photo_b64)`.

---

## Platform Implementations

### Telegram (most mature)
**File:** `mira-bots/telegram/bot.py`
**Library:** `python-telegram-bot`
**Commands:** `/equipment`, `/faults`, `/status`, `/reset`, `/voice on|off`, `/bad`, `/help`
**Photo handling:** `PHOTO_BUFFER` dict batches rapid multi-photo sends (4-second window). Batched photos get a single combined reply.
**PDF ingest:** Document handler sends PDF bytes to `MCP_BASE_URL/ingest/pdf` via httpx.
**Voice:** `/voice on` enables TTS via `shared/tts.py` → OGG voice message.
**Session key:** `str(update.effective_chat.id)`

Key env vars:
```
TELEGRAM_BOT_TOKEN      (required)
OPENWEBUI_BASE_URL      default: http://mira-core:8080
OPENWEBUI_API_KEY
MCP_BASE_URL            default: http://mira-mcp:8001
MCP_REST_API_KEY
KNOWLEDGE_COLLECTION_ID
INGEST_SERVICE_URL      optional: enables background photo ingest
MIRA_DB_PATH            default: /data/mira.db
MIRA_TENANT_ID
VISION_MODEL            default: qwen2.5vl:7b
MAX_VISION_PX           default: 1024
```

### Slack
**File:** `mira-bots/slack/bot.py`
**Library:** `slack-bolt` (AsyncApp, Socket Mode)
**Event triggers:** `app_mention` + `message` events (dedup set `_SEEN_EVENTS` prevents double-fire)
**Commands:** `/mira-equipment`, `/mira-faults`, `/mira-status`, `/mira-reset`, `/mira-help`
**Channel allowlist:** `SLACK_ALLOWED_CHANNELS` (comma-separated channel IDs); if empty, responds everywhere
**PDF ingest:** delegates to `slack/pdf_handler.py → ingest_pdf()`
**Session key:** `slack:{channel_id}:{thread_ts}` — threads are isolated diagnostic sessions

Additional env vars beyond common set:
```
SLACK_BOT_TOKEN         (required)
SLACK_APP_TOKEN         (required, Socket Mode)
SLACK_ALLOWED_CHANNELS  optional: comma-separated channel IDs
```

### Teams
**File:** `mira-bots/teams/bot.py`
**Session key:** Teams-specific conversation ID

### WhatsApp
**File:** `mira-bots/whatsapp/bot.py`
**Session key:** WhatsApp phone number or conversation ID

---

## Image Resize (All Adapters)

All adapters call `_resize_for_vision(image_bytes)` before base64-encoding:

```python
MAX_PX = int(os.getenv("MAX_VISION_PX", "1024"))  # Telegram default
MAX_PX = int(os.getenv("MAX_VISION_PX", "512"))   # Slack default
img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
# Save as JPEG quality=85, return bytes
```

This cuts qwen2.5vl:7b encoder latency from ~12s to ~3s on M4 Mini.

---

## Docker Compose Pattern

Each bot is its own service with its own Dockerfile:

```
mira-bots/
├── telegram/
│   ├── bot.py
│   └── Dockerfile
├── slack/
│   ├── bot.py
│   ├── pdf_handler.py
│   └── Dockerfile
├── teams/
│   └── Dockerfile
├── whatsapp/
│   └── Dockerfile
└── shared/           # imported by all, not a container
    ├── gsd_engine.py
    ├── engine.py
    ├── guardrails.py
    ├── inference/router.py
    └── workers/
```

Compose excerpt pattern:
```yaml
mira-bot-telegram:
  build: ./mira-bots/telegram
  restart: unless-stopped
  networks: [bot-net, core-net]
  environment:
    - TELEGRAM_BOT_TOKEN
    - MIRA_DB_PATH=/data/mira.db
  volumes:
    - ./mira-bridge/data:/data
  healthcheck:
    test: ["CMD", "python3", "-c", "import bot"]
    interval: 30s
    timeout: 10s
    retries: 3
```

---

## How to Add a New Adapter

1. Create `mira-bots/<platform>/bot.py`
2. Import `from shared.gsd_engine import GSDEngine`
3. Instantiate engine the same way as existing adapters
4. Implement event handler:
   - Derive a unique `chat_id` string (must be consistent across turns for the same conversation)
   - Extract text and optional photo bytes
   - Call `_resize_for_vision()` if photo
   - Call `await engine.process(chat_id, text, photo_b64=b64)`
5. Create `mira-bots/<platform>/Dockerfile` (copy an existing one as template)
6. Add service to `mira-bots/docker-compose.yml`
7. Add platform-specific env vars to `.env.template` with documentation

---

## Shared Engine Import

All adapters import the engine the same way:

```python
from shared.gsd_engine import GSDEngine

engine = GSDEngine(
    db_path=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
    openwebui_url=OPENWEBUI_BASE_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=KNOWLEDGE_COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
)
```

`GSDEngine` wraps `Supervisor` from `engine.py`. The Supervisor is the authoritative entry point.
