# Ignition Tag Collector — Install & Operation

**Status:** Phase 3 of the gap-closure work stream
(`docs/plans/current-state-gap-closure-plan.md` §3 G8).
**Doctrine:** ADR-0021 (Ignition-module-first edge), `.claude/rules/fieldbus-readonly.md`.

The tag collector is a **Gateway Timer Script** that runs inside the customer's
Ignition Gateway JVM. On a fixed interval it browses a tag folder, reads the
allowlisted tags (**read-only — never writes a tag**), and POSTs them to MIRA
Cloud as an HMAC-signed batch. MIRA Cloud never opens a socket to the plant;
the gateway pushes outbound over HTTPS only.

```
Ignition Gateway (customer)                MIRA Cloud
┌──────────────────────────┐               ┌─────────────────────────────┐
│ tag-stream.py (timer)     │  HTTPS POST   │ mira-relay                   │
│  browse → read (RO)       │  HMAC-signed  │  /api/v1/tags/ingest         │
│  filter by allowlist      │ ────────────► │   allowlist (defense-in-     │
│  build Phase-2 batch      │   X-MIRA-*    │    depth) → UNS resolve →    │
│  sign (signing.py)        │   headers     │   tag_events (append) +      │
│  POST w/ retry+backoff    │               │   current_tag_state (upsert) │
└──────────────────────────┘               └─────────────────────────────┘
```

## Components

| File | Role |
|---|---|
| `ignition/gateway-scripts/tag-stream.py` | The deployable Gateway Timer Script (I/O + orchestration). |
| `ignition/webdev/FactoryLM/api/tags/collector.py` | Pure collector logic — payload build, value-type/quality inference, allowlist filter, signed POST with retry. Unit-tested (`tests/ignition/test_tag_collector.py`). |
| `ignition/webdev/FactoryLM/api/tags/allowlist.py` | Approved-tags allowlist loader (fail-closed). Reused. |
| `ignition/webdev/FactoryLM/api/chat/signing.py` | HMAC-SHA256 signer. Reused (same contract as `mira-relay/auth.py`). |
| `ignition/project/approved_tags.json` | The allowlist file. |

## Prerequisites (MIRA Cloud side)

The relay must be configured to verify the collector's signature and persist to
NeonDB. In `docker-compose.saas.yml` the `mira-relay` service now reads:

| Env var | Purpose |
|---|---|
| `MIRA_IGNITION_HMAC_KEY` | Per-tenant HMAC key. **Must match** the key the gateway signs with. If unset, the relay falls back to legacy bearer / open — do not ship without it. |
| `NEON_DATABASE_URL` | NeonDB DSN. `/api/v1/tags/ingest` writes `tag_events` + `live_signal_cache` here. If unset, the endpoint cannot persist. |

Both are sourced from Doppler (`factorylm/prd`). Apply migrations 032–036 first
(`apply-migrations.yml`) so `tag_events` / `approved_tags` / the
`live_signal_cache` freshness columns exist.

Seed `approved_tags` (migration 035) for the tenant — the relay enforces the
allowlist a second time on ingest (defense in depth). The
`normalized_tag_path` column must be produced by the same normalization the
relay uses (`tag_ingest.normalize_tag_path` / `uns.slug` semantics: lowercase,
runs of non-alphanumerics → `_`).

## Install (Ignition Gateway side)

1. **Deploy the pure modules to the project script library.** Recommended
   layout so the timer can `from factorylm import collector`:
   ```
   <project>/ignition/script-python/factorylm/
     ├── __init__.py
     ├── collector.py     (from api/tags/collector.py)
     ├── signing.py       (from api/chat/signing.py)
     └── allowlist.py     (from api/tags/allowlist.py)
   ```
   The timer falls back to a flat `import collector` if the modules are on the
   gateway script path instead.

2. **Place the allowlist** at one of the paths `allowlist.resolve_allowlist_path()`
   searches (e.g. `<ignition-data>/projects/factorylm/approved_tags.json`), or
   set `MIRA_ALLOWLIST_PATH`.

3. **Write `factorylm.properties`** (the timer reads it via `getMiraConfig`):
   ```properties
   INGEST_URL=https://api.factorylm.com/api/v1/tags/ingest
   TENANT_ID=<tenant-uuid>
   MIRA_HMAC_KEY=<per-tenant-hmac-key>          # matches relay MIRA_IGNITION_HMAC_KEY
   STREAM_TAG_FOLDER=[default]Mira_Monitored
   STREAM_SOURCE_CONNECTION_ID=<gateway-id>     # optional, stamped on every row
   STREAM_MAX_RETRIES=3
   ```
   Standard search paths:
   `C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties`
   (Windows) or `/usr/local/bin/ignition/data/factorylm/factorylm.properties` /
   `/var/lib/ignition/data/factorylm/factorylm.properties` (Linux).

4. **Create the Gateway Timer Script** (Config → Gateway Events → Timer):
   - Script: paste / reference `tag-stream.py`.
   - Delay: `2000` ms (Fixed Rate). Tune to the tag count and cloud budget.

5. **Verify.** Watch the gateway logger `FactoryLM.Mira.TagStream`:
   - `Streamed N/M allowlisted tags (attempts=1)` → working.
   - `MIRA tag-stream not configured` → `TENANT_ID` / `MIRA_HMAC_KEY` missing.
   - `Tag ingest failed status=401` → HMAC key mismatch with the relay.
   - `No allowlisted tags to stream` → allowlist empty or no tags matched.

## Behaviour & guarantees

- **Read-only.** Only `system.tag.browseTags` + `system.tag.readBlocking`. No
  `system.tag.write*`. Per ADR-0021 / fieldbus-readonly.md.
- **Allowlist fail-closed** on BOTH ends: an empty/missing allowlist drops every
  tag at the gateway, and the relay rejects any tag not in `approved_tags`.
- **Provenance.** Every batch is `source_system="ignition"` → the relay stamps
  `simulated=false`. A real gateway can never be mistaken for the simulator, and
  simulated data can never overwrite the real `current_tag_state` cache.
- **HMAC per request.** Each POST (and each retry) carries a fresh nonce +
  timestamp; the relay rejects replays (±300 s window, nonce store).
- **Retry/backoff.** `STREAM_MAX_RETRIES` attempts with exponential backoff
  (0.5 s, 1 s, …). 4xx responses (auth/validation) stop early — they won't fix
  themselves on retry. No local buffering; Ignition tag history covers gaps.

## Payload contract (POST /api/v1/tags/ingest)

```json
{
  "source_system": "ignition",
  "source_connection_id": "gateway-orlando-1",
  "tenant_id": "<tenant-uuid>",
  "tags": [
    {
      "tag_path": "[default]Mira_Monitored/conveyor_demo/Motor_Current_A",
      "value": 8.3,
      "value_type": "float",
      "quality": "good",
      "ts": "2026-06-02T12:00:00Z"
    }
  ]
}
```

Headers: `X-MIRA-Tenant`, `X-MIRA-Nonce`, `X-MIRA-Timestamp`, `X-MIRA-Signature`
(HMAC-SHA256 over `tenant\nnonce\ntimestamp\nsha256(body)`). Response:
`{status, accepted, events_written, state_upserts, cache_skipped, rejected[], simulated}`.
