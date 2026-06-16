# mira-pipeline — OpenAI-compatible GSD Diagnostic API

Wraps MIRA's GSDEngine behind an OpenAI-compatible `/v1/chat/completions` API.
Open WebUI connects to this service and exposes "MIRA Diagnostic" as a model.

## How it works

1. Technician selects "MIRA Diagnostic" model in Open WebUI
2. Open WebUI sends chat messages to `http://mira-pipeline:9099/v1/chat/completions`
3. Pipeline extracts user message (text + optional base64 image)
4. Calls `GSDEngine.process()` — full diagnostic workflow (intent -> FSM -> RAG -> inference)
5. Returns response in OpenAI chat completion format

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Liveness check |
| GET | `/v1/models` | Bearer | List available models (returns "mira-diagnostic") |
| POST | `/v1/chat/completions` | Bearer | Process chat message through GSD engine |

## Environment Variables

Same as bot adapters plus `PIPELINE_API_KEY`:

| Var | Default | Purpose |
|-----|---------|---------|
| `MIRA_DB_PATH` | `/data/mira.db` | SQLite WAL database (shared with mira-bridge) |
| `OPENWEBUI_BASE_URL` | `http://mira-core:8080` | Open WebUI internal URL |
| `OPENWEBUI_API_KEY` | | Bearer token for Open WebUI API |
| `KNOWLEDGE_COLLECTION_ID` | | Open WebUI knowledge collection UUID |
| `NEON_DATABASE_URL` | | NeonDB connection string (RAG recall) |
| `MIRA_TENANT_ID` | | Tenant scoping for NeonDB queries |
| `VISION_MODEL` | `qwen2.5vl:7b` | Ollama vision model |
| `INFERENCE_BACKEND` | `cloud` | `cloud` (Groq->Cerebras->Claude) or `local` |
| `PIPELINE_API_KEY` | | Bearer token for this service (Doppler-managed) |

## Build

```bash
# Build context is repo root (so shared/ and prompts/ resolve from mira-bots/)
docker build -f mira-pipeline/Dockerfile -t mira-pipeline:dev .
```

## Shared code

GSDEngine source (`shared/`, `prompts/`) is COPY'd from `mira-bots/` at build time.
Same pattern as Telegram/Slack bot Dockerfiles.

## Chat ID mapping

Open WebUI's `user` field (from the request) maps to GSD `chat_id` for FSM state.
Each Open WebUI user gets independent diagnostic state. Falls back to `openwebui_anonymous`
if no user ID is provided.
