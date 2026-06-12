BEGIN;

-- Migration 048: fix `tenant_id` type on the asset-agent lifecycle tables.
--
-- Bug: migrations 046/047 declared `asset_agent_status.tenant_id` and
--   `asset_validation_qa.tenant_id` as UUID, and wrote RLS policies that cast
--   `current_setting('app.tenant_id', true)::UUID`. But these tables are keyed
--   to `cmms_equipment.id`, and the CMMS/equipment tenancy family is TEXT-tenanted
--   (`tenants.tenant_id`, `tenant_cmms_config.tenant_id`, `cmms_equipment.tenant_id`
--   are all TEXT — see 008_tenant_cmms_config.sql), with live non-UUID slug tenants
--   (e.g. the "mike" demo tenant). The validation-qa POST route binds the session's
--   TEXT tenant id into the UUID column →
--       ERROR: invalid input syntax for type uuid: "mike"
--   surfaced in the UI as "Insert failed" on the Train & approve onboarding step.
--   Diagnosis: docs/tech-debt/2026-06-10-train-approve-insert-failed-diagnosis.md
--
-- Fix: make tenant_id TEXT (matching cmms_equipment) and compare it as TEXT in RLS,
--   exactly like the canonical 008 pattern. Plain text compare works for BOTH slug
--   tenants ("mike") and UUID-string tenants ("78917b56-…").
--
-- Idempotent: the ALTERs are no-ops once tenant_id is already TEXT; indexes/policies
--   are dropped IF EXISTS and recreated.

-- ── asset_agent_status ───────────────────────────────────────────────────
-- The RLS policy and the GiST index both reference tenant_id, so both must be
-- dropped before the type change (a policy dependency blocks ALTER COLUMN TYPE;
-- the GiST opclass is column-type-specific). Recreate them after.
DROP POLICY IF EXISTS asset_agent_status_tenant ON asset_agent_status;
DROP INDEX IF EXISTS idx_asset_agent_status_uns;
DROP INDEX IF EXISTS idx_asset_agent_status_tenant_state;

ALTER TABLE asset_agent_status
    ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

CREATE INDEX IF NOT EXISTS idx_asset_agent_status_tenant_state
    ON asset_agent_status (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_asset_agent_status_uns
    ON asset_agent_status USING GIST (tenant_id, uns_path)
    WHERE uns_path IS NOT NULL;

CREATE POLICY asset_agent_status_tenant
    ON asset_agent_status
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true));

-- ── asset_validation_qa ──────────────────────────────────────────────────
DROP POLICY IF EXISTS asset_validation_qa_tenant ON asset_validation_qa;
DROP INDEX IF EXISTS idx_asset_validation_qa_equipment;

ALTER TABLE asset_validation_qa
    ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

CREATE INDEX IF NOT EXISTS idx_asset_validation_qa_equipment
    ON asset_validation_qa (tenant_id, equipment_id, created_at DESC);

CREATE POLICY asset_validation_qa_tenant
    ON asset_validation_qa
    USING (tenant_id = current_setting('app.tenant_id', true)
           OR tenant_id = current_setting('app.current_tenant_id', true));

COMMIT;


-- ────────────────────────────────────────────────────────────────────────
-- DOWN (not recommended — UUID can't hold slug tenants)
-- ────────────────────────────────────────────────────────────────────────
-- This is intentionally one-way: reverting to UUID would fail on any TEXT
-- tenant id already stored. Leave tenant_id TEXT.
