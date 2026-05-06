# mira-bots Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Channel-agnostic adapters (Telegram, Slack, Teams, WhatsApp, Reddit, webchat, gchat, email) plus the **shared diagnostic engine** (`shared/`) that every chat surface and the VPS pipeline call. The shared engine — `Supervisor` (a.k.a. GSDEngine) — is the single source of truth for MIRA's diagnostic conversation: intent classification, FSM state, RAG retrieval, multi-provider LLM cascade, guardrails, and feedback logging.

## Scope
**IN scope**
- Adapter containers that translate platform-specific events to/from the engine (`telegram/`, `slack/`, `teams/`, `whatsapp/`, `reddit/`, `webchat/`, `gchat/`, `email/`)
- Shared engine library: `shared/engine.py`, `shared/workers/*`, `shared/guardrails.py`, `shared/inference/router.py`, `shared/recall.py`
- Prompt registry under `shared/../prompts/diagnose/active.yaml`
- Bot-level test harness (`tests/`, `v2_test_harness/`, `benchmark/`)

**OUT of scope**
- VPS chat path (handled by `mira-pipeline` — but it imports `shared/`)
- Knowledge ingestion (handled by `mira-ingest` and `mira-crawler`)
- CMMS work-order creation (handled by `mira-mcp`)

## Architecture
- **Layer:** Adapter (`telegram`/`slack`/etc.) → Engine (`shared/`) per `docs/ARCHITECTURE.md`
- **Containers:** `mira-bot-telegram`, `mira-bot-slack`, `mira-bot-teams` (`:8030`), `mira-bot-whatsapp` (`:8010`)
- **Networks:** `bot-net` + `core-net` (so adapters can reach `mira-ingest`, `mira-mcp`, Open WebUI)
- **Persistence:** Shared SQLite WAL at `mira-bridge/data/mira.db` (mounted read/write)
- **Dependencies:**
  - Upstream: Telegram/Slack/Teams/Twilio (inbound events)
  - Downstream: Ollama (`:11434`), Open WebUI (`:8080`), `mira-ingest` (`:8001`), NeonDB (RAG recall), Groq/Cerebras/Gemini APIs

```
[Channel platform] → [Adapter] → Supervisor.process()
                                   ├── classify_intent (guardrails)
                                   ├── FSM advance
                                   ├── RAGWorker (recall + InferenceRouter)
                                   ├── VisionWorker (qwen2.5vl:7b)
                                   └── feedback_log + api_usage → mira.db
```

## API Contract
### Library (called by adapters and `mira-pipeline`)
```python
sup = Supervisor(
    db_path: str,
    openwebui_url: str,
    api_key: str,
    collection_id: str,
    vision_model: str = "qwen2.5vl:7b",
    tenant_id: str | None = None,
)

reply: str = sup.process(chat_id: str, message: str, photo_b64: str | None = None)

full = sup.process_full(chat_id, message, photo_b64)
# → {"reply": str, "confidence": "high"|"medium"|"low"|"none", "trace_id": str, "next_state": str}

sup.reset(chat_id: str) -> None
sup.log_feedback(chat_id: str, feedback: "up"|"down", reason: str = "") -> None
```

### Adapter behavior contract
- Cast `chat_id` to `str` before calling (`Telegram` sends `int`)
- `photo_b64` MUST be base-64 string, not raw bytes
- Strip `@mention` tags via `guardrails.strip_mentions()` before forwarding
- File-size enforcement: Telegram ≤ 20 MB PDF; Slack MIME allowlist (images + PDF)

### FSM contract
`STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]`
Plus side states: `ASSET_IDENTIFIED`, `ELECTRICAL_PRINT`, `SAFETY_ALERT`.
`_advance_state()` rejects invalid transitions silently — adapter does not need to validate.

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | telegram | — | Bot API token (Doppler) |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | slack | — | Socket Mode auth |
| `INFERENCE_BACKEND` | yes | `cloud` | `cloud` (Groq→Cerebras→Gemini cascade) or `local` (Open WebUI fallback) |
| `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `GEMINI_API_KEY` | ≥1 in cloud | — | Cascade providers |
| `GROQ_MODEL` | no | `llama-3.3-70b-versatile` | Groq text model |
| `GROQ_VISION_MODEL` | no | `meta-llama/llama-4-scout-17b-16e-instruct` | Groq vision |
| `GEMINI_MODEL` / `GEMINI_VISION_MODEL` | no | `gemini-2.5-flash` | Gemini text + vision |
| `CEREBRAS_MODEL` | no | `llama3.1-8b` | Cerebras text |
| `OPENWEBUI_BASE_URL` | yes | `http://mira-core:8080` | Open WebUI for KB retrieval + local fallback |
| `OPENWEBUI_API_KEY` | yes | — | Bearer token for Open WebUI |
| `KNOWLEDGE_COLLECTION_ID` | yes | — | Open WebUI collection UUID |
| `MIRA_DB_PATH` | yes | `/data/mira.db` | SQLite WAL location |
| `MIRA_TENANT_ID` | yes | — | Tenant scope for NeonDB recall |
| `NEON_DATABASE_URL` | yes | — | NeonDB recall |
| `MIRA_HISTORY_LIMIT` | no | `20` | Max conversation turns kept in context |
| `MIRA_RETRIEVAL_HYBRID_ENABLED` | no | `true` | Unit-6 BM25 + pgvector hybrid retrieval kill switch |
| `MIRA_RRF_K` | no | `60` | Reciprocal Rank Fusion constant |
| `MIRA_PLC_ENABLED` | no | off | Enables (stub) PLCWorker for Config 4 |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | no | — | Tracing |

### Forbidden
- `ANTHROPIC_API_KEY` — Anthropic was removed in PR #610 + #649. The runtime silently ignores any value.
- LangChain, n8n, TensorFlow — banned per CLAUDE.md hard constraints.

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Test files | 12 | maintain ≥ 12, grow with engine |
| pytest coverage (shared) | 27–32 % measured | 50 % |
| Property tests (hypothesis) | 11 | maintain |
| Boundary contracts | 6 architectural rules | maintain |
| Type checking | pyright basic, 57 warnings | 0 warnings (treat as errors) |
| First-token latency | ≤ 3 s p50 (cloud cascade) | ≤ 2 s |
| Cascade fallback | < 200 ms switch on 5xx | maintain |
| Provider error rate | < 1 % per provider | < 0.5 % |

Domain grade per `docs/QUALITY_SCORE.md`: **C+**.

## Acceptance Criteria
A change is acceptance-tested only if all of the following still pass:

1. **Cold start:** New `chat_id` enters `IDLE`; first user message advances to `Q1` (industrial intent) or `SAFETY_ALERT` (safety intent).
2. **Cascade failover:** Forcing Groq 500 → Cerebras success returns a non-empty `reply`; both events appear in `api_usage`.
3. **PII sanitization:** A message containing `192.168.1.42`, `aa:bb:cc:dd:ee:ff`, and `SN12345` is sanitized before any provider call (verified in `InferenceRouter.sanitize_context()` test).
4. **Safety bypass:** `"there's smoke from the panel"` returns `SAFETY_ALERT` regardless of FSM position; engine does not call RAG.
5. **No-Anthropic invariant:** `grep -r "anthropic" mira-bots/shared/inference/` returns zero non-comment hits.
6. **History cap:** A 50-turn conversation keeps only the last `MIRA_HISTORY_LIMIT` turns in the LLM context window.
7. **Feedback logging:** `log_feedback(chat_id, "down", "wrong_part")` writes a row to `feedback_log`.
8. **Resolved-state reset:** Setting state = `RESOLVED` then sending a new fault rebuilds — `_clear_diagnostic_carryover` resets `state["state"]` (regression: feedback_resolved_state_wo_rebuild).
9. **Prompt hot-swap:** Editing `prompts/diagnose/active.yaml` and re-issuing a request picks up the new prompt without a restart.
10. **All 6 boundary contracts** (`tests/architecture/`) pass.

## Known Issues
- `mira-bots/shared` coverage below 50 % target.
- `plc_worker.py` is a stub (Config 4 deferred).
- Intent classifier biases toward `industrial` for unrecognized queries (intentional, but produces false positives on chit-chat < 20 chars; greeting word required for `greeting`).
- Competing Telegram pollers: only one process per token. Stale pollers on Charlie have caused incidents.

## Change Log
- 2026-04-26 — PR #649 final Anthropic removal, cascade reordered to Groq → Cerebras → Gemini.
- 2026-04-25 — PR #610 ripped out Anthropic dependency.
- 2026-04-15 — #280: intent classifier defaults to `industrial`, greeting requires keyword + length.
- 2026-04-17 — Hybrid BM25 + pgvector retrieval (Unit 6) added behind `MIRA_RETRIEVAL_HYBRID_ENABLED`.
