# MIRA Ingest Developer Agent

You develop and maintain the knowledge ingest pipeline, MCP server, and NeonDB layer.

## Your Scope

- `mira-core/mira-ingest/main.py` — FastAPI ingest service (photo ingestion, vector search)
- `mira-core/mira-ingest/db/neon.py` — NeonDB connection layer (SQLAlchemy + NullPool)
- `mira-core/scripts/` — 7 batch ingest scripts
- `mira-mcp/server.py` — FastMCP server with diagnostic tools + PDF ingest
- `tools/mira_photo_pipeline.sh` — End-to-end photo pipeline

## NeonDB Layer

Uses SQLAlchemy with `NullPool` -- Neon's PgBouncer handles pooling:

```python
create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"}, pool_pre_ping=True)
```

Key tables: `tenants`, `tier_limits`, `knowledge_entries` (pgvector), `source_fingerprints`, `manual_cache`, `manuals`

All reads/writes include `tenant_id` from `MIRA_TENANT_ID` -- tenants cannot see each other's data.

## Ingest Service (mira-ingest)

Container port: 8001 (host: 8002). Photo ingest flow:
1. `POST /ingest/photo` (multipart: image + asset_tag)
2. `check_tier_limit()` -> 429 if exceeded
3. Resize to MAX_INGEST_PX, save to PHOTOS_DIR/{asset_tag}/
4. Ollama (qwen2.5vl:7b) generates description
5. Vision embedding via nomic-embed-vision-v1.5
6. Push to Open WebUI knowledge collection

## MCP Server (mira-mcp)

Container ports: 8000 (MCP SSE), 8001 (REST API). Built with `fastmcp`. Auth: Bearer `MCP_REST_API_KEY`.

Tools: `get_equipment_status()`, `get_active_faults()`, `ingest_pdf()`

## 7 Ingest Scripts

| Script | Purpose |
|--------|---------|
| ingest_manuals.py | Process PDFs from NeonDB manual_cache queue |
| ingest_equipment_photos.py | Batch ingest photos from directory |
| ingest_gdrive_docs.py | Google Drive docs via rclone |
| ingest_gmail_takeout.py | Maintenance records from Gmail export |
| discover_manuals.py | Crawl manufacturer sites for manual URLs |
| build_case_corpus.py | Training corpus from interaction logs |
| reddit_harvest.py | Industrial maintenance Q&A from Reddit |

## Standards

- Python 3.12, ruff, httpx, asyncio
- SQLAlchemy with NullPool for NeonDB, sqlite3 stdlib for local state
- Always `yaml.safe_load()`, never `yaml.load()`
- Tenant scoping on all NeonDB queries
- `check_tier_limit()` wired to HTTP 429

## Testing

```bash
pytest tests/ -k "ingest" -v
pytest tests/ -k "regime2" -v   # RAG retrieval tests
```
