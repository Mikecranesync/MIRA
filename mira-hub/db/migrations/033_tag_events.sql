-- 033_tag_events.sql
-- Purpose : Append-only event stream of meaningful tag changes — rising/falling
--           edges, value-changed transitions, trend segments, fault windows.
--           Tenant-scoped twin of live_signal_events (mig 019) but NOT
--           session-bound; designed for long-lived multi-tenant retention.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2 / §D4
-- Retention: 90 days raw, then daily rollup (Phase 5 job)
-- Writer  : mira-relay/relay_server.py ingest endpoint (Phase 4/5)

-- ltree extension: required for uns_path LTREE column. Present on Neon prod
-- per mig 010; guard with IF NOT EXISTS for safety on fresh environments.
-- Verify this is enabled on staging before promoting.
CREATE EXTENSION IF NOT EXISTS ltree;

BEGIN;

CREATE TABLE IF NOT EXISTS tag_events (
  event_id         UUID PRIMARY KEY,                        -- UUIDv7 (caller-assigned for ordering)
  tenant_id        UUID NOT NULL,
  ts               TIMESTAMPTZ NOT NULL,                    -- event timestamp (NOT insert time)

  -- Tag identity
  uns_path         LTREE NOT NULL,                          -- requires: CREATE EXTENSION IF NOT EXISTS ltree (verify on staging)
  tag_id           TEXT NOT NULL,                           -- e.g., "Line5.B16.PE2_Occupied"

  -- Event classification
  event_type       TEXT NOT NULL                            -- rising_edge|falling_edge|value_changed|
                                                            -- trend_segment|fault_window_open|fault_window_close
    CHECK (event_type IN (
      'rising_edge', 'falling_edge', 'value_changed',
      'trend_segment', 'fault_window_open', 'fault_window_close'
    )),

  -- Value change detail
  prev_value       JSONB,
  new_value        JSONB,
  delta            DOUBLE PRECISION,
  threshold        DOUBLE PRECISION,

  -- Fault window bracketing (populated for fault_window_open / _close pairs)
  window_start     TIMESTAMPTZ,
  window_end       TIMESTAMPTZ,
  fault_code       TEXT,
  severity         TEXT,

  -- Signal quality
  raw_quality      TEXT                                     -- good|bad|stale
    CHECK (raw_quality IS NULL OR raw_quality IN ('good', 'bad', 'stale')),

  -- Relay provenance (trace back to the originating relay POST batch)
  relay_batch_id   UUID
);

-- Primary time-series scan per tenant
CREATE INDEX IF NOT EXISTS idx_tag_events_tenant_ts
  ON tag_events (tenant_id, ts DESC);

-- Per-tag history queries (mira_get_tag_events MCP tool)
CREATE INDEX IF NOT EXISTS idx_tag_events_tag_ts
  ON tag_events (tag_id, ts DESC);

-- UNS spatial lookup (mira_get_fault_windows MCP tool)
CREATE INDEX IF NOT EXISTS idx_tag_events_uns_path
  ON tag_events USING GIST (uns_path);

-- Fault window queries — partial index keeps this hot path small
CREATE INDEX IF NOT EXISTS idx_tag_events_fault_window
  ON tag_events (event_type, ts DESC)
  WHERE event_type IN ('fault_window_open', 'fault_window_close');

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_tag_events_fault_window;
-- DROP INDEX IF EXISTS idx_tag_events_uns_path;
-- DROP INDEX IF EXISTS idx_tag_events_tag_ts;
-- DROP INDEX IF EXISTS idx_tag_events_tenant_ts;
-- DROP TABLE IF EXISTS tag_events;
-- COMMIT;
