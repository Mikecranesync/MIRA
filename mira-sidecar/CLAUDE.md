# mira-sidecar — RAG + FSM Sidecar (v0.2.0)

CPython 3.12 FastAPI application that provides document-grounded question answering
and finite-state machine learning for MIRA.

**SaaS:** Runs on Docker network (mira-net), not exposed on host ports.
**On-prem:** Bind to 127.0.0.1 via `HOST` env var.

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

| Method | Path              | Purpose                                          |
|--------|-------------------|--------------------------------------------------|
| GET    | `/status`         | Health check; returns doc counts and provider info |
| POST   | `/ingest`         | Parse document → chunk → embed → store in Chroma |
| POST   | `/ingest/upload`  | Multipart file upload + ingest pipeline           |
| POST   | `/rag`            | Dual-brain RAG query: Brain 2 + Brain 1 → LLM    |
| POST   | `/route`          | Tier-routed RAG query (Path B, feature-flagged)   |
| POST   | `/build_fsm`      | Build FSM model from state history               |

### POST /ingest

```json
{
  "filename": "VFD_GS20_Manual.pdf",
  "asset_id": "vfd-001",
  "path": "/abs/path/to/VFD_GS20_Manual.pdf",
  "collection": "tenant"
}
```

`collection`: `"tenant"` (default) → Brain 2 per-tenant, `"shared"` → Brain 1 shared OEM.
Returns `{"status": "ok", "chunks_added": N}`.

### POST /ingest/upload

Multipart form: `file` (binary) + `asset_id` (string) + `collection` (string, default `"tenant"`).
Saves file to `DOCS_BASE_PATH/{asset_id}/`, then runs chunk → embed → store pipeline.
Returns same `IngestResponse`.

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

### POST /route (Path B — feature-flagged)

Requires `TIER_ROUTING_ENABLED=true` and `TIER1_OLLAMA_URL` set. Returns 503 if disabled.

```json
{
  "query": "fault code OC on GS20 VFD",
  "asset_id": "vfd-001",
  "user_id": "tech-mike",
  "force_tier": null,
  "tag_snapshot": {}
}
```

Same RAG pipeline as `/rag`, but the tier router selects which LLM provider
handles the generation step:
- **Tier 1** (local Ollama on Charlie): simple queries when Charlie is reachable
- **Tier 3** (Claude API): complex queries, or fallback when Charlie is down

Returns `{"answer": "...", "sources": [...], "tier_used": "tier1", "latency_ms": 1500, "model": "gemma4:e4b", "query": "..."}`.

Use `force_tier` to override routing for testing (e.g., `"tier1"`, `"tier3"`).

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

## Two-Brain Architecture (PRD v2)

The sidecar maintains two ChromaDB collections:

| Collection   | Name          | Purpose                                   |
|-------------|---------------|-------------------------------------------|
| **Brain 1** | `shared_oem`  | Shared OEM manuals — available to ALL users |
| **Brain 2** | `mira_docs`   | Per-tenant private docs — filtered by `asset_id` |

**Query-time merge:** Brain 2 (n=5) + Brain 1 (n=5) → deduplicate by
`(source_file, page, chunk_index)` → re-rank by cosine distance → top 5.
Brain 2 is NOT artificially boosted — wins by relevance only.

**Source labeling:** Each hit carries `_brain` = `"Your docs"` or `"Mira library"`.
Citations in LLM output use `[Your docs: filename — page N]` vs
`[Mira library: filename — page N]`.

**Ingestion routing:** Use `collection="shared"` on `/ingest` or `/ingest/upload`
to target Brain 1. Default `"tenant"` targets Brain 2.

---

## Safety Guardrails (`safety.py`)

`detect_safety(query)` checks for 28 trigger phrases (arc flash, LOTO,
confined space, etc.) BEFORE the query reaches the LLM. If triggered:
1. System prompt gets a safety preamble
2. `SAFETY_BANNER` is prepended to the response

Keywords are phrase-level (not single words) to reduce false positives.

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

ChromaDB is persistent (`PersistentClient`). Two collections:
- `mira_docs` — Brain 2 (per-tenant private docs, filtered by `asset_id`)
- `shared_oem` — Brain 1 (shared OEM library, no asset filter)

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
| 5000 | configurable  | FastAPI HTTP      |

**SaaS (Docker):** Binds 0.0.0.0 inside the container; not exposed on host ports.
Reachable only via the Docker network (mira-net).

**On-prem (Ignition):** Set `HOST=127.0.0.1` for loopback-only access.

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

### Path B Tier Routing Env Vars (feature-flagged, all optional)

| Variable                 | Default           | Purpose                                      |
|--------------------------|-------------------|----------------------------------------------|
| `TIER_ROUTING_ENABLED`   | `false`           | Enable tier routing on `/route` endpoint      |
| `TIER1_OLLAMA_URL`       | (empty)           | Charlie Ollama URL (empty = Tier 1 disabled)  |
| `TIER1_MODEL`            | `gemma4:e4b`      | Local inference model                         |
| `TIER1_TIMEOUT`          | `15`              | Max seconds for Tier 1 inference              |
| `TIER1_MAX_QUERY_WORDS`  | `40`              | Queries above this → COMPLEX → Tier 3         |
| `TIER2_GPU_URL`          | (empty)           | Cloud GPU URL (empty = Tier 2 disabled)       |
| `TIER2_MODEL`            | `gemma4:26b`      | Cloud GPU model                               |
| `TIER2_TIMEOUT`          | `45`              | Max seconds for Tier 2 inference              |
| `TIER2_API_KEY`          | (empty)           | Cloud GPU API key                             |
| `HEALTH_PROBE_INTERVAL`  | `30`              | Seconds between Tier 1 health checks          |

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
**PII sanitization** is applied in both `AnthropicProvider` and `OllamaProvider`
via the shared `llm/sanitize.py` module. IPv4, MAC addresses, and serial numbers
are stripped before every outbound LLM call. The `openai` provider does NOT yet
have PII sanitization — add it at the call site if needed.
