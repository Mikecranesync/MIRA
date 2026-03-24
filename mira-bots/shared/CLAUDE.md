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

Workers are instantiated in `Supervisor.__init__` and shared across calls.

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

`InferenceRouter` — feature-flagged Claude API backend.

- Enabled when `INFERENCE_BACKEND=claude` AND `ANTHROPIC_API_KEY` is set
- Uses `httpx` directly — no Anthropic SDK
- `complete(messages, max_tokens, session_id)` — returns `(content_str, usage_dict)`
- `sanitize_context(messages)` — strips IPv4, MAC addresses, serial numbers before sending
- `write_api_usage()` — persists token counts to `api_usage` table in mira.db
- Falls back gracefully to Open WebUI path on any error (returns `"", {}`)

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
