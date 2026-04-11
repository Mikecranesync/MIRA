# mira-mcp — Equipment Diagnostics MCP Server

FastMCP server exposing equipment diagnostic tools over SSE and REST.
Claude Desktop (and other MCP clients) connect via SSE on :8000.

## Tools (server.py)

| Tool | Signature | Purpose |
|------|-----------|---------|
| `get_equipment_status` | `(equipment_id="")` | Query `equipment_status` table; omit ID for all |
| `list_active_faults` | `()` | All unresolved faults from `faults WHERE resolved=0` |
| `get_fault_history` | `(equipment_id="", limit=50)` | Fault history, optional equipment filter |
| `get_maintenance_notes` | `(equipment_id="", category="", limit=50)` | Notes with optional filters |

`get_fault_history` appends OpenViking context chunks when `RETRIEVAL_BACKEND=openviking`
and `MIRA_TENANT_ID` is set. SQLite results are never replaced, only augmented.

## CMMS Tools (server.py — selected via `CMMS_PROVIDER`, supports atlas/maintainx/limble/fiix)

| Tool | Signature | Purpose |
|------|-----------|---------|
| `cmms_list_work_orders` | `(status="", limit=20)` | List work orders; filter by OPEN/IN_PROGRESS/COMPLETE |
| `cmms_create_work_order` | `(title, description, priority, asset_id, category)` | Create work order from diagnostic |
| `cmms_complete_work_order` | `(work_order_id, feedback="")` | Mark work order complete |
| `cmms_list_assets` | `(limit=50)` | List registered equipment assets |
| `cmms_get_asset` | `(asset_id)` | Get single asset details |
| `cmms_list_pm_schedules` | `(asset_id=0, limit=20)` | List preventive maintenance schedules |
| `cmms_health` | `()` | Check configured CMMS API connectivity |

Adapter dispatch in `cmms/factory.py` → `cmms/{atlas,maintainx,limble,fiix}.py`. The `/api/cmms/invite` REST endpoint is Atlas-only and returns HTTP 501 for other providers.

## REST Endpoints

`POST /ingest/pdf` — receive PDF, save to `pdfs/` subdir alongside mira.db,
index into viking store via `context/viking_store.ingest_pdf()`.
Derives `equipment_type` from filename stem via `_equipment_type_from_name()`.

### CMMS REST (proxied from Atlas)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/cmms/work-orders?status=&limit=` | List work orders |
| POST | `/api/cmms/work-orders` | Create work order (JSON body) |
| GET | `/api/cmms/assets?limit=` | List assets |
| GET | `/api/cmms/pm-schedules?asset_id=&limit=` | List PM schedules |
| GET | `/api/cmms/health` | Atlas connectivity check |

## Auth

Bearer token: all REST requests require `Authorization: Bearer $MCP_REST_API_KEY`.
Missing key logged as ERROR at startup; SSE port still accepts connections.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 8000 (host: `MCP_SSE_PORT`, default 8009) | SSE | MCP client connections |
| 8001 | HTTP REST | PDF ingest + health |

Healthcheck: `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/sse')"`

## Key Env Vars

| Var | Purpose |
|-----|---------|
| `MCP_REST_API_KEY` | Bearer token for REST auth |
| `MIRA_DB_PATH` | Path to mira.db (mounted from mira-bridge volume) |
| `RETRIEVAL_BACKEND` | `openwebui` (default) or `openviking` |
| `MIRA_TENANT_ID` | Scopes OpenViking retrieval |
| `CMMS_PROVIDER` | Selects CMMS adapter: `atlas` (default) \| `maintainx` \| `limble` \| `fiix` |
| `ATLAS_API_URL` | Atlas CMMS API base URL (default: `http://atlas-api:8080`) |
| `ATLAS_API_USER` | Atlas CMMS login email (required when `CMMS_PROVIDER=atlas`) |
| `ATLAS_API_PASSWORD` | Atlas CMMS login password |
| `MAINTAINX_API_KEY` | MaintainX API key (required when `CMMS_PROVIDER=maintainx`) |

## Volume

Mounts `mira-bridge/data` at `/mira-db` — same SQLite file that mira-bridge writes.
`MIRA_DB_PATH=/mira-db/mira.db` inside container.
