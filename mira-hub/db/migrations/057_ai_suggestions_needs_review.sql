-- 057_ai_suggestions_needs_review.sql
-- Phase 5 PR-1: allow `needs_review` as an ai_suggestions.status value.
--
-- The Phase 1 FactoryModel writer (src/lib/factory-model-proposals.ts) emits UNCERTAIN mappings
-- (e.g. a signal whose role could not be inferred) as `needs_review` so a human resolves them, while
-- high/medium-confidence mappings stay `pending`. Nothing is auto-approved.
--
-- The mig-027 status CHECK is an inline column constraint, which PostgreSQL names
-- `ai_suggestions_status_check` by default. We swap it for the same name plus one extra value.
-- Idempotent (DROP IF EXISTS before ADD), single transaction. No new tables; no other schema touched.
-- The partial indexes from mig 027 are `WHERE status = 'pending'` and are unaffected by a new value.
--
-- NOTE: the existing accept path (src/lib/suggestion-accept.ts decideSuggestion) only DECIDES rows
-- from status='pending'. Wiring `needs_review` into the decide path is deferred to PR-2. This
-- migration only makes the value VALID — it changes no behaviour.

BEGIN;

ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_status_check;

ALTER TABLE ai_suggestions
    ADD CONSTRAINT ai_suggestions_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'deferred', 'superseded', 'needs_review'));

COMMIT;
