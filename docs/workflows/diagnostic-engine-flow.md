# Diagnostic Engine Flow

> **Cross-links:**
> - `docs/architecture/ENGINE_REFERENCE.md` — ⚠️ STALE (dated 2026-03-23; says "833 lines", cites Anthropic as LLM backend). Actual engine is 5224 lines; Anthropic was removed in PR #610. Use for conceptual FSM reference only.
> - `docs/architecture/rag-pipeline.md` — ⚠️ STALE (dated 2026-03-28; `MIN_SIMILARITY=0.45`, lists Claude API as primary). Current code: `MIN_SIMILARITY=0.70`, cascade is Groq→Cerebras→Gemini. Use for SQL query structure reference only.
> - `docs/architecture/c4-dynamic-fault-flow.md` — ⚠️ STALE (references Claude API). FSM state sequence diagram is still structurally accurate.
>
> **Last verified:** 2026-06-06 against source on branch `docs/comprehensive-runbooks-2026-06-06`.

## Summary

A technician sends a message on Slack, Telegram, or email. The message passes through a thin platform adapter, hits `ChatDispatcher`, then enters the `Supervisor` in `mira-bots/shared/engine.py`. The engine runs intent classification, resolves UNS context, applies the gate (unless the turn arrives over a direct machine connection), retrieves grounding evidence from NeonDB via 4-stage hybrid RAG, runs the LLM cascade (Groq→Cerebras→Gemini), and returns a grounded reply with a citation compliance check. All state is persisted in SQLite WAL mode.

---

## The Flow

### Stage 0 — Platform adapter normalizes the event

**Files:** `mira-bots/slack/bot.py`, `mira-bots/telegram/bot.py`, `mira-bots/email/ses_webhook.py`
**Protocol:** `mira-bots/shared/chat/adapter.py` (`ChatAdapter` Protocol)

1. Platform event arrives (Slack Socket Mode, Telegram polling, SES webhook).
2. Platform adapter calls `normalize_incoming()` to produce a `NormalizedChatEvent` (from `mira-bots/shared/chat/types.py`).
3. Adapter calls `ChatDispatcher.dispatch(event)` from `mira-bots/shared/chat/dispatcher.py`.
   - **Do not bypass `ChatDispatcher` for text turns** — it is the UNS gate entry point per `.claude/rules/uns-confirmation-gate.md`.
   - For non-text paths (`engine.process_multi_photo`, `engine.reset`), direct calls to `Supervisor` are allowed.

### Stage 1 — ChatDispatcher → Supervisor.process()

**File:** `mira-bots/shared/chat/dispatcher.py` (`ChatDispatcher.dispatch()`)
**File:** `mira-bots/shared/engine.py`

4. `ChatDispatcher.dispatch()` resolves tenant identity and calls `Supervisor.process()`.
5. **`Supervisor.process()`** at **engine.py:879** — public entry point. Wraps `process_full()` with `asyncio.wait_for(timeout=_PROCESS_TIMEOUT)`. Accepts `uns_source`, `live_tags` kwargs.
6. **`Supervisor.process_full()`** at **engine.py:1296** — full pipeline begins.

### Stage 2 — State load and message pre-processing

**File:** `mira-bots/shared/engine.py`

7. `guardrails.strip_mentions(message)` — strips `@mention` tags.
8. Check for `/reset` command — calls `reset(chat_id)` and clears conversation state.
9. **`_load_state(chat_id)`** — loads or creates conversation state from SQLite **`conversation_state`** table (WAL mode). State carries FSM state, context, history, UNS context.

### Stage 3 — UNS resolution

**File:** `mira-bots/shared/engine.py` (line 1376)
**File:** `mira-bots/shared/uns_resolver.py`

10. **`resolve_uns_path(message, tenant_id, prior_ctx)`** called at **engine.py:1376** — extracts candidate `manufacturer`, `model`, `fault_code`, `site`, `area`, `line`, `machine`, `component` from message text using alias tables + heuristics + optional NeonDB enrichment.
11. Result stored at `state["context"]["uns_context"]` (a `UNSContext` object).
12. `uns_source` stamped at **engine.py:1388–1389**: `state["context"]["uns_context"]["source"]` is one of `"chat_resolver"`, `"technician_hint"`, `"direct_connection"`.
   - **Direct-connection surfaces** (Ignition `/api/v1/ignition/chat`, Perspective panel, MQTT/Sparkplug B, PLC bridge, Hub Command Center, QR deep-link) set `source="direct_connection"` before calling `process()`. See `.claude/rules/direct-connection-uns-certified.md`.

### Stage 4 — Intent classification (parallel)

**File:** `mira-bots/shared/engine.py` (lines 1529–1531)
**File:** `mira-bots/shared/guardrails.py`

13. **`classify_intent(message)`** at **engine.py:1529** — synchronous keyword classifier in `guardrails.py`. Returns `"safety" | "industrial" | "greeting" | "help" | "off_topic"`. Uses `SAFETY_KEYWORDS` (22 phrases) and `INTENT_KEYWORDS`. Expands abbreviations via `MAINTENANCE_ABBREVIATIONS`.
14. **`route_intent()`** at **engine.py:1531** — async LLM-based router for finer classification when needed.
15. **Safety fast-path** at **engine.py:1557–1568**: if EITHER the router OR keyword classifier returns `"safety"`, the engine immediately returns a STOP / `SAFETY_ALERT` escalation. This bypasses all subsequent steps.

### Stage 5 — UNS gate check

**File:** `mira-bots/shared/engine.py`

16. **`_should_fire_uns_gate()`** at **engine.py:4985** — determines whether to hold for UNS confirmation.
    - Returns `False` (gate bypassed) if `_UNS_GATE_ENABLED` is false (`MIRA_UNS_GATE_ENABLED` env var, default `"1"`, loaded at **engine.py:335**).
    - Returns `False` if `state["context"]["uns_context"]["source"] == "direct_connection"` — **engine.py:5020–5021** (direct-connection turns skip the gate by construction).
    - Returns `True` (gate fires) if `router_intent` is in `_GATED_INTENTS`, asset is NOT yet identified, and FSM state is `IDLE`.
17. If gate fires: engine emits a confirmation message identifying candidate site/area/line/machine/asset/component/fault with evidence and a confirmation question. Waits for technician reply before proceeding to RAG.

### Stage 6 — RAG retrieval

**File:** `mira-bots/shared/workers/rag_worker.py`
**File:** `mira-bots/shared/neon_recall.py`

18. **`RAGWorker.process()`** at **rag_worker.py:375** — 3-stage orchestration:
    a. **Embed query** via `_embed_ollama()` at **rag_worker.py:988** (calls Ollama `nomic-embed-text-v1.5`).
    b. **NeonDB recall** — calls `_neon_recall.recall_knowledge()` at **rag_worker.py:439, 458, 481**.
    c. **LLM inference** — calls `InferenceRouter.complete()`.

19. **`recall_knowledge()`** at **neon_recall.py:606** — 4-stage hybrid retrieval, executed in priority order:

    | Stage | Function | Similarity | Source |
    |---|---|---|---|
    | 1 Structured fault | `recall_fault_code()` at **line 265** | assigned 0.95 | **`fault_codes`** table — deterministic lookup by fault code token |
    | 2 Product CTE | `_product_search()` at **line 361** | pgvector cosine | **`knowledge_entries`** — CTE-based search by manufacturer/model name |
    | 3 pgvector | inline in `recall_knowledge()` | ≥ `MIN_SIMILARITY` (0.70) | **`knowledge_entries`** — `embedding <=> cast(:emb AS vector)` |
    | 4 ILIKE fallback | `_like_search()` at **line 326** | assigned 0.50 | **`knowledge_entries`** — `content ILIKE '%<keyword>%'` |

    `MIN_SIMILARITY = float(os.getenv("MIRA_MIN_SIMILARITY", "0.70"))` — **neon_recall.py:99**.

20. **`_merge_results()`** at **neon_recall.py:497** — deduplicates by first 100 chars of content; priority order: `structured_fault > product > vector > ILIKE`. Returns top-N chunks for context.

21. **Multi-subquery decomposition** (optional): `is_decompose_enabled()` check at **rag_worker.py:425** — if enabled, query is split into sub-queries, each recalled independently, then merged.

### Stage 7 — LLM cascade inference

**File:** `mira-bots/shared/inference/router.py`

22. **`InferenceRouter.complete(messages, max_tokens, session_id)`** at **router.py:283**.
23. Router is enabled only when `INFERENCE_BACKEND=cloud` (or legacy alias `"claude"`) AND at least one provider key is set. `self.enabled` at **router.py:205**: `self.backend == "cloud" and len(self.providers) > 0`.
24. **Cascade order** (Groq → Cerebras → Gemini), as defined in **`_build_providers()`** at **router.py:133**:
    - **Groq**: model `llama-3.3-70b-versatile`
    - **Cerebras**: model `llama3.1-8b`
    - **Gemini**: model `gemini-2.5-flash`
    - ⚠️ **NO Anthropic** — removed permanently in PR #610; never reintroduce.
25. **PII sanitization** (default-on): `sanitize_context()` at **router.py:257** strips IPv4 → `[IP]`, MAC → `[MAC]`, serial numbers → `[SN]` before every cascade call. Pass `sanitize=False` only for offline evals testing the sanitizer.
26. If ALL providers fail: `complete()` returns `("", {})`. `rag_worker.py` then falls back to **Open WebUI** via direct API call.
27. **System prompt** loaded from `mira-bots/shared/prompts/diagnose/active.yaml` on every call (zero-downtime rollout — file hot-swap without restart).

### Stage 8 — Citation compliance and groundedness check

**File:** `mira-bots/shared/citation_compliance.py`
**File:** `mira-bots/shared/engine.py`

28. Reply passes through `check_output(response, intent, has_photo)` in `guardrails.py` — strips hallucination artifacts (industrial jargon in greetings, transcription artifacts in text-only messages).
29. **Citation compliance** hooks in `citation_compliance.py` score every reply for groundedness (1–5 scale). Low-groundedness episodes are tracked; engine may emit a KB-gap admission prompt.
30. **`_infer_confidence(reply)`** in `engine.py` — keyword heuristic returns `"high" | "medium" | "low" | "none"`. High signals: `"replace"`, `"fault code"`, `"check wiring"`, etc. Low signals: `"might be"`, `"could be"`, `"possibly"`, etc.

### Stage 9 — State save and response

**File:** `mira-bots/shared/engine.py`
**File:** `mira-bots/shared/workers/rag_worker.py`

31. **FSM state advance**: `_advance_state()` validates the proposed next FSM state against `STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]`. Invalid LLM-proposed states hold at current state.
32. **API usage logged**: `write_api_usage()` in `InferenceRouter` persists token counts + provider name to **`api_usage`** table in SQLite.
33. State saved back to SQLite **`conversation_state`** (WAL mode, capped at `MIRA_HISTORY_LIMIT` turns, default 20).
34. `process_full()` returns `{"reply", "confidence", "trace_id", "next_state"}`.
35. `ChatDispatcher` calls adapter's `render_outgoing()` and sends the reply to the platform.

---

## Sequence Diagram

```
Platform (Slack/Telegram/Email)
     │
     │  message event
     ▼
Bot adapter (slack/bot.py | telegram/bot.py | email/ses_webhook.py)
     │  normalize_incoming() → NormalizedChatEvent
     ▼
ChatDispatcher.dispatch()  [mira-bots/shared/chat/dispatcher.py]
     │
     ▼
Supervisor.process()  [engine.py:879]
  └─ process_full()  [engine.py:1296]
       │
       ├── strip_mentions()  [guardrails.py]
       ├── _load_state()     [SQLite: conversation_state]
       ├── resolve_uns_path() [uns_resolver.py → line 1376]
       │     └─ state["context"]["uns_context"]["source"] stamped
       │
       ├── classify_intent() [guardrails.py, line 1529]  ─┐  parallel
       ├── route_intent()    [LLM router,   line 1531]   ─┘
       │
       ├── [safety fast-path] → STOP (if safety intent)
       │
       ├── _should_fire_uns_gate() [engine.py:4985]
       │     ├── source=="direct_connection" → gate bypassed [line 5020]
       │     └── IDLE + gated intent + no asset → emit confirmation, wait
       │
       ├── RAGWorker.process() [rag_worker.py:375]
       │     ├── _embed_ollama()         [nomic-embed-text-v1.5]
       │     └── recall_knowledge()     [neon_recall.py:606]
       │           ├── recall_fault_code()  [fault_codes table]
       │           ├── _product_search()   [knowledge_entries CTE]
       │           ├── pgvector cosine     [knowledge_entries, ≥0.70]
       │           └── _like_search()      [knowledge_entries ILIKE]
       │
       ├── InferenceRouter.complete() [router.py:283]
       │     ├── sanitize_context()  [strip PII]
       │     ├── Groq  llama-3.3-70b-versatile
       │     ├── Cerebras  llama3.1-8b         (on Groq failure)
       │     ├── Gemini  gemini-2.5-flash       (on Cerebras failure)
       │     └── OW fallback                    (if ALL cascade providers fail)
       │
       ├── check_output()         [guardrails.py]
       ├── citation_compliance    [citation_compliance.py]
       ├── _infer_confidence()    [engine.py]
       ├── _advance_state()       [FSM state machine]
       └── write_api_usage()      [SQLite: api_usage]
     │
     ▼
ChatDispatcher → render_outgoing() → platform reply
```

---

## Tables Touched

| Table | DB | Written by | Read by | Notes |
|---|---|---|---|---|
| `conversation_state` | SQLite (`mira.db`) | `engine.py:_load_state()`, `_save_state()` | `engine.py` | WAL mode; per `chat_id`; capped at `MIRA_HISTORY_LIMIT` turns |
| `api_usage` | SQLite (`mira.db`) | `InferenceRouter.write_api_usage()` | Observability only | Token counts + provider per call |
| `knowledge_entries` | NeonDB | Offline ingest scripts (NOT Hub upload path) | `neon_recall.recall_knowledge()` | pgvector + BM25 retrieval source |
| `fault_codes` | NeonDB | Offline seed scripts | `neon_recall.recall_fault_code()` | Deterministic fault lookup, priority stage |
| `feedback_log` | SQLite | `Supervisor.log_feedback()` | Analytics | Thumb-up/down per `chat_id` |

---

## What Can Go Wrong

| Failure | Where | Symptom | Mitigation |
|---|---|---|---|
| All cascade providers fail + OW down | `InferenceRouter.complete()` | Empty reply `""` returned | Cascade is designed to degrade gracefully; ensure at least one key is set in Doppler |
| UNS gate never fires (disabled) | `engine.py:335` (`MIRA_UNS_GATE_ENABLED=0`) | Engine starts troubleshooting without context confirmation | Only disable for testing; keep `"1"` in prod |
| Direct-connection turn missing UNS identifier | Adapter/relay | Should be rejected 400 with `{"error":"uns_required"}`; NOT downgraded to chat-gate | See `.claude/rules/direct-connection-uns-certified.md` |
| `MIN_SIMILARITY` too high | `neon_recall.py:99` | Recall returns nothing; engine falls through to ILIKE | Tune via `MIRA_MIN_SIMILARITY` env var |
| Knowledge gap (Hub-uploaded PDFs) | `recall_knowledge()` | Engine can't cite recently uploaded docs | Root cause: OW KB ≠ `knowledge_entries`; see `pdf-upload-flow.md` § Gap |
| Safety fast-path false positive | `guardrails.SAFETY_KEYWORDS` | Maintenance question treated as safety escalation | `SAFETY_KEYWORDS` are phrase-level; single-word matches don't fire |
| FSM state corruption | `_advance_state()` | Wrong state held; engine asks repeat questions | Invalid LLM-proposed states are rejected and held at current |
| Competing Telegram pollers | `telegram/bot.py` | CHARLIE stale process silently steals prod updates | Only one process per bot token; check CHARLIE for stale pollers |
| SQLite WAL contention | `conversation_state` | Rare: concurrent writes on same `chat_id` | WAL mode tolerates concurrent reads; single writer per `chat_id` |
| `active.yaml` prompt missing | `prompts/diagnose/active.yaml` | Engine startup error | Prompt file must exist; never delete without replacing |
