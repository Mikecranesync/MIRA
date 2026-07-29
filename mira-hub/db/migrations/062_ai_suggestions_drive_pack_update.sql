BEGIN;

-- Migration 062: widen `ai_suggestions.suggestion_type` CHECK to add
-- `drive_pack_update`.
--
-- Why: the drive-pack bridge (`mira-crawler/drive_pack_bridge.py`) creates a
-- review-only "drive-pack update candidate" when a discovered/changed OEM
-- drive manual is ingested. The Hub ingestion seam
-- (`src/lib/drive-pack-suggestion.ts` → `/api/suggestions/drive-pack-candidate`)
-- turns that candidate into an `ai_suggestions` row so it surfaces in the
-- Command Center `/knowledge/suggestions` review queue. Mig 027's CHECK only
-- allowed the original six types, so the INSERT would fail without this.
--
-- The row is status-only on decide (see `src/lib/suggestion-accept.ts`):
-- accepting records "worth processing" — it never extracts, grades, or
-- promotes a pack (`.claude/rules/train-before-deploy.md`).
--
-- Widen = DROP the auto-named CHECK, re-ADD it with the extra value. Idempotent:
-- DROP IF EXISTS + the drop-before-add ordering make a re-run safe. No data
-- change (existing rows already satisfy the wider set).

ALTER TABLE ai_suggestions
    DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;

ALTER TABLE ai_suggestions
    ADD CONSTRAINT ai_suggestions_suggestion_type_check
    CHECK (suggestion_type IN (
        'kg_edge',
        'kg_entity',
        'tag_mapping',
        'component_profile',
        'uns_confirmation',
        'namespace_move',
        'drive_pack_update'   -- mig 062: drive-pack bridge review-only candidate
    ));

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- Only safe once no rows use the new value.
-- BEGIN;
-- DELETE FROM ai_suggestions WHERE suggestion_type = 'drive_pack_update';
-- ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
-- ALTER TABLE ai_suggestions
--     ADD CONSTRAINT ai_suggestions_suggestion_type_check
--     CHECK (suggestion_type IN (
--         'kg_edge','kg_entity','tag_mapping','component_profile',
--         'uns_confirmation','namespace_move'));
-- COMMIT;
