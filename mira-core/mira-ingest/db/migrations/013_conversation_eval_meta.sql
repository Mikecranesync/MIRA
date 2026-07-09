-- Migration 013: conversation_eval.meta
-- Adds a nullable JSONB `meta` column so a captured turn can carry
-- surface-specific metadata beyond the 7 base columns — in particular the
-- drive-pack labels (surface, pack_id, matched, matched_kind, answer_source,
-- resolution) that the answer-distillation flywheel mines for knowledge gaps.
-- Additive + backfill-free: existing rows keep meta = NULL; the logger writes
-- it only when a caller passes one. See docs/specs/bot-eval-loop-spec.md and
-- .claude/plans/use-avail-skills-to-functional-wave.md (Phase 1).

ALTER TABLE conversation_eval ADD COLUMN IF NOT EXISTS meta JSONB;

-- Gap-report hot path: the distiller reads drive-pack turns and ranks the
-- unmatched ones (matched=false) per pack. Partial index keeps it cheap even
-- as the table grows with engine/LLM turns that carry no meta.
CREATE INDEX IF NOT EXISTS idx_conversation_eval_drive_pack
    ON conversation_eval (created_at DESC)
    WHERE meta->>'surface' = 'drive_pack';
