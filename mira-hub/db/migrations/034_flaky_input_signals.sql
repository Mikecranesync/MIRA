-- 034_flaky_input_signals.sql
-- Purpose : Rolling-window flicker detector output — one row per detected
--           unstable-input episode (rapid toggle, brown-out, intermittent
--           disconnect, value spike). Bridges to ai_suggestions for Hub
--           surfacing as 'flaky_signal_alert' proposals.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2 / §D6
-- Detector: mira-bots/agents/flaky_input_detector.py (Phase 9)

BEGIN;

CREATE TABLE IF NOT EXISTS flaky_input_signals (
  alert_id          UUID PRIMARY KEY,                       -- UUIDv7
  tenant_id         UUID NOT NULL,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Tag identity (ltree from mig 010 extension)
  uns_path          LTREE NOT NULL,                         -- requires: CREATE EXTENSION IF NOT EXISTS ltree (verify on staging)
  tag_id            TEXT NOT NULL,

  -- Rule that triggered this alert
  rule_id           TEXT NOT NULL                           -- 'rapid_toggle' | 'brown_out' | 'intermittent_disc' | 'value_spike'
    CHECK (rule_id IN ('rapid_toggle', 'brown_out', 'intermittent_disc', 'value_spike')),

  -- Detection window
  window_start      TIMESTAMPTZ NOT NULL,
  window_end        TIMESTAMPTZ NOT NULL,

  -- Evidence counts
  transitions_count INT,                                    -- observed transitions in window
  expected_max      INT,                                    -- configured threshold for rule_id

  -- Bridge to ai_suggestions (suggestion_type='flaky_signal_alert' when populated)
  -- FK to ai_suggestions(id) — ai_suggestions table guaranteed present from mig 027.
  ai_suggestion_id  UUID REFERENCES ai_suggestions(id),

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'open'            -- open|acknowledged|resolved|false_positive
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),

  -- Arbitrary per-rule metadata (e.g., sample values, cycle correlation)
  metadata          JSONB
);

-- Primary scan: tenant-scoped, newest first
CREATE INDEX IF NOT EXISTS idx_flaky_input_tenant_ts
  ON flaky_input_signals (tenant_id, detected_at DESC);

-- Hub inbox: open alerts only — partial index keeps this fast
CREATE INDEX IF NOT EXISTS idx_flaky_input_open
  ON flaky_input_signals (status)
  WHERE status = 'open';

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_flaky_input_open;
-- DROP INDEX IF EXISTS idx_flaky_input_tenant_ts;
-- DROP TABLE IF EXISTS flaky_input_signals;
-- COMMIT;
