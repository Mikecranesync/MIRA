# CMMS Sync Flow

> **Cross-links:**
> - `docs/THEORY_OF_OPERATIONS.md` — CMMS layer role in the overall product (evidence layer for grounded troubleshooting).
> - `docs/specs/mira-component-intelligence-architecture.md` — how work orders and PM schedules feed component profiles.
>
> **Last verified:** 2026-06-06 against source on branch `docs/comprehensive-runbooks-2026-06-06`.

## Summary

A background worker syncs work orders and PM schedules between NeonDB and the Atlas CMMS (at `cmms.factorylm.com`). The worker is disabled by default (`CMMS_SYNC_ENABLED` must be set to `"true"`). Forward sync pushes NeonDB-created records to Atlas; reverse sync polls Atlas for updates and writes them back to NeonDB, logging conflicts instead of overwriting. Atlas's free-tier 30-incomplete-WO limit triggers an exponential cooldown. The diagnostic engine reads CMMS data via MCP tools (`mira-mcp/server.py`), not directly from the sync worker.

---

## The Flow

### Stage 0 — Worker startup and enable check

**File:** `mira-hub/scripts/cmms-sync-worker.ts`
**File:** `mira-hub/src/lib/atlas/sync.ts`

1. `cmms-sync-worker.ts` starts. Checks `CMMS_SYNC_ENABLED` at **sync.ts:61**:
   ```ts
   (process.env.CMMS_SYNC_ENABLED ?? "false").toLowerCase() === "true"
   ```
   If not `"true"`, worker exits immediately — no-op. **Default is disabled.**

2. Worker requires these env vars (all via Doppler `factorylm/prd`):
   - `NEON_DATABASE_URL` — NeonDB connection string
   - `HUB_CMMS_API_URL` — Atlas base URL (default: `https://cmms.factorylm.com`)
   - `ATLAS_API_USER` — Basic auth username
   - `ATLAS_API_PASSWORD` — Basic auth password

3. **`tick()` at cmms-sync-worker.ts:83** — called on startup and then every `INTERVAL_MS` (default 60,000 ms / 60 s). Can be overridden with `--once` flag for a single run.

### Stage 1 — Forward sync: NeonDB → Atlas

**File:** `mira-hub/src/lib/atlas/sync.ts`

4. **`runForwardSync(client)`** called from `tick()`.

5. **Work orders forward** (sync.ts line 239+):
   - Selects rows from **`work_orders`** where `cmms_synced_at IS NULL OR cmms_synced_at < updated_at` (not yet synced, or updated since last sync).
   - For each unsynced WO: `POST {HUB_CMMS_API_URL}/api/work-orders` to create in Atlas.
   - If Atlas returns a 200/201: updates `work_orders.cmms_synced_at` and stores the Atlas-assigned ID in `work_orders.atlas_id`.
   - If Atlas returns a 409 (conflict / already exists): switches to `PATCH` to update the existing Atlas record.

6. **PM schedules forward** (sync.ts line 322+):
   - Selects rows from **`pm_schedules`** where `cmms_synced_at IS NULL OR cmms_synced_at < updated_at`.
   - Same create/update pattern as work orders.

7. **Atlas quota breaker** — **`isQuotaError()`** at **sync.ts:94**:
   - Atlas free tier caps at 30 **incomplete** work orders. Exceeding this returns a quota error.
   - On quota error: worker enters exponential cooldown — 5 min → 10 min → … → max 60 min.
   - Cooldown counter resets when a successful sync completes.

### Stage 2 — Reverse sync: Atlas → NeonDB

**File:** `mira-hub/src/lib/atlas/sync.ts`

8. **`runReverseSync(client)`** called from `tick()` after forward sync.

9. **Work orders reverse**:
   - Polls `GET {HUB_CMMS_API_URL}/api/work-orders` (paginated) for all Atlas WOs updated since `cmms_sync_checkpoints` last-checked timestamp.
   - For each returned WO:
     - If `atlas_id` matches a row in **`work_orders`**: checks whether Atlas value conflicts with NeonDB value.
       - **No conflict**: updates the NeonDB row, stamps `cmms_synced_at`.
       - **Conflict** (both sides changed since last sync): calls **`logConflict()`** at **sync.ts:455** — does NOT overwrite NeonDB. Writes to **`cmms_sync_conflicts`**.
     - If `atlas_id` not found in NeonDB: inserts a new `work_orders` row (Atlas is source of truth for externally-created WOs).

10. **`logConflict()` at sync.ts:455**:
    ```sql
    INSERT INTO cmms_sync_conflicts (
      tenant_id, resource, neondb_id, atlas_id, atlas_payload, reason
    ) VALUES (...)
    ```
    The raw Atlas JSON is preserved in `atlas_payload` for human review. NeonDB row is NOT touched.

11. **Assets and PMs reverse**: same poll-and-reconcile pattern for `assets` and `pm_schedules`.

12. **Checkpoint update**: on successful reverse sync, updates **`cmms_sync_checkpoints`** with the latest `checked_at` timestamp so next tick only pulls incremental changes.

### Stage 3 — Engine access via MCP tools

**File:** `mira-mcp/server.py`

13. The diagnostic engine does NOT call the sync worker or read sync tables directly. It accesses CMMS data via MCP tool calls to `mira-mcp`:

    | Tool | Location | What it does |
    |---|---|---|
    | `cmms_list_work_orders(status, limit)` | server.py:327 | List WOs by status |
    | `cmms_write_work_order(...)` | server.py:274 | Create/update a WO |
    | `cmms_create_work_order(...)` | server.py:305 | Create new WO |
    | `cmms_complete_work_order(work_order_id, feedback)` | server.py:337 | Mark WO resolved |
    | `cmms_list_assets(limit)` | server.py:346 | List assets |
    | `cmms_get_asset(asset_id)` | server.py:356 | Fetch single asset |
    | `cmms_list_pm_schedules(asset_id, limit)` | server.py:365 | List PM schedules |
    | `cmms_health()` | server.py:378 | Check Atlas connectivity |

14. MCP tool calls go to `mira-mcp` container at `MCP_BASE_URL` (default `http://mira-mcp:8001`). The MCP server reads from **`work_orders`** and **`pm_schedules`** in NeonDB — the same tables the sync worker maintains.

### Stage 4 — Hub display

**Files:** `mira-hub/src/app/(hub)/workorders/page.tsx`, `mira-hub/src/app/(hub)/schedule/page.tsx`, `mira-hub/src/app/(hub)/cmms/page.tsx`

15. Hub UI pages read `work_orders`, `pm_schedules`, and related tables via Hub API routes (all wrapped in `withTenantContext()` — RLS enforced). Displays WO status, PM due dates, asset linkage.

---

## Sequence Diagram

```
[background worker — every 60s or --once]

cmms-sync-worker.ts:tick()
     │
     ├── syncEnabled()? [sync.ts:61]
     │     CMMS_SYNC_ENABLED != "true" → EXIT (default)
     │
     ├── runForwardSync(client)  [sync.ts:239+]
     │     │
     │     ├── SELECT work_orders WHERE cmms_synced_at IS NULL
     │     │         OR cmms_synced_at < updated_at
     │     │
     │     ├── POST {ATLAS}/api/work-orders (create)
     │     │   OR PATCH (if 409 conflict)
     │     │
     │     ├── UPDATE work_orders SET cmms_synced_at, atlas_id
     │     │
     │     ├── SELECT pm_schedules WHERE needs sync
     │     ├── POST/PATCH {ATLAS}/api/pm-schedules
     │     └── [quota error] → exponential cooldown (5m→60m)
     │
     └── runReverseSync(client)  [sync.ts]
           │
           ├── GET {ATLAS}/api/work-orders (since last checkpoint)
           │
           ├── for each Atlas WO:
           │     ├── match in NeonDB work_orders by atlas_id
           │     │     ├── no conflict → UPDATE work_orders
           │     │     └── conflict → logConflict() → INSERT cmms_sync_conflicts
           │     └── not found → INSERT work_orders (Atlas-originated)
           │
           ├── same for assets, pm_schedules
           └── UPDATE cmms_sync_checkpoints (last checked_at)

[diagnostic engine — on each turn]

engine.py:process_full()
     │
     └── [CMMS pending check]
           │
           └── MCP tool call → mira-mcp/server.py
                 ├── cmms_list_work_orders()  → SELECT FROM work_orders
                 ├── cmms_get_asset()         → SELECT FROM assets (⚠️ UNVERIFIED table name)
                 └── cmms_list_pm_schedules() → SELECT FROM pm_schedules

[Hub UI — on page load]

Hub page (workorders/page.tsx, schedule/page.tsx)
     └── Hub API route → withTenantContext() → SELECT FROM work_orders / pm_schedules
```

---

## Tables Touched

| Table | DB | Written by | Read by | Notes |
|---|---|---|---|---|
| `work_orders` | NeonDB | `runForwardSync()`, `runReverseSync()`, `cmms_create_work_order` MCP tool | Hub UI, MCP tools, `runForwardSync()` | Core sync table; `cmms_synced_at` and `atlas_id` columns track sync state |
| `pm_schedules` | NeonDB | `runForwardSync()`, `runReverseSync()` | Hub UI, MCP tools | PM schedule sync state same pattern as work_orders |
| `cmms_sync_conflicts` | NeonDB | `logConflict()` at sync.ts:455 | Human review (⚠️ UNVERIFIED — Hub conflict view not traced) | Raw Atlas payload preserved in `atlas_payload`; NeonDB row NOT overwritten |
| `cmms_sync_checkpoints` | NeonDB | `runReverseSync()` checkpoint update | `runReverseSync()` | Stores `checked_at` timestamp for incremental polling |
| `assets` | NeonDB | `runReverseSync()` (Atlas-originated assets) | MCP `cmms_list_assets()`, `cmms_get_asset()` | ⚠️ UNVERIFIED exact column set; assumed to mirror Atlas asset schema |

---

## What Can Go Wrong

| Failure | Where | Symptom | Mitigation |
|---|---|---|---|
| `CMMS_SYNC_ENABLED` not set | `sync.ts:61` | Worker exits silently; no sync occurs | Set to `"true"` in Doppler `factorylm/prd` to enable |
| Atlas quota exceeded (>30 open WOs) | `isQuotaError()` at sync.ts:94 | Forward sync pauses; exponential cooldown triggers | Close completed WOs in Atlas; free-tier limit is 30 **incomplete** |
| Atlas credentials wrong | `ATLAS_API_USER` / `ATLAS_API_PASSWORD` | 401 on all Atlas calls; sync fails silently or logs error | Verify credentials in Doppler; check Atlas dashboard |
| Conflict on both sides | `logConflict()` at sync.ts:455 | Record written to `cmms_sync_conflicts`; NeonDB NOT updated | Human review required; no auto-resolution |
| NeonDB connectivity lost | `sync.ts` | Sync tick errors; no write to `cmms_sync_checkpoints` | Next tick retries from last checkpoint; gap in sync window possible |
| Atlas API rate limit | Atlas HTTP 429 | Reverse sync partially fails | Worker does not currently implement Atlas rate-limit backoff (⚠️ UNVERIFIED — check sync.ts error handling) |
| `cmms_sync_checkpoints` stale | `runReverseSync()` | Large Atlas poll on next tick; potential timeout | Checkpoints are updated per successful tick; brief NeonDB outage → one large catch-up poll |
| MCP tool returns stale data | `mira-mcp/server.py` | Engine cites old WO status | MCP reads NeonDB directly; freshness bounded by sync interval (60 s) |
| Sync worker not running | `cmms-sync-worker.ts` | NeonDB WOs never reach Atlas (and vice versa) | Check container health; worker must be running continuously |
