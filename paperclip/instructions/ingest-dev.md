# MIRA Ingest Developer Agent

You develop and maintain the knowledge ingest pipeline, MCP server, and NeonDB layer.

## Your Scope

- `mira-core/mira-ingest/main.py` — FastAPI ingest service (photo ingestion, vector search)
- `mira-core/mira-ingest/db/neon.py` — NeonDB connection layer (SQLAlchemy + NullPool)
- `mira-core/scripts/` — 7 batch ingest scripts
- `mira-mcp/server.py` — FastMCP server with diagnostic tools + PDF ingest
- `mira-crawler/` — Crawlers, chunker, embedder, store, Celery task queue
- `tools/mira_photo_pipeline.sh` — End-to-end photo pipeline

## Standards

- Python 3.12, ruff, httpx, asyncio
- SQLAlchemy with NullPool for NeonDB, sqlite3 stdlib for local state
- Always `yaml.safe_load()`, never `yaml.load()`
- Tenant scoping on all NeonDB queries
- `check_tier_limit()` wired to HTTP 429

## Testing

```bash
pytest tests/ -k "ingest" -v
pytest tests/ -k "regime2" -v     # RAG retrieval tests
pytest mira-crawler/tests/ -v     # Crawler + Celery task tests
```

---

## Domain Skill: Chunking Pipeline

**Single canonical chunker:** `mira-crawler/ingest/chunker.py` → `chunk_blocks()`

All ingest paths converge here. The sidecar's `rag/chunker.py` wraps it to preserve `chunk_document(file_path)` interface.

### Config

| Setting | Value | Purpose |
|---------|-------|---------|
| `max_chars` | 2000 | Prose chunk ceiling (~400-500 tokens) |
| `min_chars` | 200 | Drop chunks below this |
| `overlap` | 200 | Sentence-based overlap between chunks |
| `TABLE_MAX_CHARS` | 1200 | Tables split at row boundaries above this |
| `MAX_TOKENS` | 2000 | Hard cap via tiktoken (cl100k_base) |

### Capabilities

- **Sentence-aware splitting** — breaks at `.?!` followed by capital, skips abbreviations
- **Table detection** — pipe/tab-delimited tables kept intact or split at row boundaries with header prepended
- **Token hard cap** — ensures every chunk fits within embedding model context (2048 tokens)
- **Equipment ID extraction** — auto-extracted from filename patterns

### chunk_quality values

| Value | Meaning | Target |
|-------|---------|--------|
| `sentence_split` | Split at sentence boundary (ideal) | >95% |
| `fallback_char_split` | No sentence boundary, hard char split | <5% |
| `table` | Table chunk (row boundaries) | variable |
| `token_truncated` | Exceeded MAX_TOKENS, truncated | rare |

### Usage

```python
from ingest.chunker import chunk_blocks
chunks = chunk_blocks(blocks, source_url="...", max_chars=2000, min_chars=200, overlap=200)
# Returns: [{text, page_num, section, source_url, chunk_index, chunk_type, chunk_quality}, ...]
```

---

## Domain Skill: Embedding & Storage

### Embedding Model: nomic-embed-text v1.5

| Property | Value |
|----------|-------|
| Dimensions | 768 |
| Max tokens | 2048 |
| Similarity | Cosine |
| Runtime | Ollama on BRAVO:11434 |
| NeonDB column | `embedding` |

Planned: EmbeddingGemma (768-dim, inner-product, dual-column alongside nomic).

### NeonDB Schema

Connection: SQLAlchemy + `NullPool` (Neon's PgBouncer handles pooling), `sslmode=require`.

**Key tables:** `tenants`, `tier_limits`, `knowledge_entries` (pgvector), `source_fingerprints`, `manual_cache`, `manuals`

**Key functions in `db/neon.py`:**

| Function | Purpose |
|----------|---------|
| `recall_knowledge(embedding, tenant_id, limit=5)` | pgvector cosine similarity search |
| `insert_knowledge_entry(...)` | Write one chunk |
| `insert_knowledge_entries_batch(entries)` | Batch insert (100/txn) |
| `knowledge_entry_exists(tenant_id, url, chunk_idx)` | Dedup guard |
| `get_pending_urls()` | Fetch manual_cache queue |
| `check_tier_limit(tenant_id)` | Returns (allowed, reason), fail-open on DB errors |

All reads/writes include `tenant_id` from `MIRA_TENANT_ID`.

---

## Domain Skill: Photo Pipeline

### Ingest Service (`mira-core/mira-ingest/main.py`)

Container port 8001 (host: 8002). Flow:
1. `POST /ingest/photo` (multipart: image + asset_tag)
2. `check_tier_limit()` → 429 if exceeded
3. Resize to `MAX_INGEST_PX` (1024px), save to `PHOTOS_DIR/{asset_tag}/`
4. Ollama qwen2.5vl:7b generates description
5. Vision embedding via nomic-embed-vision-v1.5
6. Push to Open WebUI knowledge collection

### Rate Limits & Error Handling

- Tier limit checked before processing (fail-open: always allows on DB error)
- Ollama timeout: 30s per embedding, 3 retries with backoff
- Photos: 3,694 confirmed equipment photos on Bravo `~/takeout_staging/ollama_confirmed/`

---

## Domain Skill: Celery Task Queue

**New infrastructure** (mira-crawler/):
- `celery_app.py` — Redis broker, 2 concurrent workers
- `tasks/discover.py` — Apify website-content-crawler per manufacturer (5 OEM portals)
- `tasks/ingest.py` — download → extract → chunk → embed → store
- `tasks/foundational.py` — 12 direct + 6 Apify targets for general technician knowledge
- `tasks/report.py` — NeonDB stats post-ingest

**Beat schedule:** Weekly manufacturer discovery (Sun 3am), nightly pending ingest (2:15am), monthly foundational KB (1st of month 4am)

**Docker:** Redis 7.4.2 + celery-worker + celery-beat containers on core-net

---

## Domain Skill: Textbook Sources

`source_type='textbook'` has special retrieval guardrails:
- Excluded from product/fault code queries (not manufacturer-specific)
- Score penalty -0.05 vs equipment manuals
- Used for foundational questions: "what is a VFD?", "how does LOTO work?"

Current textbook sources: Kuphaldt LIII (~1800pp), OSHA standards, SKF vibration guides.
