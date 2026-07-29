# mira-bots/shared — Core Diagnostic Engine

Core diagnostic engine and shared infrastructure used by all bot adapter containers
(Telegram, Slack). Nothing in this module is platform-specific.

## Entry Point

`engine.py` — `Supervisor` class. Instantiate once per bot adapter process.

```python
Supervisor(db_path, openwebui_url, api_key, collection_id,
           vision_model="qwen2.5vl:7b", tenant_id=None)
```

- `process(chat_id, message, photo_b64)` — main entry point, returns reply string
- `process_full(chat_id, message, photo_b64)` — returns `{"reply", "confidence", "trace_id", "next_state"}`
- `reset(chat_id)` — clear conversation state back to IDLE
- `log_feedback(chat_id, feedback, reason)` — write thumb-up/down to `feedback_log` table

## FSM States

`STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]`

Additional states not in order: `ASSET_IDENTIFIED`, `ELECTRICAL_PRINT`, `SAFETY_ALERT`.

State is persisted per `chat_id` in SQLite (`conversation_state` table, WAL mode).
`_advance_state()` validates proposed transitions — invalid LLM states hold at current.

## Workers (workers/)

| File | Class | Purpose |
|------|-------|---------|
| `vision_worker.py` | `VisionWorker` | Runs GLM-OCR + qwen2.5vl:7b via Ollama |
| `rag_worker.py` | `RAGWorker` | Retrieves knowledge, calls LLM for diagnostic reply |
| `print_worker.py` | `PrintWorker` | Handles ELECTRICAL_PRINT follow-up questions |
| `plc_worker.py` | `PLCWorker` | **Stub** — deferred to Config 4 |
| `nameplate_worker.py` | `NameplateWorker` | Vision extraction of nameplate fields |
| `photo_ingest_worker.py` | _module-level_ `propose_from_nameplate()` | Writes nameplate extraction as an `ai_suggestions` proposal to NeonDB; closes the photo→KG demo loop |

Workers are instantiated in `Supervisor.__init__` and shared across calls.
`photo_ingest_worker` is a module-level function (no class) — called from
`_handle_nameplate` via `asyncio.to_thread` because psycopg2 is sync.

## Guardrails (guardrails.py)

`classify_intent(message)` — returns `"safety" | "industrial" | "greeting" | "help" | "off_topic"`

Safety bypasses all conversation state — fires `SAFETY_ALERT` immediately.

`SAFETY_KEYWORDS` — 22 phrases (arc flash, lockout, smoke, exposed wire, etc.).
`INTENT_KEYWORDS` — industrial fault vocabulary used for routing.
`MAINTENANCE_ABBREVIATIONS` — expands shorthand before vector search ("mtr trpd" -> "motor tripped").

`check_output(response, intent, has_photo)` — strips hallucination artifacts (industrial
jargon in greetings, transcription artifacts in text-only messages).

`detect_session_followup(message, session_context, fsm_state)` — short-circuits intent
classification for active sessions containing follow-up signals ("you said", "link", etc.).

`expand_abbreviations(message)` / `rewrite_question(message, asset_identified)` — query
normalization before RAG retrieval.

## Inference Router (inference/router.py)

`InferenceRouter` — multi-provider LLM cascade with automatic failover.

- Cascade order: Groq → Cerebras → Together → (caller falls back to Open WebUI)
- Enabled when `INFERENCE_BACKEND=cloud` AND at least one provider API key is set
- Provider enablement is key-based: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHERAI_API_KEY` (Anthropic removed PR #610)
- All three providers use the OpenAI-compatible chat-completions API
- Vision (since v3.162.2, 2026-07-18): **Groq has NO vision models** (all delisted — `GROQ_VISION_MODEL` defaults empty, image requests skip Groq); the free image carrier is **Together `google/gemma-3n-E4B-it`** (`TOGETHERAI_VISION_MODEL` default via the `or`-form parse — compose `${VAR:-}` delivers empty strings). Qualification law: **Together catalog per-token pricing ≠ serverless access** — gemma-3n is the ONLY vision model this account reaches serverless (every Qwen-VL/Llama-4/Kimi/GLM id rejects "non-serverless"); verify any replacement id with a live micro-probe before shipping it
- Image requests use provider's `vision_model` if set; providers without a vision model are skipped for images
- `complete(messages, max_tokens, session_id)` — tries each provider, returns first success
- `sanitize_context(messages)` — strips IPv4, MAC addresses, serial numbers before sending
- `write_api_usage()` — persists token counts + provider name to `api_usage` table in mira.db
- Returns `("", {})` only when ALL providers fail — caller then falls back to Open WebUI

System prompt loaded from `prompts/diagnose/active.yaml` on every call (zero-downtime rollout).

## Confidence Scoring

`_infer_confidence(reply)` — keyword heuristic, returns `"high" | "medium" | "low" | "none"`.

High signals: "replace", "fault code", "check wiring", "disconnect", "de-energize".
Low signals: "might be", "could be", "possibly", "not sure".

## Common Pitfalls

- `photo_b64` must be a base64 string, not raw bytes
- `chat_id` is a string; Telegram sends ints — cast before calling
- `plc_worker.py` is a stub — instantiating it is safe, calling it is a no-op
- History capped at `MIRA_HISTORY_LIMIT` (default 20) turns to avoid context overflow
- `_parse_response()` tries three JSON extraction strategies before falling back to plain text
