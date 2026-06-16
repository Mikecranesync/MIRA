# mira-core Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Hosts the **Open WebUI** chat surface (which Open WebUI users see, and which `mira-pipeline` registers with as a model), the **MCPO proxy** that bridges Open WebUI tool-calls to MCP servers, and the **mira-ingest** photo/PDF pipeline. mira-core is the front door for everything that's not the marketing site or the authenticated hub.

## Scope
**IN scope**
- `mira-core` container — Open WebUI v0.8.10 (chat UI + KB admin) on `:3000 → :8080`
- `mira-mcpo` container — `mcpo + fastmcp` MCP-over-HTTP proxy on `:8000`
- `mira-docling` container — PDF parsing on `:5001`
- `mira-ingest` (lives in `mira-core/mira-ingest/`) — see below
- Build assets: `Dockerfile.mcpo`, `Modelfile`/`Modelfile.staging`, `mcpo-config.json`, `entrypoint-mira.sh`

**OUT of scope**
- Diagnostic engine (`mira-bots/shared`) — Open WebUI sends chat to `mira-pipeline`
- Vector store (`mira-mcp` for OpenViking, NeonDB for KB)

## Architecture
- **Layer:** Infrastructure
- **Containers:**
  - `mira-core` — Open WebUI (`3000 → 8080`); networks `core-net`, `bot-net`
  - `mira-mcpo` — MCP proxy (`:8000`); network `core-net`; image tag set by `MIRA_MCPO_VERSION`
  - `mira-docling` — Docling parser (`:5001`); network `core-net`
  - `mira-ingest` — FastAPI on `8002 → 8001`; network `core-net`
- **External deps:** Ollama on host (`:11434`), NeonDB, mira-mcp, mira-pipeline

## API Contract

### Open WebUI (mira-core)
- Standard Open WebUI REST + WebSocket. Bearer token = `OPENWEBUI_API_KEY`.
- Knowledge collection accepts file uploads via `/api/v1/files`, then attachment to a collection by UUID (`KNOWLEDGE_COLLECTION_ID`).
- "MIRA Diagnostic" model is registered as an external OpenAI-compat backend pointing at `mira-pipeline:9099`.

### mira-mcpo
- Exposes MCP tools as HTTP for Open WebUI's tool calling. Bearer token = `MCPO_API_KEY`.

### mira-ingest
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/db` | NeonDB connectivity + row counts |
| POST | `/ingest/photo` | multipart {asset_tag, location, notes, file} |
| POST | `/ingest/search` | Vector search over equipment_photos |

#### Photo pipeline
1. Multipart accepted; required `asset_tag`.
2. `_sanitize_image()` — strip EXIF, resize to `MAX_INGEST_PX` (default 1024) via Pillow.
3. `_describe_image()` — qwen2.5vl:7b via Ollama → ≤ 100-word maintenance description.
4. Embed text via `nomic-embed-text-v1.5`; embed image via `nomic-embed-vision-v1.5`.
5. Write SQLite `equipment_photos` row + push to Open WebUI knowledge collection.
6. `check_tier_limit(tenant_id)` — HTTP 429 if daily limit exceeded; **fail-open on DB error** (returns `(True, "")`).

#### NeonDB module (`db/neon.py`)
SQLAlchemy with `NullPool` (Neon PgBouncer handles pooling), `sslmode=require`.
| Function | Purpose |
|---|---|
| `recall_knowledge(emb, tenant_id, limit=5)` | pgvector `embedding <=> cast(:emb AS vector)` |
| `insert_knowledge_entry(...)` | Write a chunk |
| `knowledge_entry_exists(...)` | Dedup |
| `check_tier_limit(tenant_id)` | `(allowed, reason)` |
| `health_check()` | Tenant + knowledge_entries counts |

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `OPENWEBUI_API_KEY` | yes | — | Bearer for Open WebUI + KB push |
| `MCPO_API_KEY` | yes | — | Bearer for MCPO |
| `MIRA_MCPO_VERSION` | no | `3.4` | Image tag for built MCPO container |
| `BRAVO_HOST` | optional | — | Used by Oracle Cloud overrides |
| `NEON_DATABASE_URL` | yes (ingest) | — | NeonDB |
| `MIRA_TENANT_ID` | yes (ingest) | — | Tenant scope |
| `OLLAMA_BASE_URL` | yes | `http://host.docker.internal:11434` | Ollama host |
| `MIRA_DB_PATH` | yes (ingest) | `/app/mira.db` | SQLite path |
| `DESCRIBE_MODEL` | no | `qwen2.5vl:7b` | Vision description model |
| `MAX_INGEST_PX` | no | `1024` | Image dim cap |
| `KNOWLEDGE_COLLECTION_ID` | yes (ingest) | — | Open WebUI collection |
| `RELEVANCE_GATE_ENABLED` | no | off | Magic-inbox PDF relevance check via Groq |
| `GROQ_API_KEY` | when relevance gate on | — | Groq for relevance classifier |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| ingest test files | 4 | ≥ 8 (cover dedup, tier-limit fail-open, embed dimension) |
| Coverage (ingest) | 20 % measured | 50 % |
| Photo ingest p95 | unmeasured | ≤ 4 s including Ollama |
| EXIF leak | must strip | regression test required |

Domain grade: **C** (ingest), pending for Open WebUI surface (operational).

## Acceptance Criteria
1. **Photo round-trip:** `POST /ingest/photo` with a JPEG returns 200 and a row appears in `equipment_photos` and the Open WebUI collection.
2. **EXIF stripped:** Verify ingested file has no EXIF tags (`exiftool`).
3. **Resize cap:** A 4000px input image is resized to ≤ 1024 px on the longest edge.
4. **Tier-limit fail-open:** Killing NeonDB connectivity does not 5xx — request still ingests with a logged warning.
5. **Tier-limit enforce:** With NeonDB up and tenant over `daily_photo_limit`, request returns HTTP 429 with `reason`.
6. **Relevance gate:** With `RELEVANCE_GATE_ENABLED=true`, an irrelevant PDF posted via the magic-inbox path is rejected with reason; on Groq error, fail-open.
7. **MCP tool calling:** Open WebUI can call any of the 4 equipment tools via the MCPO proxy.
8. **Pipeline registration:** "MIRA Diagnostic" appears in Open WebUI model picker and routes to `mira-pipeline:9099`.

## Known Issues
- Embedding-provider switch requires deleting the relevant store + full re-ingest (dimension mismatch).
- Magic-inbox PDF path: relevance-gate cost is ~$0.00005/file via Groq; fail-open on any Groq error.

## Change Log
- 2026-04 — Magic-inbox PDF flow added; relevance gate (Unit 3.5) introduced behind flag.
- 2026-04 — Open WebUI upgraded to v0.8.10.
