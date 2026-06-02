-- 035_approved_tags.sql
-- Purpose : First-class table backing the approved_tags.json allowlist (Ignition D1).
--           Replaces the file-based allowlist with a tenant-scoped, GIST-indexed
--           schema that both mira-relay /ingest and Ignition WebDev /tags enforce.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1 / §D2
--           Phase 4 §D1: migrate approved_tags.json → this table; ship
--           approved_tags_compat.json writer for backwards compat during cutover.
-- Spec    : docs/mira-ignition-secure-architecture.md §D1 (allowlist enforcement)

BEGIN;

CREATE TABLE IF NOT EXISTS approved_tags (
  tenant_id             UUID NOT NULL,
  tag_id                TEXT NOT NULL,                      -- e.g., "Line5.B16.PE2_Occupied"

  -- UNS identity (required — tag must belong to a known UNS path)
  -- requires: CREATE EXTENSION IF NOT EXISTS ltree (verify on staging)
  uns_path              LTREE NOT NULL,

  -- Tag metadata
  data_type             TEXT NOT NULL                       -- bool|int|float|enum
    CHECK (data_type IN ('bool', 'int', 'float', 'enum')),

  -- Per-tag thresholds for change detection and flaky-input detection
  threshold             DOUBLE PRECISION,                   -- value-changed threshold for floats; NULL = any change
  baseline_period_days  INT NOT NULL DEFAULT 7,             -- rolling baseline window for anomaly baseline

  -- HMAC signing reference — key material lives in Doppler, not here.
  -- This field names the Doppler secret key used to sign relay payloads
  -- for this tag (e.g., "RELAY_HMAC_KEY_LINE5"). NULL = shared default key.
  hmac_key_ref          TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID,                               -- Hub user who approved; NULL = migrated from file

  PRIMARY KEY (tenant_id, tag_id)
);

-- UNS-scoped queries: "show me all approved tags under this asset subtree"
CREATE INDEX IF NOT EXISTS idx_approved_tags_uns_path
  ON approved_tags USING GIST (uns_path);

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_approved_tags_uns_path;
-- DROP TABLE IF EXISTS approved_tags;
-- COMMIT;
