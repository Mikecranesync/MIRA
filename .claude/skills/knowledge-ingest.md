---
name: knowledge-ingest
description: MIRA knowledge ingest pipeline — NeonDB layer, FastAPI ingest service, 7 ingest scripts, photo pipeline, MCP server, tenant scoping, tier limits
---

# Knowledge Ingest

## Source Files

- `mira-core/mira-ingest/db/neon.py` — NeonDB connection layer (read + write)
- `mira-core/mira-ingest/main.py` — FastAPI ingest service (photo ingestion, vector search, KB push)
- `mira-core/scripts/` — 7 ingest scripts (batch ingestion tools)
- `tools/mira_photo_pipeline.sh` — end-to-end photo pipeline shell script
- `mira-mcp/server.py` — FastMCP server with PDF ingest endpoint and diagnostic tools

---

## NeonDB Layer (`neon.py`)

Uses SQLAlchemy with `NullPool` — Neon's PgBouncer handles connection pooling. No persistent connections from application code.

```python
create_engine(
    url,
    poolclass=NullPool,
    connect_args={"sslmode": "require"},
    pool_pre_ping=True,
)
```

### Key functions

| Function | Purpose |
|----------|---------|
| `get_tenant(tenant_id)` | Look up tenant row from `tenants` table |
| `get_tier_limits(tier)` | Look up rate limits from `tier_limits` table |
| `recall_knowledge(embedding, tenant_id, limit=5)` | pgvector cosine similarity search over `knowledge_entries` |
| `check_tier_limit(tenant_id)` | Returns `(allowed: bool, reason: str)` — wire to HTTP 429 |
| `insert_knowledge_entry(...)` | Insert one chunk with embedding into `knowledge_entries` |
| `knowledge_entry_exists(tenant_id, source_url, chunk_index)` | Dedup guard before inserting |
| `health_check()` | Returns `{status, tenant_count, knowledge_entries}` |
| `get_pending_urls()` | Returns unprocessed URLs from 3 source tables |
| `mark_source_fingerprint_done(row_id, atoms_created)` | Mark URL as processed |
| `mark_manual_cache_done(row_id)` | Mark manual_cache URL as processed |
| `mark_manual_verified(row_id)` | Mark manual as verified |
| `insert_manual_cache_url(...)` | Queue a new URL for ingest |

### NeonDB Schema (key tables)

```
tenants            — tenant registry (id, tier, name, ...)
tier_limits        — rate limits per tier (daily_requests, ...)
knowledge_entries  — chunked content + pgvector embeddings
  ├── tenant_id, source_type, manufacturer, model_number
  ├── content (text), embedding (vector)
  ├── source_url, source_page (chunk index)
  └── metadata (jsonb), is_private, verified
source_fingerprints — URLs queued for ingest (atoms_created counter)
manual_cache       — discovered manual URLs (pdf_stored flag)
manuals            — verified manuals (is_verified flag)
```

### Tenant Scoping

All reads and writes include `tenant_id` from `MIRA_TENANT_ID` env var. `recall_knowledge()` always filters by `WHERE tenant_id = :tid` — tenants cannot see each other's data.

### Tier Limits

`check_tier_limit(tenant_id)` counts today's `knowledge_entries` rows and compares to `tier_limits.daily_requests`. Returns `(False, "Daily limit of N requests reached")` when exceeded. Wire this to the photo ingest endpoint to return HTTP 429.

---

## FastAPI Ingest Service (`main.py`)

**Container:** `mira-ingest` | **Port:** 8001 (host: 8002)

Key env vars:
```
MIRA_DB_PATH          default: /app/mira.db
PHOTOS_DIR            default: /data/photos
OLLAMA_BASE_URL       default: http://host.docker.internal:11434
DESCRIBE_MODEL        default: qwen2.5vl:7b
EMBED_VISION_MODEL    default: nomic-embed-vision-v1.5
EMBED_TEXT_MODEL      default: nomic-embed-text-v1.5
OPENWEBUI_BASE_URL    default: http://mira-core:8080
OPENWEBUI_API_KEY
KNOWLEDGE_COLLECTION_ID
MAX_INGEST_PX         default: 1024
```

### Photo ingest flow

```
POST /ingest/photo (multipart: image file + asset_tag)
    ├── check_tier_limit() → 429 if exceeded
    ├── Resize image to MAX_INGEST_PX
    ├── Save to PHOTOS_DIR/{asset_tag}/
    ├── Call Ollama (qwen2.5vl:7b) for description (DESCRIBE_SYSTEM prompt)
    ├── Generate vision embedding (nomic-embed-vision-v1.5)
    ├── Push to Open WebUI knowledge collection
    └── Return {id, asset_tag, description}
```

### DESCRIBE_SYSTEM prompt

The photo description prompt instructs the model to return under 100 words covering: (1) device name/make/model/function, (2) likely fault cause if visible, (3) one concrete next step for the technician.

---

## 7 Ingest Scripts (`mira-core/scripts/`)

| Script | Purpose |
|--------|---------|
| `ingest_manuals.py` | Process PDFs from NeonDB `manual_cache` queue; chunk + embed + insert |
| `ingest_equipment_photos.py` | Batch ingest photos from a directory |
| `ingest_gdrive_docs.py` | Ingest documents from Google Drive (via rclone sync) |
| `ingest_gmail_takeout.py` | Extract maintenance records from Gmail takeout export |
| `discover_manuals.py` | Crawl manufacturer sites to populate `manual_cache` |
| `build_case_corpus.py` | Build training corpus from interaction logs |
| `reddit_harvest.py` | Harvest industrial maintenance Q&A from Reddit |

---

## Photo Pipeline (`tools/mira_photo_pipeline.sh`)

End-to-end shell script:
1. Sync photos from Google Photos via rclone
2. For each new photo: POST to `mira-ingest /ingest/photo`
3. Log results and errors

Trigger manually or via cron. Requires rclone configured with Google Photos OAuth.

---

## MCP Server (`mira-mcp/server.py`)

**Container:** `mira-mcp` | **Ports:** 8000 (MCP SSE), 8001 (REST API)

Built with `fastmcp`. Auth: Bearer token (`MCP_REST_API_KEY`).

### MCP tools exposed

```python
@mcp.tool()
def get_equipment_status(equipment_id: str = "") -> dict:
    # Query equipment_status table in SQLite

@mcp.tool()
def get_active_faults() -> dict:
    # Query active faults from SQLite

@mcp.tool()
def ingest_pdf(...) -> dict:
    # Accept PDF, chunk, push to Open WebUI knowledge collection
```

### PDF ingest endpoint

`POST /ingest/pdf` — accepts multipart PDF + `equipment_type` field. Used by bot adapters to index user-uploaded manuals without going through the ingest service.

### Retrieval backend

`RETRIEVAL_BACKEND=openviking` enables the OpenViking vector store (experimental). Default uses Open WebUI collection search.

---

## Supported File Types for Ingest

| Type | Entry Point | Notes |
|------|-------------|-------|
| Photo (JPEG/PNG) | `mira-ingest /ingest/photo` or `mira-core/scripts/ingest_equipment_photos.py` | Resized to MAX_INGEST_PX |
| PDF manual | Telegram/Slack bot → `mira-mcp /ingest/pdf` | Chunked, embedded, pushed to collection |
| Google Drive docs | `mira-core/scripts/ingest_gdrive_docs.py` | rclone sync first |
| Gmail takeout | `mira-core/scripts/ingest_gmail_takeout.py` | Maintenance email extraction |
| Web URLs | `mira-core/scripts/discover_manuals.py` → `ingest_manuals.py` | Queued in manual_cache |
