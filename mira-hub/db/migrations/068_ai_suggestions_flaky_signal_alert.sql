BEGIN;

-- Migration 068: widen `ai_suggestions.suggestion_type` CHECK to add
-- `flaky_signal_alert`.
--
-- Why: the Phase 9 flaky-input detector (`mira-bots/agents/flaky_detector_runner.py`)
-- writes an `ai_suggestions` row of this type whenever a sensor tag shows a
-- pathological pattern (rapid_toggle / brown_out / intermittent_disc / value_spike)
-- that the technician cannot see directly.  The alert surfaces in the Hub
-- `/proposals` queue so an operator can acknowledge or mark false-positive —
-- never pushed directly to the technician until validated (issue #1661).
--
-- Pattern: matches mig 062 (drive_pack_update) — DROP auto-named CHECK,
-- re-ADD with the extra value.  Idempotent: DROP IF EXISTS + drop-before-add.
-- No data change; existing rows already satisfy the wider set.

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
        'drive_pack_update',    -- mig 062
        'flaky_signal_alert'    -- mig 068: sensor-anomaly detector
    ));

COMMIT;

-- ─── Rollback ──────────────────────────────────────────────────────────────────
-- Only safe once no rows use 'flaky_signal_alert'.
-- BEGIN;
-- DELETE FROM ai_suggestions WHERE suggestion_type = 'flaky_signal_alert';
-- DELETE FROM flaky_input_signals WHERE ai_suggestion_id IS NOT NULL;
-- ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
-- ALTER TABLE ai_suggestions
--     ADD CONSTRAINT ai_suggestions_suggestion_type_check
--     CHECK (suggestion_type IN (
--         'kg_edge','kg_entity','tag_mapping','component_profile',
--         'uns_confirmation','namespace_move','drive_pack_update'));
-- COMMIT;
