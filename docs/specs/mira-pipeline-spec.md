# mira-pipeline Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
OpenAI-compatible HTTP API that wraps the shared `Supervisor` (GSDEngine) so that **Open WebUI on the VPS** can speak to MIRA as if it were any OpenAI model. This is the **active VPS chat path** (`User phone → Open WebUI → mira-pipeline:9099 → Supervisor → cascade providers`). It supersedes `mira-sidecar` (ADR-0008).

## Scope
**IN scope**
- `/v1/chat/completions` and `/v1/models` OpenAI-compat surface
- `/health`, `/eval/*`, `/feedback` REST endpoints
- Per-chat session NDJSON recording for eval fixture replay
- Bearer-token auth via `PIPELINE_API_KEY`

**OUT of scope**
- Diagnostic logic itself — that lives in `mira-bots/shared` and is COPY'd in at build time
- Vector retrieval implementation (delegated to `RAGWorker`)
- KB ingestion (delegated to `mira-ingest`)

## Architecture
- **Layer:** Adapter
- **Container:** `mira-pipeline` on `:9099`
- **Network:** `core-net`
- **Build context:** repo root (so `shared/` and `prompts/` resolve from `mira-bots/`)
- **Persistence:** Reads/writes the same `mira.db` as bot adapters; writes session NDJSON to `${SESSION_RECORDING_PATH:-/data/sessions}`
- **Dependencies:** Open WebUI (`mira-core:8080`), Ollama, NeonDB, Groq/Cerebras/Gemini APIs

```
Open WebUI  ──POST /v1/chat/completions (Bearer PIPELINE_API_KEY)──▶  mira-pipeline:9099
   │                                                                       │
   │                                                       Supervisor.process_full(user, msg, photo_b64)
   │                                                                       │
   ◀────────────────── OpenAI-format response (choices[0].message.content) ─┘
```

## API Contract
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness — must return `{"status":"ok"}` in < 50 ms |
| GET | `/v1/models` | Bearer | Returns `{"data":[{"id":"mira-diagnostic", ...}]}` |
| POST | `/v1/chat/completions` | Bearer | OpenAI-compat single-turn or multi-turn diagnostic call |
| POST | `/feedback` | Bearer | `{chat_id, feedback: "up"\|"down", reason}` → `Supervisor.log_feedback` |
| POST | `/eval/run` | Bearer | Replay a recorded session against the engine for offline eval |

**Request shape** (subset MIRA cares about):
```json
{
  "model": "mira-diagnostic",
  "user": "<chat_id>",
  "messages": [
    {"role": "user", "content": "<text>"},
    {"role": "user", "content": [{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}]}
  ]
}
```

**Response shape:** standard OpenAI `chat.completion`. `choices[0].message.content` is the engine reply; `usage` reflects cascade cost when available; an `x-mira-trace-id` header is set for log correlation.

**Chat-id mapping:** Open WebUI's `user` field → Supervisor `chat_id`. Falls back to `openwebui_anonymous` if absent.

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `PIPELINE_API_KEY` | yes | — | Bearer auth for this service |
| `MIRA_DB_PATH` | yes | `/data/mira.db` | Shared SQLite WAL |
| `OPENWEBUI_BASE_URL` | yes | `http://mira-core:8080` | KB retrieval target |
| `OPENWEBUI_API_KEY` | yes | — | Auth for Open WebUI |
| `KNOWLEDGE_COLLECTION_ID` | yes | — | Open WebUI collection UUID |
| `NEON_DATABASE_URL` | yes | — | NeonDB recall |
| `MIRA_TENANT_ID` | yes | — | Tenant scope |
| `INFERENCE_BACKEND` | yes | `cloud` | `cloud` cascade or `local` (Open WebUI fallback) |
| `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` | ≥1 in cloud | — | Cascade providers |
| `VISION_MODEL` | no | `qwen2.5vl:7b` | Local vision model |
| `SESSION_RECORDING_PATH` | no | `/data/sessions` | Per-chat NDJSON for eval replay |
| `EVAL_DISABLE_JUDGE` | no | unset | If `1`, eval skips LLM grading |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Unit test files | 0 | ≥ 5 (eval-fixture replay + endpoint contract) |
| Endpoint contract test | manual | automated against fixtures |
| p50 latency `/v1/chat/completions` | unmeasured | ≤ 4 s end-to-end (cloud cascade) |
| 5xx rate | unmeasured | < 0.5 % |
| Cascade fallback budget | 1 cycle ≤ 6 s | maintain |

Domain grade: **F → D** (priority lift; pipeline has zero unit tests).

## Acceptance Criteria
1. **Open WebUI registration:** Adding `https://<host>:9099/v1` with `PIPELINE_API_KEY` to Open WebUI's "OpenAI API" connections lists `mira-diagnostic` as a model.
2. **Round-trip:** A POST to `/v1/chat/completions` with a single user message returns a non-empty `content` and an `x-mira-trace-id` header.
3. **Image input:** A multipart message with `image_url` data URI flows to `Supervisor.process_full(... photo_b64=...)`.
4. **Auth:** Missing or wrong bearer → HTTP 401; correct bearer → HTTP 200.
5. **Failure budget:** With `GROQ_API_KEY` revoked, the call still succeeds via Cerebras or Gemini; eval session shows the fallback in `api_usage`.
6. **Session recording:** Every `/v1/chat/completions` writes one line to `${SESSION_RECORDING_PATH}/<chat_id>.ndjson`.
7. **Eval replay:** `tests/eval/analyze_sessions.py` can replay a recorded session and recompute graded metrics deterministically.

## Known Issues
- Zero unit tests (grade F per `docs/QUALITY_SCORE.md`).
- Build context must be repo root; running `docker build .` from inside `mira-pipeline/` will fail (shared/ unavailable).
- Single-process; do not horizontally scale until SQLite WAL contention is measured.

## Change Log
- 2026-04 — Adopted as the canonical VPS chat path; mira-sidecar deprecated (ADR-0008).
- 2026-04-25 — Anthropic removal cascaded here automatically (no code in this service to change).
