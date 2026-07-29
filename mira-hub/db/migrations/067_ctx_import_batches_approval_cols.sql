-- Migration 067: ctx_import_batches approval audit columns (#2337, HubV3 Phase 5).
--
-- Migration 056 shipped ctx_import_batches.review_status but deferred WHO
-- approved a batch and WHEN. The HITL sign-off runbook (PR #2336,
-- docs/runbooks/hubv3-hitl-sign-off.md) confirmed the review flow works but
-- flagged the audit gap: review_status flips to 'approved' with no durable
-- record of the approving identity or timestamp beyond updated_at (which is
-- overwritten by any later transition).
--
-- Additive-only, idempotent (§5 mira-hub-migrations.md). No RLS/GRANT changes
-- needed — both columns live on an already RLS-protected, already-granted
-- table (migration 056).

BEGIN;

ALTER TABLE ctx_import_batches
  ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE ctx_import_batches
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMIT;
