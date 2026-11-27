BEGIN;

-- Migration 118: Add 'flaky_signal_alert' to ai_suggestions.suggestion_type.
--
-- Phase 9 (issue #1661) flaky-input detector writes one ai_suggestions row per
-- detected instability (rapid_toggle / brown_out / intermittent_disc /
-- value_spike) to surface the alert in the Hub /proposals reviewer queue.
-- Alerts land in the queue at status='pending'; they do NOT push to Slack until
-- a human validates them (alarm-fatigue avoidance, master plan Phase 9).
--
-- The existing suggestion_type CHECK is a column-level constraint — PostgreSQL
-- names it ai_suggestions_suggestion_type_check. Drop and re-add with the new
-- value. No index drop needed: the existing partial indexes (027_ai_suggestions)
-- don't discriminate on suggestion_type value.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS, so a re-run is safe.

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
        'flaky_signal_alert'
    ));

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
-- ALTER TABLE ai_suggestions ADD CONSTRAINT ai_suggestions_suggestion_type_check
--     CHECK (suggestion_type IN (
--         'kg_edge','kg_entity','tag_mapping','component_profile',
--         'uns_confirmation','namespace_move'
--     ));
-- COMMIT;
