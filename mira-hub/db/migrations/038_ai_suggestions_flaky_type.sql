-- 038_ai_suggestions_flaky_type.sql
-- Purpose : Extend ai_suggestions.suggestion_type CHECK to include
--           'flaky_signal_alert' — required by Phase 9 flaky_input_detector.
-- Plan    : docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 9 / §D6
-- Writer  : mira-bots/agents/flaky_input_detector.py
--
-- NOTE FOR ORCHESTRATOR — before promoting to staging:
--   1. Confirm '038' is still the free migration number:
--        ls mira-hub/db/migrations/ | tail -5
--      If a peer session has taken 038, rename this file before apply.
--   2. Verify the old constraint name on staging (the name below is the
--      auto-generated Postgres name from mig 027's inline CHECK):
--        SELECT conname FROM pg_constraint
--         WHERE conrelid = 'ai_suggestions'::regclass
--           AND contype = 'c'
--           AND conname LIKE '%suggestion_type%';
--      If the name differs, adjust the DROP CONSTRAINT line accordingly.
--      An incorrect DROP is a silent no-op — the old constraint keeps
--      rejecting inserts with 'flaky_signal_alert'.
--   3. Idempotent: safe to re-run (IF NOT EXISTS + DROP IF EXISTS).

BEGIN;

-- Step 1: drop the old inline constraint added in mig 027.
-- The auto-generated name for a column CHECK on `suggestion_type` is:
--   ai_suggestions_suggestion_type_check
ALTER TABLE ai_suggestions
    DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;

-- Step 2: recreate with the full expanded list (original six + new type).
ALTER TABLE ai_suggestions
    ADD CONSTRAINT ai_suggestions_suggestion_type_check
    CHECK (suggestion_type IN (
        'kg_edge',            -- header on a relationship_proposals row
        'kg_entity',          -- new entity (component instance, tag, location, asset)
        'tag_mapping',        -- a tag_entities row proposed by ingestion
        'component_profile',  -- a component_templates row proposed by extraction
        'uns_confirmation',   -- the UNS Gate's "is this the right asset?" prompt
        'namespace_move',     -- a drag-drop / rename operation on the namespace tree
        'flaky_signal_alert'  -- Phase 9: unstable-input detection output
    ));

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE ai_suggestions
--     DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
-- ALTER TABLE ai_suggestions
--     ADD CONSTRAINT ai_suggestions_suggestion_type_check
--     CHECK (suggestion_type IN (
--         'kg_edge','kg_entity','tag_mapping','component_profile',
--         'uns_confirmation','namespace_move'
--     ));
-- COMMIT;
