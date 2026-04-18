# mira-sidecar — LEGACY RAG Backend

**Status:** ⚠️ LEGACY — superseded by mira-pipeline (ADR-0008). Do NOT add new callers.
Pending removal after OEM doc migration (398 chunks in `shared_oem` ChromaDB).
Script: `tools/migrate_sidecar_oem_to_owui.py`. Runbook: `docs/runbooks/sidecar-oem-migration.md`.

---

## Stack

CPython 3.12 FastAPI app. ChromaDB vector store (two collections). LLM calls via provider abstraction.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Health check; doc counts + provider info |
| POST | `/ingest` | Parse PDF → chunk → embed → ChromaDB |
| POST | `/ingest/upload` | Multipart file upload + ingest pipeline |
| POST | `/rag` | Dual-brain RAG query → LLM answer + sources |
| POST | `/build_fsm` | Build FSM model from state history |

**Caller:** `mira-web/src/lib/mira-chat.ts` calls `/rag` (cutover to mira-pipeline pending, PR #197).

## Two-Brain Architecture

| Collection | ChromaDB Name | Purpose |
|-----------|---------------|---------|
| Brain 1 | `shared_oem` | Shared OEM manuals (all users) |
| Brain 2 | `mira_docs` | Per-tenant docs (filtered by `asset_id`) |

Query merges Brain 2 (n=5) + Brain 1 (n=5) → dedup → re-rank → top 5.
Source labels: `"Your docs"` vs `"Mira library"`.

## Port

5000 (Docker-internal only, not exposed on host). Reachable via `mira_mira-net`.

## Key Env Vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLM_PROVIDER` | `openai` | LLM backend: openai/anthropic/ollama |
| `EMBEDDING_PROVIDER` | `ollama` | Embed backend: openai/ollama |
| `CHROMA_PATH` | `./chroma_data` | ChromaDB persistence dir |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `ANTHROPIC_API_KEY` | — | Required for anthropic provider |

## Pitfalls

- **ChromaDB dimension mismatch** — switching embed providers requires deleting `./chroma_data` + full re-ingest.
- **PII sanitization** — applied in Anthropic + Ollama providers. OpenAI provider does NOT sanitize yet.
- **FSM with < 2 vectors** — returns empty model (not 422). Check `cycle_count > 0`.
