-- mira-core/mira-ingest/db/migrations/011_component_profiles.sql
--
-- ComponentProfile storage — structured maintenance intelligence extracted
-- by mira-core.component_profiles.extractor from one or more vendor manuals.
--
-- Scope: one row per (tenant_id, manufacturer, series, model_number). The
-- profile JSONB blob matches the ComponentProfile pydantic schema in
-- mira-core/component_profiles/schema.py. Source PDFs continue to live in
-- the existing manuals / manual_cache tables; this table holds the LLM
-- extraction output, not the source documents themselves.
--
-- source_manual_id is intentionally NOT a hard foreign key: a profile can
-- aggregate facts from multiple manuals over time, and we don't want a
-- DELETE on manuals to cascade-delete profiles built from that manual.
-- The column records the primary source for provenance.
--
-- New table, no existing readers — single-block transactional, no
-- CREATE INDEX CONCURRENTLY needed.

BEGIN;

CREATE TABLE IF NOT EXISTS component_profiles (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT        NOT NULL,
    manufacturer        TEXT        NOT NULL,
    series              TEXT,
    model_number        TEXT,
    component_type      TEXT        NOT NULL,                  -- e.g. 'variable_frequency_drive', 'photoelectric_sensor'
    profile             JSONB       NOT NULL,                  -- full ComponentProfile JSON (matches pydantic schema)
    source_manual_id    UUID,                                  -- pointer into manuals(id) — soft reference, no FK
    confidence_overall  NUMERIC(3,2),                          -- 0.00 .. 1.00 (mirrors profile->'confidence'->>'overall')
    needs_human_review  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, manufacturer, series, model_number)
);

-- Primary lookup: technician asks about "Allen-Bradley PowerFlex 525 model X".
CREATE INDEX IF NOT EXISTS idx_cp_lookup
    ON component_profiles (tenant_id, manufacturer, model_number);

-- Review queue: surface anything flagged for human eval.
CREATE INDEX IF NOT EXISTS idx_cp_review
    ON component_profiles (created_at DESC)
    WHERE needs_human_review;

-- Fault-code search: "what does F004 mean" — JSONB containment over the array.
CREATE INDEX IF NOT EXISTS idx_cp_fault_codes
    ON component_profiles
    USING gin ((profile -> 'fault_codes'));

-- Component-type browse: "show me all VFD profiles".
CREATE INDEX IF NOT EXISTS idx_cp_component_type
    ON component_profiles (tenant_id, component_type);

-- updated_at auto-bump on any row update.
CREATE OR REPLACE FUNCTION component_profiles_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_component_profiles_updated_at ON component_profiles;
CREATE TRIGGER trg_component_profiles_updated_at
    BEFORE UPDATE ON component_profiles
    FOR EACH ROW
    EXECUTE FUNCTION component_profiles_touch_updated_at();

COMMIT;

-- Verification:
--   \d component_profiles
--   \di idx_cp_lookup idx_cp_review idx_cp_fault_codes idx_cp_component_type
--   INSERT INTO component_profiles (tenant_id, manufacturer, component_type, profile, confidence_overall)
--     VALUES ('00000000-test', 'Allen-Bradley', 'variable_frequency_drive',
--             '{"component_type":"variable_frequency_drive","confidence":{"overall":0.9}}'::jsonb, 0.90);
--   SELECT id, manufacturer, component_type, confidence_overall, needs_human_review
--     FROM component_profiles WHERE tenant_id = '00000000-test';
--   DELETE FROM component_profiles WHERE tenant_id = '00000000-test';
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_component_profiles_updated_at ON component_profiles;
--   DROP FUNCTION IF EXISTS component_profiles_touch_updated_at();
--   DROP TABLE IF EXISTS component_profiles;
