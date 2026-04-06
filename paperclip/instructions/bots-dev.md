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

## FSM States

```
IDLE -> ASSET_IDENTIFIED -> Q1 -> Q2 -> Q3 -> DIAGNOSIS -> FIX_STEP -> RESOLVED
                                                       |
                                                 SAFETY_ALERT
                                                 ELECTRICAL_PRINT
```

State is stored per chat_id in SQLite `conversation_state` table. Workers dispatch based on state + input type (photo, text, safety keyword match).

## Adapter Pattern

All adapters share the same structure:
1. Import GSDEngine from shared/gsd_engine.py
2. Extract platform-specific chat_id, text, optional photo
3. Resize image to MAX_VISION_PX if photo
4. Call `engine.process(chat_id, text, photo_b64=...)` -> reply
5. Send reply through platform API

The adapter's only job is translating platform events into `(chat_id, text, photo_b64)`.

## Inference Routing

- `INFERENCE_BACKEND=claude` + `ANTHROPIC_API_KEY` -> Claude API via httpx
- `INFERENCE_BACKEND=local` -> Open WebUI -> Ollama (qwen2.5vl:7b)
- Vision ALWAYS stays local regardless of backend
- PII sanitization (`sanitize_context()`) strips IPs, MACs, serial numbers before Claude calls
- System prompt loaded fresh from `active.yaml` on every call (zero-downtime updates)

## Safety Keywords (21 triggers)

Defined in `guardrails.py`. If any match, FSM short-circuits to SAFETY_ALERT:
> "STOP -- describe the hazard. De-energize the equipment first."

## Standards

- Python 3.12, ruff formatting, httpx for HTTP
- All handlers async (`asyncio_mode = "auto"`)
- Catch specific exceptions, never bare `except:`
- LLM calls return fallback value on error, never raise to user
- Logging via `logging` stdlib, never `print()`

## Testing

```bash
# Run diagnostic pipeline tests
pytest tests/ -k "regime4" -v

# Full offline suite
pytest tests/ -v
```
