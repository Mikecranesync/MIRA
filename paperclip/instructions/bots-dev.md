# MIRA Bots Developer Agent

You develop and maintain the bot adapters and diagnostic engine in `mira-bots/`.

## Your Scope

- `mira-bots/shared/engine.py` — Supervisor FSM, worker dispatch, state persistence
- `mira-bots/shared/gsd_engine.py` — GSDEngine wrapper used by adapters
- `mira-bots/shared/guardrails.py` — Intent classification, safety keywords, output validation
- `mira-bots/shared/inference/router.py` — InferenceRouter (Claude API + Open WebUI)
- `mira-bots/shared/workers/` — vision, RAG, print, PLC workers
- `mira-bots/telegram/bot.py` — Reference adapter implementation
- `mira-bots/slack/bot.py` — Slack Socket Mode adapter
- `mira-bots/teams/bot.py`, `mira-bots/whatsapp/bot.py` — Other adapters
- `mira-bots/prompts/diagnose/active.yaml` — System prompt (hot-reloadable)
- `mira-bridge/data/mira.db` — SQLite WAL shared state

## Standards

- Python 3.12, ruff formatting, httpx for HTTP
- All handlers async (`asyncio_mode = "auto"`)
- Catch specific exceptions, never bare `except:`
- LLM calls return fallback value on error, never raise to user
- Logging via `logging` stdlib, never `print()`

## Testing

```bash
pytest tests/ -k "regime4" -v    # Golden diagnostic cases
pytest tests/ -v                 # Full offline suite
```

---

## Domain Skill: FSM States & Transitions

```
IDLE -> ASSET_IDENTIFIED -> Q1 -> Q2 -> Q3 -> DIAGNOSIS -> FIX_STEP -> RESOLVED
                                                       |
                                                 SAFETY_ALERT
                                                 ELECTRICAL_PRINT
```

| State | Meaning |
|-------|---------|
| IDLE | No active session. Awaiting first message or photo. |
| ASSET_IDENTIFIED | Photo received; equipment identified by VisionWorker. |
| Q1 / Q2 / Q3 | GSD questioning rounds — one question + 2-4 options per turn. |
| DIAGNOSIS | Root cause identified; presenting likely cause. |
| FIX_STEP | Walking tech through one action step at a time. |
| RESOLVED | Tech confirmed fix worked. Session closes. |
| SAFETY_ALERT | Safety keyword matched — STOP issued, no further questions. |
| ELECTRICAL_PRINT | Photo classified as schematic; print_worker active. |

State stored per `chat_id` in SQLite `conversation_state` table (WAL mode).

### Worker Dispatch (`Supervisor.process_full()`)

```
message + optional photo_b64
    ├── safety keyword? → STOP reply, SAFETY_ALERT state
    ├── photo_b64 present?
    │       ├── VisionWorker → classification
    │       │   ├── ELECTRICAL_PRINT → print_worker path
    │       │   └── else → ASSET_IDENTIFIED
    │       └── no intent keywords → "I can see X, how can I help?"
    ├── ELECTRICAL_PRINT state (text follow-up)? → PrintWorker
    └── RAG path (default) → _call_with_correction() → RAGWorker
```

### Confidence Scoring (`_infer_confidence(reply)`)

**High signals:** replace, fault code, check wiring, part number, disconnect, de-energize, lockout
**Low signals:** might be, could be, possibly, not sure, uncertain, hard to say

LLM also returns `confidence` field in JSON response (HIGH|MEDIUM|LOW).

### Safety Keywords (21 triggers in `guardrails.py`)

`exposed wire, energized conductor, arc flash, lockout, tagout, loto, smoke, burn mark, melted insulation, electrical fire, shock hazard, rotating hazard, pinch point, entanglement, confined space, pressurized, caught in, crush hazard, fall hazard, chemical spill, gas leak`

If any match, `classify_intent()` returns `"safety"` and process_full() short-circuits:
> "STOP -- describe the hazard. De-energize the equipment first."

### Output Guardrails (`check_output()`)

Runs after every LLM call: strips "Transcribing..." artifacts, replaces industrial jargon in greeting responses, catches system prompt leakage.

---

## Domain Skill: Adapter Pattern

All adapters share the same structure:
1. Import `GSDEngine` from `shared/gsd_engine.py`
2. Extract platform-specific `chat_id`, text, optional photo
3. Resize image to `MAX_VISION_PX` if photo
4. Call `engine.process(chat_id, text, photo_b64=...)` -> reply
5. Send reply through platform API

### Platform-Specific Details

| Platform | Library | Session Key | Photo Handling |
|----------|---------|-------------|----------------|
| Telegram | python-telegram-bot | `str(update.effective_chat.id)` | PHOTO_BUFFER: 4s window batches multi-photo sends |
| Slack | slack-bolt (Socket Mode) | `slack:{channel_id}:{thread_ts}` | Dedup set `_SEEN_EVENTS` prevents double-fire |
| Teams | Bot Framework | Teams conversation ID | Bot Framework connector token for attachments |
| WhatsApp | WhatsApp Business API | Phone number / conversation ID | Pending cloud setup |

### Image Resize

```python
MAX_PX = int(os.getenv("MAX_VISION_PX", "1024"))  # Telegram
MAX_PX = int(os.getenv("MAX_VISION_PX", "512"))   # Slack
# JPEG quality=85, cuts qwen2.5vl encoder from ~12s to ~3s
```

### Docker Pattern

Each bot is its own service with own Dockerfile. Shared code (`shared/`) is imported, not containerized separately. All bots share SQLite volume at `/data/mira.db`.

---

## Domain Skill: Inference Routing

### Dual Backend

- `INFERENCE_BACKEND=claude` + `ANTHROPIC_API_KEY` → Claude API via httpx (direct, no SDK)
- `INFERENCE_BACKEND=local` → Open WebUI → Ollama (qwen2.5vl:7b)
- Vision ALWAYS stays local regardless of backend

### `InferenceRouter.complete()` Signature

```python
async def complete(messages, max_tokens=1024, session_id="unknown") -> tuple[str, dict]
# Returns ("", {}) on any error — caller falls through to Open WebUI
```

### Message Format Conversion

Router accepts OpenAI-style `image_url` blocks and converts to Claude's `image/source/base64` format automatically.

### PII Sanitization (`sanitize_context()`)

Static method — **callers must invoke explicitly**:
- IPv4 → `[IP]`, MAC → `[MAC]`, Serial numbers (S/N, SER#) → `[SN]`
- Applied to both `str` content and `text` blocks in multipart arrays

### Prompt Loading

`get_system_prompt()` loads `active.yaml` on every call. Edit the file → next inference picks it up. No restart needed.

### Usage Logging

Every Claude call writes to `api_usage` table in mira.db: tenant_id, platform, tokens, model, response_time_ms.

### Langfuse Telemetry

```python
from shared.telemetry import trace as tl_trace, span as tl_span
# Env: LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY
# Degrades gracefully if keys missing
```
