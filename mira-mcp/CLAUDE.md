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

## REST Endpoint

`POST /ingest/pdf` — receive PDF, save to `pdfs/` subdir alongside mira.db,
index into viking store via `context/viking_store.ingest_pdf()`.
Derives `equipment_type` from filename stem via `_equipment_type_from_name()`.

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

## Volume

Mounts `mira-bridge/data` at `/mira-db` — same SQLite file that mira-bridge writes.
`MIRA_DB_PATH=/mira-db/mira.db` inside container.
