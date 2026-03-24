# mira-core/mira-ingest — Photo Ingest & Knowledge Service

FastAPI service on port 8001. Receives equipment photos, runs vision description,
embeds, and stores to both SQLite and NeonDB. Also serves vector search.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness check |
| GET | `/health/db` | NeonDB connectivity + row counts |
| POST | `/ingest/photo` | Multipart upload: asset_tag, location, notes, file |
| POST | `/ingest/search` | Vector search over ingested equipment photos |

## Photo Pipeline (main.py)

1. Receive multipart POST with `asset_tag`, `location`, `notes`, `file`
2. `_sanitize_image(data)` — strips EXIF, resizes to `MAX_INGEST_PX` (default 1024px) via Pillow
3. `_describe_image(b64)` — calls `qwen2.5vl:7b` via Ollama, returns <100-word maintenance description
4. Embed description text via `nomic-embed-text-v1.5`; embed image via `nomic-embed-vision-v1.5`
5. Write row to SQLite `equipment_photos` table + push to Open WebUI knowledge collection
6. `check_tier_limit(tenant_id)` — returns HTTP 429 if daily limit exceeded

## NeonDB Module (db/neon.py)

Connection: SQLAlchemy + `NullPool` (Neon's PgBouncer handles pooling), `sslmode=require`.

Key functions:

| Function | Purpose |
|----------|---------|
| `get_tenant(tenant_id)` | Fetch tenant row from `tenants` table |
| `get_tier_limits(tier)` | Fetch limits row for a tier name |
| `recall_knowledge(embedding, tenant_id, limit=5)` | pgvector cosine similarity over `knowledge_entries` |
| `insert_knowledge_entry(...)` | Write a new knowledge chunk |
| `knowledge_entry_exists(...)` | Deduplication check before insert |
| `check_tier_limit(tenant_id)` | Returns `(allowed: bool, reason: str)` |
| `health_check()` | Returns tenant count + knowledge_entries count |

`recall_knowledge` uses `embedding <=> cast(:emb AS vector)` (pgvector operator).
Fail-open pattern: `check_tier_limit` always returns `(True, "")` on DB errors.

## Ingest Scripts (../scripts/)

| Script | Purpose |
|--------|---------|
| `ingest_manuals.py` | Fetch PDFs from `manual_cache` / `manuals` tables, chunk, embed |
| `ingest_equipment_photos.py` | Bulk-ingest photos from local directory |
| `ingest_gdrive_docs.py` | Pull Google Drive documents into knowledge base |
| `ingest_gmail_takeout.py` | Index Gmail Takeout exports |
| `reddit_harvest.py` | Harvest relevant Reddit threads |
| `build_case_corpus.py` | Build diagnostic case corpus |
| `discover_manuals.py` | Search for equipment manuals by make/model |

## Key Env Vars

| Var | Default | Purpose |
|-----|---------|---------|
| `NEON_DATABASE_URL` | required | NeonDB connection string |
| `MIRA_TENANT_ID` | required | Tenant scoping for all NeonDB writes |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama host |
| `MIRA_DB_PATH` | `/app/mira.db` | SQLite path |
| `DESCRIBE_MODEL` | `qwen2.5vl:7b` | Vision description model |
| `MAX_INGEST_PX` | `1024` | Max image dimension before resize |
| `OPENWEBUI_API_KEY` | required | Auth for Open WebUI knowledge push |
