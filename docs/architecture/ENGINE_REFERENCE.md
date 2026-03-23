# MIRA Engine Reference
*Last updated: 2026-03-23*

## Supervisor Class (`mira-bots/shared/engine.py` — 833 lines)

The `Supervisor` class is the core brain. It orchestrates the full diagnostic
pipeline for every message received from any bot.

### Public Methods

**`process_full(chat_id, message, photo_b64=None) → dict`**
Main entry point called by all bots. Returns:
```python
{
    "reply": str,           # text to send back
    "confidence": str,      # "HIGH" | "MEDIUM" | "LOW"
    "trace_id": str,        # Langfuse trace ID
    "next_state": str,      # FSM state (e.g. "ELECTRICAL_PRINT", "RESOLVED")
    "options": list[str],   # numbered choice options for keyboard
}
```

**`_handle_session_followup(message, state, chat_id) → str`**
Called when `guardrails.detect_session_followup()` returns True. Continues an
active diagnostic thread without resetting context.

**`_infer_confidence(reply) → str`**
Static method. Reads the `confidence` field from the JSON reply returned by the
LLM. Returns `"HIGH"`, `"MEDIUM"`, or `"LOW"`.

**`_make_result(reply, confidence, trace_id, next_state, options) → dict`**
Helper that assembles the standard result dict.

### Session Context
Session state is stored in `state["context"]["session_context"]` (dict).
Persisted across messages via SQLite (`mira-bridge/data/mira.db`, WAL mode).

---

## Intent Classification (`mira-bots/shared/guardrails.py`)

**`classify_intent(message) → str`**
Returns one of:
- `"industrial"` — fault/maintenance related query
- `"greeting"` — hello, thanks, bye
- `"help"` — asking what MIRA can do
- `"safety"` — keywords like "arc flash", "lockout", "smoke"

Uses `INTENT_KEYWORDS` set + `_FAULT_CODE_RE` regex (matches codes like F-201, OC1, CE2).
Expands abbreviations via `expand_abbreviations()` before matching ("mtr trpd" → "motor tripped").

**`detect_session_followup(message, session_context, fsm_state) → bool`**
True when message continues an active session. Checked against `SESSION_FOLLOWUP_SIGNALS`.

**`check_output(response, intent, has_photo) → str`**
Validates LLM reply quality. Returns validated (or fallback) string.

---

## Inference Router (`mira-bots/shared/inference/router.py`)

Feature-flagged dual backend:

| `INFERENCE_BACKEND` | Routes to | Notes |
|---------------------|-----------|-------|
| `claude` | Anthropic API (httpx direct, no SDK) | Default for production |
| `local` | Open WebUI / Ollama | For offline/dev use |

**Vision stays local** regardless of `INFERENCE_BACKEND` — GLM-OCR and
`qwen2.5vl` always run on Ollama.

**System prompt:** Loaded from `mira-bots/prompts/diagnose/active.yaml` on
**every** request — zero-downtime rollout: swap the file, next call picks it up.

**PII sanitization:** Before sending to Claude API, strips IPv4 addresses,
MAC addresses, and serial numbers from message text (regex patterns in router.py).

---

## Prompt System

| File | Version | Status |
|------|---------|--------|
| `prompts/diagnose/active.yaml` | v0.3 "confidence-neon" | ACTIVE |
| `prompts/diagnose/v0.2-fault-ocr-proactive.yaml` | v0.2 | archived |
| `prompts/diagnose/v0.1-baseline.yaml` | v0.1 | archived |
| `prompts/diagnose/CHANGELOG.md` | — | version history |

**Active prompt model field:** `claude-3-5-haiku-20241022` (advisory metadata only —
actual model used is controlled by `CLAUDE_MODEL` env var in Doppler)

**Rollback prompt:**
```bash
cp mira-bots/prompts/diagnose/v0.1-baseline.yaml \
   mira-bots/prompts/diagnose/active.yaml
```

---

## RAG Pipeline (`mira-core/mira-ingest/db/neon.py`)

**`recall_knowledge(embedding, tenant_id, limit=5) → list[dict]`**
pgvector cosine similarity search. Returns top-5 knowledge entries.
```sql
ORDER BY embedding <=> cast(:emb AS vector)
```

**`insert_knowledge_entry(tenant_id, content, embedding, ...) → None`**
Inserts a chunked knowledge entry. `embedding` must be a `list[float]`.

**`knowledge_entry_exists(tenant_id, source_url, chunk_index) → bool`**
Deduplication guard — returns True if already ingested.

**`health_check() → dict`**
Returns `{"status": "ok", "tenant_count": N, "knowledge_entries": N}`.

**Implementation:** SQLAlchemy + NullPool (Neon PgBouncer handles pooling).
All functions are **synchronous** — no asyncio.

---

## Workers (`mira-bots/shared/workers/`)

| Worker | File | Purpose |
|--------|------|---------|
| VisionWorker | `vision_worker.py` | GLM-OCR → qwen2.5vl for photo analysis |
| RAGWorker | `rag_worker.py` | Knowledge retrieval from NeonDB |
| PLCWorker | `plc_worker.py` | Modbus/PLC bridge (DEFERRED — Config 4) |
| PrintWorker | `print_worker.py` | Print queue worker |

---

## Test Suite

### 5-Regime Test Infrastructure (`tests/`)

| Regime | Directory | Focus |
|--------|-----------|-------|
| 1 | `regime1_telethon/` | Live Telegram session replay |
| 2 | `regime2_rag/` | RAG retrieval precision + answer quality |
| 3 | `regime3_nameplate/` | Nameplate OCR accuracy |
| 4 | `regime4_synthetic/` | Synthetic tiered Q&A |
| 5 | `regime5_nemotron/` | Bulk QA generation |

Golden cases in `tests/regime1_telethon/golden_cases/v1/`.
Scoring in `tests/scoring/` (composite, contains_check, llm_judge, thresholds).

### Unit Tests (`mira-bots/tests/`)
- `test_conversation_continuity.py` — session context preservation across messages
- `test_inference_router.py` — Claude Vision API on 5 sample equipment tags
- `test_judge.py` — LLM judge scoring logic
- `test_typing_indicator.py` — typing state machine
- `test_wal_mode.py` — SQLite WAL mode verification
- `test_image_downscale.py` — ⚠️ expects 512px, code uses 1024px (pre-existing)
- `test_slack_relay.py` — ⚠️ import error in test env (pre-existing)
- `test_tts.py` — ⚠️ import error in test env (pre-existing)

### Telethon Test Runner (`mira-bots/telegram_test_runner/`)
Real Telegram session testing against live bot. Uses Telethon (user account).
Manifests: `test_manifest.yaml`, `test_manifest_100.yaml`, `test_manifest_case1.yaml`.
