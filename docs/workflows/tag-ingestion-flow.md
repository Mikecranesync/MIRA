# Tag Ingestion Flow

> **Cross-links:**
> - `docs/architecture/ENGINE_REFERENCE.md` — engine internals; the `live_tags` kwarg to `process()` is how live tag values reach the diagnostic engine after ingestion.
> - `docs/specs/dialogue-state-tracker-spec.md` — FSM context that consumes ingested tag state.
>
> **Last verified:** 2026-06-06 against source on branch `docs/comprehensive-runbooks-2026-06-06`.

## Summary

An Ignition gateway (or other approved source system) signs a batch of tag snapshots with HMAC-SHA256 and POSTs it to `mira-relay`. The relay authenticates the request, filters tags against an `approved_tags` allowlist (fail-closed), then atomically appends to the append-only `tag_events` stream and upserts the latest value into `live_signal_cache`. The Command Center Hub page reads `live_signal_cache` (extended with freshness columns by migration 036) to show live signal state. A flaky-tag detector (`flaky_detector.py`) reads `tag_events` to identify unstable inputs, but **its runtime trigger is not yet wired** (Phase-9 follow-up).

---

## The Flow

### Stage 1 — Source system prepares and signs the batch

**Source:** Ignition gateway, PLC bridge, or simulator
**File:** `mira-relay/auth.py`

1. The source system assembles a JSON payload:
   ```json
   {
     "tenant_id": "<uuid>",
     "tags": [
       {
         "tag_path": "GarageDemo/ConveyorSimple/ConvSpeed",
         "value": "45.2",
         "value_type": "float",
         "quality": "good",
         "source_system": "ignition",
         "event_timestamp": "2026-06-06T12:00:00Z"
       }
     ]
   }
   ```
   Valid `source_system` values: `{"ignition", "plc_bridge", "relay", "simulator"}` — **tag_ingest.py:53**.

2. Source signs the request with HMAC-SHA256. Required headers (**auth.py**):
   - `X-MIRA-Tenant`: tenant UUID
   - `X-MIRA-Nonce`: random UUID (replay protection)
   - `X-MIRA-Timestamp`: ISO-8601 UTC timestamp
   - `X-MIRA-Signature`: HMAC-SHA256 hex digest

3. **Signed string** (auth.py `verify_hmac()` at **line 70**):
   ```
   {tenant}\n{nonce}\n{timestamp_str}\n{sha256_hex(body_bytes)}
   ```
   HMAC key: `MIRA_IGNITION_HMAC_KEY` (Doppler `factorylm/prd`).

### Stage 2 — Relay receives and authenticates

**File:** `mira-relay/relay_server.py`

4. `POST /api/v1/tags/ingest` — route registered at **relay_server.py:385** (production NeonDB path).
   - Legacy `POST /ingest` at line 383 writes to SQLite bench store only — not this path.

5. **`tags_ingest()`** at **relay_server.py:250** — handler.

6. **`_authenticate_http()`** at **relay_server.py:184** — authentication waterfall:
   a. Tries HMAC (`verify_hmac()` from `auth.py:70`).
   b. Falls back to legacy bearer token.
   c. Falls back to open (no auth) if neither configured.

7. **`verify_hmac()` at auth.py:70** validates:
   - Timestamp within ±300 s (`TIMESTAMP_SKEW_SECONDS=300`).
   - Nonce not seen in the last 600 s (replay TTL). Replay store is in-process LRU, max 10,000 entries — ⚠️ **not cluster-safe** (restarts clear replay cache; multi-instance relay would allow replay across instances).
   - HMAC-SHA256 of signed string matches `X-MIRA-Signature`.

8. **`_get_tag_store()`** at **relay_server.py:243** — returns `NeonTagStore(os.getenv("NEON_DATABASE_URL", ""))`.

9. Handler calls `ingest_batch(payload, tenant_id, store)` from `tag_ingest.py`.

### Stage 3 — Batch normalization and allowlist filter

**File:** `mira-relay/tag_ingest.py`

10. **`ingest_batch()`** at **tag_ingest.py:172** — store-agnostic batch processor.

11. **`normalize_tag_path()`** at **tag_ingest.py:64** — uns.slug-style normalization: lowercase, non-alphanumeric runs collapsed to `_`, leading/trailing `_` stripped. Preserves `/` as path separator.

12. **`NeonTagStore.load_allowlist()`** at **tag_ingest.py:297** — loads **`approved_tags`** table from NeonDB for the tenant. Returns a set of allowed normalized tag paths.
    - **FAIL-CLOSED**: if `approved_tags` query fails or returns empty, **no tags are stored**. Tags not in the allowlist are silently dropped (never stored).

13. Each tag in the batch is checked against the allowlist. Tags failing the check are counted in `rejected_count` but never written.

### Stage 4 — Atomic write: tag_events + live_signal_cache

**File:** `mira-relay/tag_ingest.py`

14. **`NeonTagStore.flush()`** at **tag_ingest.py:341** — wraps both writes in a single transaction:

    **Write 1 — append to `tag_events`** (SQL at **tag_ingest.py:399–420**):
    ```sql
    INSERT INTO tag_events (
      event_id, tenant_id, equipment_entity_id, uns_path, tag_path,
      value, value_type, quality, source_system, source_connection_id,
      simulated, event_timestamp, ingested_at, metadata
    ) VALUES (...)
    ```
    - `tag_events` is **append-only**: `REVOKE UPDATE, DELETE` on the table (migration 033).
    - `simulated = true` for simulator source; real events set `simulated = false`.

    **Write 2 — upsert `live_signal_cache`** (SQL at **tag_ingest.py:421–452**):
    ```sql
    INSERT INTO live_signal_cache (tag_path, tenant_id, value, ...)
    ON CONFLICT (tag_path, tenant_id) DO UPDATE SET
      value = EXCLUDED.value,
      ...
    WHERE live_signal_cache.simulated = false
       OR EXCLUDED.simulated = false
    ```
    - **Simulated data NEVER overwrites a real cache row** — the `WHERE` guard ensures this.
    - `live_signal_cache` holds the latest-value snapshot per `tag_path` × `tenant_id`.

### Stage 5 — Freshness (live_signal_cache / current_tag_state)

**Migration:** `mira-hub/db/migrations/036_current_tag_state_freshness.sql`

15. Migration 036 **extends** `live_signal_cache` — it does NOT create a new table.
    Added columns: `uns_path LTREE`, `source_system TEXT`, `latest_quality TEXT`, `freshness_status TEXT DEFAULT 'unknown'`, `expected_freshness_seconds INTEGER`.

16. `freshness_status` values: `live | stale | unknown | simulated`.

17. The Command Center Hub page reads freshness via `mira-hub/src/app/api/command-center/tree/route.ts` — queries `live_signal_cache` and derives display state from `freshness_status`.

    > `live_signal_cache` IS `current_tag_state`. There is no separate table.

### Stage 6 — Flaky detector (logic present; runtime NOT wired)

**File:** `mira-relay/flaky_detector.py`

18. `flaky_detector.py` reads **`tag_events`** over a sliding time window and identifies tags with high toggle frequency (flaky inputs). Flaky candidates are written to **`flaky_input_signals`** (migration 034) and then as `ai_suggestions` rows with `suggestion_type='flaky_signal'`, `status='proposed'`, `created_by='rule'`.

19. ⚠️ **The runtime trigger that calls `run()` against the live window is NOT YET WIRED** (documented at **flaky_detector.py:32–34** as a Phase-9 follow-up). The detection logic is complete but no cron, worker, or scheduled task currently invokes it.

20. Flaky proposals are **never auto-verified** — they remain at `status='proposed'` until an admin or technician reviews them.

---

## Sequence Diagram

```
Ignition Gateway (or PLC bridge / simulator)
     │
     │  POST /api/v1/tags/ingest
     │  Headers: X-MIRA-Tenant, X-MIRA-Nonce, X-MIRA-Timestamp, X-MIRA-Signature
     │  Body: { tenant_id, tags: [...] }
     ▼
mira-relay: relay_server.py:tags_ingest() [line 250]
     │
     ├── _authenticate_http() [line 184]
     │     └── verify_hmac() [auth.py:70]
     │           ├── check timestamp ±300s
     │           ├── check nonce replay (LRU 10k, 600s TTL)
     │           └── verify HMAC-SHA256
     │
     ├── _get_tag_store() → NeonTagStore [line 243]
     │
     └── ingest_batch(payload, tenant_id, store) [tag_ingest.py:172]
           │
           ├── normalize_tag_path() [line 64]  ← uns.slug normalization
           │
           ├── NeonTagStore.load_allowlist()   [line 297]
           │     └── SELECT FROM approved_tags WHERE tenant_id=...
           │           FAIL-CLOSED: empty allowlist → reject all tags
           │
           ├── [filter] drop tags not in allowlist
           │
           └── NeonTagStore.flush()  [line 341]
                 │  (single transaction)
                 ├── INSERT INTO tag_events (append-only)
                 └── INSERT INTO live_signal_cache
                       ON CONFLICT DO UPDATE
                       (simulated guard: real rows never overwritten by sim)

[async, separate process — NOT YET WIRED]
flaky_detector.run()
     │  reads tag_events (sliding window)
     │  writes flaky_input_signals
     └── writes ai_suggestions (status='proposed', created_by='rule')

mira-hub: command-center/tree/route.ts
     │  SELECT FROM live_signal_cache (with freshness columns from mig 036)
     └── renders Command Center UNS-tree with live signal freshness
```

---

## Tables Touched

| Table | DB | Written by | Read by | Notes |
|---|---|---|---|---|
| `tag_events` | NeonDB | `NeonTagStore.flush()` (`tag_ingest.py:399`) | `flaky_detector.py`, analytics | Append-only; REVOKE UPDATE/DELETE; indexes on tenant+time, tag+time, uns_path GIST |
| `live_signal_cache` | NeonDB | `NeonTagStore.flush()` (`tag_ingest.py:421`) | `command-center/tree/route.ts`, engine (`live_tags` kwarg) | Latest-value snapshot; extended by mig 036 with freshness columns; IS `current_tag_state` |
| `approved_tags` | NeonDB | Hub admin UI (⚠️ UNVERIFIED — write path not traced) | `NeonTagStore.load_allowlist()` | FAIL-CLOSED allowlist per tenant |
| `flaky_input_signals` | NeonDB | `flaky_detector.py` (NOT YET WIRED) | Admin review UI (⚠️ UNVERIFIED) | Populated by flaky detector; migration 034 |
| `ai_suggestions` | NeonDB | `flaky_detector.py` (NOT YET WIRED) | Hub `/proposals` page | `suggestion_type='flaky_signal'`, `status='proposed'` |

---

## What Can Go Wrong

| Failure | Where | Symptom | Mitigation |
|---|---|---|---|
| `MIRA_IGNITION_HMAC_KEY` missing from Doppler | `auth.py:verify_hmac()` | All POSTs return 401 / authentication fails | Key must be set in Doppler `factorylm/prd`; confirmed missing as of 2026-06-06 demo audit |
| Timestamp skew > 300 s | `auth.py` | 401 rejected even with correct key | Sync clock on Ignition gateway; NTP required |
| Nonce replay (restart clears cache) | `auth.py` in-process LRU | Replayed request accepted after relay restart | Acceptable risk at single-instance scale; multi-instance relay requires shared replay store |
| Tag not in `approved_tags` | `tag_ingest.py:load_allowlist()` | Tag silently dropped (`rejected_count` incremented) | Add tag to `approved_tags` via Hub admin UI |
| `approved_tags` query fails | `tag_ingest.py:load_allowlist()` | ALL tags for that tenant are dropped (fail-closed) | Monitor relay error logs; NeonDB connectivity required |
| Simulated tag overwrites real | `tag_ingest.py:flush()` | Would corrupt live_signal_cache | Prevented by `WHERE` guard in upsert SQL; real rows safe |
| `live_signal_cache` shows stale | mig 036 freshness logic | `freshness_status='stale'` in Command Center | Check that Ignition is sending heartbeat tags at expected interval |
| Flaky detector never fires | `flaky_detector.py:32–34` | Unstable inputs never flagged in `ai_suggestions` | Phase-9 follow-up: wire `run()` to a cron/worker |
| Relay legacy `/ingest` path used | `relay_server.py:383` | Data written to SQLite bench store, not NeonDB | Use `/api/v1/tags/ingest` for production; bench path is SQLite only |
| `value_type` not in `(bool|int|float|string|enum)` | `tag_ingest.py` | Row rejected or stored with null type | Validate on Ignition side before sending |
