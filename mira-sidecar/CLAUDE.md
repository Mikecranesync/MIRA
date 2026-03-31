# mira-sidecar — RAG + FSM Sidecar

CPython 3.12 FastAPI application that provides document-grounded question answering
and finite-state machine learning for MIRA. Runs locally alongside the main MIRA
stack; never exposed to the public internet.

---

## Entry Point

```bash
# Development
uv run python app.py

# Production (via Docker or direct)
uv run uvicorn app:app --host 127.0.0.1 --port 5000
```

---

## Endpoints

| Method | Path         | Purpose                                          |
|--------|--------------|--------------------------------------------------|
| GET    | `/status`    | Health check; returns doc count and provider info |
| POST   | `/ingest`    | Parse document → chunk → embed → store in Chroma |
| POST   | `/rag`       | RAG query: embed → retrieve → LLM answer         |
| POST   | `/build_fsm` | Build FSM model from state history               |

### POST /ingest

```json
{
  "filename": "VFD_GS20_Manual.pdf",
  "asset_id": "vfd-001",
  "path": "/abs/path/to/VFD_GS20_Manual.pdf"
}
```

Returns `{"status": "ok", "chunks_added": N}`.

### POST /rag

```json
{
  "query": "Why is the drive faulting on overcurrent?",
  "asset_id": "vfd-001",
  "tag_snapshot": {"motor_current_A": 42.1, "drive_fault_code": 14},
  "context": ""
}
```

Returns `{"answer": "...", "sources": [{"file": "...", "page": "3", "excerpt": "..."}]}`.

### POST /build_fsm

```json
{
  "asset_id": "conveyor-01",
  "tag_history": [
    {"state": "IDLE", "timestamp_ms": 1700000000000},
    {"state": "RUNNING", "timestamp_ms": 1700000002500}
  ]
}
```

Returns a full `FSMModel` JSON object.

---

## Provider Abstraction

All LLM and embedding calls go through the `LLMProvider` / `EmbedProvider` protocols
defined in `llm/base.py`. The factory (`llm/factory.py`) selects concrete providers
from `LLM_PROVIDER` and `EMBEDDING_PROVIDER` settings:

| Setting              | Provider class         | File                         |
|----------------------|------------------------|------------------------------|
| `openai`             | `OpenAIProvider`       | `llm/openai_provider.py`     |
| `anthropic`          | `AnthropicProvider`    | `llm/anthropic_provider.py`  |
| `ollama`             | `OllamaProvider`       | `llm/ollama_provider.py`     |

**Important:** When `LLM_PROVIDER=anthropic`, embedding is always Ollama — Anthropic
has no embedding API. The factory enforces this automatically.

**PII sanitization** is applied inside `AnthropicProvider.complete()` before every
outbound API call. IPv4 addresses, MAC addresses, and serial numbers are replaced
with `[IP]`, `[MAC]`, `[SN]`. This matches the pattern in `mira-bots/shared/inference/router.py`.

---

## Configuration

Settings are loaded in priority order:

1. Environment variables (highest)
2. Java-style `.properties` file (path from `PROPERTIES_FILE` env var)
3. Defaults in `config.py`

The `.properties` format (key=value, # comments) is used on customer Ignition
servers where sysadmins prefer file-based configuration.

See `.env.example` for all available variables.

---

## Storage

| Store     | Library    | Path            | Purpose                    |
|-----------|------------|-----------------|----------------------------|
| ChromaDB  | chromadb   | `./chroma_data` | Vector store for doc chunks |

ChromaDB is persistent (`PersistentClient`). Collection name: `mira_docs`.
Each chunk is stored with metadata: `source_file`, `page`, `asset_id`,
`chunk_index`, `ingested_at`.

Re-ingesting the same document is idempotent — chunk IDs are derived from
`{asset_id}::{source_file}::{chunk_index}` and `upsert` is used.

---

## Document Chunking

`rag/chunker.py` supports PDF (pdfplumber), DOCX (python-docx), and TXT.
Default chunk size: 512 tokens. Default overlap: 64 tokens.
Token counting uses tiktoken `cl100k_base` encoding.

Splits prefer sentence boundaries; falls back to hard token splits for
pathological inputs (e.g., a single run-on paragraph longer than chunk_size).

---

## FSM Builder

`fsm/builder.py` learns transition statistics from a time-ordered list of
`StateVector` observations:

- **Accepting** transitions: stddev > 3× median stddev across all transitions
  (unusually variable — potential anomaly)
- **Rare** transitions: count / total < `FSM_RARE_THRESHOLD` (default 0.005)

The builder is pure Python with no external dependencies beyond stdlib statistics.

---

## Port

| Port | Binding       | Purpose          |
|------|---------------|------------------|
| 5000 | 127.0.0.1     | FastAPI HTTP      |

Never bind to 0.0.0.0. The sidecar is local-only and communicates with the
MIRA stack via loopback.

---

## Key Env Vars

| Variable             | Default                   | Purpose                              |
|----------------------|---------------------------|--------------------------------------|
| `LLM_PROVIDER`       | `openai`                  | LLM backend: openai/anthropic/ollama |
| `OPENAI_API_KEY`     | (empty)                   | Required for openai provider         |
| `ANTHROPIC_API_KEY`  | (empty)                   | Required for anthropic provider      |
| `OLLAMA_BASE_URL`    | `http://localhost:11434`  | Ollama endpoint                      |
| `EMBEDDING_PROVIDER` | `ollama`                  | Embed backend: openai/ollama         |
| `CHROMA_PATH`        | `./chroma_data`           | ChromaDB persistence directory       |
| `DOCS_BASE_PATH`     | `./docs`                  | Document source directory            |
| `PORT`               | `5000`                    | FastAPI listen port                  |
| `PROPERTIES_FILE`    | (empty)                   | Optional customer .properties path   |

---

## Common Pitfalls

**ChromaDB dimension mismatch**
If you switch embedding providers (e.g., from Ollama nomic-embed-text to
OpenAI text-embedding-3-small), the vector dimension changes. Delete
`./chroma_data` and re-ingest all documents before querying.

**Anthropic rate limits**
`AnthropicProvider.complete()` iterates text blocks in the response. If the
response is empty, check that `ANTHROPIC_API_KEY` is set and the model name
(`LLM_MODEL_ANTHROPIC`) matches an available model.

**Ollama not running**
`OllamaProvider` fails gracefully with an empty string / empty list and logs
an error. Start Ollama with `ollama serve` and confirm the required models
are pulled (`ollama pull llama3`, `ollama pull nomic-embed-text`).

**FSM with < 2 state vectors**
`build_fsm()` returns an empty model when fewer than 2 observations are
provided. The `/build_fsm` endpoint returns this empty model without error
(not a 422) — callers should check `cycle_count > 0`.

**Properties file not found**
If `PROPERTIES_FILE` points to a non-existent path, a WARNING is logged
and the file is silently ignored. All settings fall back to env vars / defaults.

**PII in logs**
The PII sanitizer only runs inside `AnthropicProvider`. If you use the
openai or ollama provider, PII (IP addresses, serial numbers, MAC addresses)
is NOT automatically stripped before sending. Add sanitization at the call
site if needed.
