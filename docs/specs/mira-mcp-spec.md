# mira-mcp Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
FastMCP server that exposes equipment-diagnostic tools and CMMS bridges over **MCP/SSE** (for Claude Desktop and other MCP clients) and a parallel **REST surface** (for `mira-web`, `mira-hub`, and ad-hoc PDF ingest). It is the single integration point for everything that needs structured equipment + work-order data; all callers go through it and never reach Atlas/MaintainX directly.

## Scope
**IN scope**
- 4 equipment-diagnostic MCP tools (status, faults, history, notes)
- 7 CMMS MCP tools dispatched via `cmms/factory.py` to `atlas`/`maintainx`/`limble`/`fiix` adapters
- `/ingest/pdf` REST endpoint (writes to OpenViking store)
- CMMS REST proxy at `/api/cmms/*`

**OUT of scope**
- KB ingestion of photos (`mira-ingest`)
- Crawling/discovery of new manuals (`mira-crawler`)
- Diagnostic conversation engine (`mira-bots/shared`)

## Architecture
- **Layer:** Engine
- **Container:** `mira-mcp` on `:8000` (SSE, host `MCP_SSE_PORT`, default `8009`) and `:8001` (REST)
- **Network:** `core-net`
- **Volume:** mounts `mira-bridge/data:/mira-db` so it reads the same `mira.db` file `mira-bridge` writes
- **Adapters:** `cmms/{atlas,maintainx,limble,fiix}.py`
- **External integrations:** Atlas REST (`atlas-api:8080`), MaintainX API, OpenViking/NeonDB

```
Claude Desktop ──SSE :8000──▶ mira-mcp ──┬──▶ sqlite mira.db (faults, equipment, notes)
                                         ├──▶ Atlas/MaintainX/Limble/Fiix REST
                                         └──▶ OpenViking store (when RETRIEVAL_BACKEND=openviking)
mira-web/hub ──REST :8001──▶ mira-mcp /api/cmms/*
```

## API Contract

### MCP tools — equipment diagnostics
| Tool | Signature | Backing data |
|---|---|---|
| `get_equipment_status` | `(equipment_id="")` | `equipment_status` table |
| `list_active_faults` | `()` | `faults WHERE resolved=0` |
| `get_fault_history` | `(equipment_id="", limit=50)` | `faults` + OpenViking chunks if backend set |
| `get_maintenance_notes` | `(equipment_id="", category="", limit=50)` | `maintenance_notes` |

### MCP tools — CMMS (selected via `CMMS_PROVIDER`)
| Tool | Signature |
|---|---|
| `cmms_list_work_orders` | `(status="", limit=20)` |
| `cmms_create_work_order` | `(title, description, priority, asset_id, category)` |
| `cmms_complete_work_order` | `(work_order_id, feedback="")` |
| `cmms_list_assets` | `(limit=50)` |
| `cmms_get_asset` | `(asset_id)` |
| `cmms_list_pm_schedules` | `(asset_id=0, limit=20)` |
| `cmms_health` | `()` |

### REST surface
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness |
| POST | `/ingest/pdf` | Bearer | Multipart upload → OpenViking |
| GET | `/api/cmms/work-orders?status=&limit=` | Bearer | List WOs |
| POST | `/api/cmms/work-orders` | Bearer | Create WO |
| GET | `/api/cmms/assets?limit=` | Bearer | List assets |
| GET | `/api/cmms/pm-schedules?asset_id=&limit=` | Bearer | List PM schedules |
| GET | `/api/cmms/health` | Bearer | Atlas connectivity |
| POST | `/api/cmms/invite` | Bearer | **Atlas-only**; HTTP 501 for other providers |

Bearer token: `Authorization: Bearer ${MCP_REST_API_KEY}`.

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `MCP_REST_API_KEY` | yes | — | Bearer auth for REST |
| `MCP_SSE_PORT` | no | `8009` | Host port for SSE |
| `MIRA_DB_PATH` | yes | `/mira-db/mira.db` | SQLite path |
| `RETRIEVAL_BACKEND` | no | `openwebui` | `openwebui` or `openviking` |
| `MIRA_TENANT_ID` | needed when openviking | — | Tenant scope |
| `CMMS_PROVIDER` | no | `atlas` | `atlas` \| `maintainx` \| `limble` \| `fiix` |
| `ATLAS_API_URL` | atlas | `http://atlas-api:8080` | Atlas base URL |
| `ATLAS_API_USER` / `ATLAS_API_PASSWORD` | atlas | — | Atlas auth |
| `MAINTAINX_API_KEY` | maintainx | — | MaintainX API key |
| `ATLAS_PUBLIC_API_URL` | optional | — | Public URL hint (used by hub deep-links) |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Tests | 1 file | ≥ 12 files (one per MCP tool + adapter contract) |
| Adapter contract tests | none | one parametric suite across 4 providers |
| MCP latency p50 | unmeasured | ≤ 250 ms tool call |
| REST latency p50 | unmeasured | ≤ 150 ms |

Domain grade: **D+**.

## Acceptance Criteria
1. **MCP discovery:** Claude Desktop with `mira-mcp` configured shows the 4 equipment + 7 CMMS tools.
2. **Auth:** A REST request without a bearer returns HTTP 401; with the wrong token returns HTTP 403.
3. **Adapter dispatch:** Setting `CMMS_PROVIDER=maintainx` and calling `cmms_list_work_orders` returns MaintainX data; `/api/cmms/invite` returns HTTP 501.
4. **PDF ingest:** `POST /ingest/pdf` with a multipart file lands a file in `pdfs/` and indexes it via `viking_store.ingest_pdf()`; `equipment_type` is derived from the filename stem.
5. **Read isolation:** mira-mcp does NOT write to `mira.db` while `mira-bridge` is up (verify via `lsof` or strace test).
6. **Health surface:** `/health` returns 200 in < 50 ms; `/api/cmms/health` reflects upstream Atlas reachability.

## Known Issues
- Single test file → grade D+; needs adapter contract suite.
- `/api/cmms/invite` is Atlas-specific by design; non-Atlas providers must return HTTP 501.
- Volume mount must match `mira-bridge` path or both services see different `mira.db` files (silent corruption risk).

## Change Log
- 2026-04 — Multi-provider CMMS adapters introduced (`atlas`/`maintainx`/`limble`/`fiix`).
- 2026-04 — OpenViking augmentation added behind `RETRIEVAL_BACKEND=openviking`.
