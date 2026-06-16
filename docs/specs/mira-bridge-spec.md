# mira-bridge Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Node-RED 4.x container that owns the **shared SQLite WAL database** (`mira-bridge/data/mira.db`) and routes inbound webhooks / REST triggers to MIRA core services. Acts as the canonical writer for `mira.db`; every other container that touches the file (mira-mcp, mira-ingest, mira-pipeline, bot adapters) reads via the same Docker volume — never copy.

## Scope
**IN scope**
- `nodered/node-red:4.1.7-22` container on `:1880`
- Flow definitions in `flows/` (committed JSON)
- SQLite WAL DB + bind-mount layout
- Visual orchestration of dashboards, scheduled tasks, setup wizard

**OUT of scope**
- Diagnostic engine logic (`mira-bots/shared`)
- KB ingestion (`mira-ingest`, `mira-crawler`)
- CMMS integration (`mira-mcp`)

## Architecture
- **Layer:** Infrastructure
- **Network:** `core-net`
- **Persistence:** SQLite WAL at `data/mira.db` — bind-mounted into:
  - `mira-bridge` itself at `/data` (read/write — owner)
  - `mira-mcp` at `/mira-db` (read)
  - `mira-pipeline` at `/data` (read/write for state + sessions)
  - bot adapters at `/data` (read/write for state + history)

```
Inbound (webhook / REST / cron) → Node-RED flows → mira-bridge writes mira.db
                                                          │
                              other containers read same file via volume
```

## API Contract
| Surface | Endpoint | Notes |
|---|---|---|
| HTTP-in nodes | `:1880/<flow-defined>` | Configurable per flow |
| Editor UI | `:1880/` | Authenticated (Node-RED admin auth) |
| Healthcheck | `curl -f http://localhost:1880/` | 200 when HTTP server up |

### Flows committed
- `mira-dashboard-conveyor.json` — operator dashboard for the Conveyor MIRA demo
- `mira-scheduled-tasks.json` — scheduled jobs (e.g., heartbeat, log rotations)
- `mira-setup-wizard.json` — first-run setup wizard

Editing pattern: open Node-RED UI → modify → export JSON → commit the updated file.

## Configuration
| Var | Default | Purpose |
|---|---|---|
| `NODERED_PORT` | `1880` | Host port |
| `MIRA_DB_PATH` | `./data` | Host directory bind-mounted to `/mira-db` (writers see `/data/mira.db`) |
| Node-RED admin user/pass | set in Node-RED settings | UI auth |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Tests | none | Add a smoke flow that opens DB, runs a SELECT, asserts WAL mode |
| Schema drift | not tracked | Migrations live with the consumer; bridge never adds tables |
| Restart MTTR | unmeasured | ≤ 30 s |

## Acceptance Criteria
1. **WAL mode:** `PRAGMA journal_mode` on `mira.db` returns `wal`.
2. **Single writer invariant:** No schema migration is run from any other container while `mira-bridge` is up. Migrations either run with bridge stopped or use `Supervisor._ensure_table()` patterns (CREATE IF NOT EXISTS + retry on `database is locked`).
3. **Volume sharing:** Modifying a row from `mira-bridge` is visible to `mira-mcp` immediately on next read.
4. **Healthcheck:** `:1880/` returns HTTP 200 within 30 s of container start.
5. **Flow stability:** Restarting `mira-bridge` reloads all 3 flows from `flows/`.
6. **Backup:** A daily SQLite backup of `mira.db` exists (operational, not in this repo).

## Known Issues
- `mira-bridge` holds the SQLite write lock; running schema migrations against `mira.db` from other containers while it is up risks `database is locked` errors.
- Flow JSON edits made in the UI are not auto-committed — must export + commit by hand.

## Change Log
- 2026-04 — Setup wizard flow added.
