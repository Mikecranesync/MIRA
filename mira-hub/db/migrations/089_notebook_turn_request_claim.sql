-- 089: claim notebook requests before inference and replay their terminal result.
--
-- Migration 088 has already run in shared staging and is immutable. This
-- follow-up adds the lease and payload fields required to make a duplicate
-- client request observable before provider or safety work begins.
--
-- Rollback:
--   ALTER TABLE equipment_notebook_turns
--     DROP CONSTRAINT IF EXISTS equipment_notebook_turns_client_request_state;
--   ALTER TABLE equipment_notebook_turns
--     DROP COLUMN IF EXISTS client_request_payload,
--     DROP COLUMN IF EXISTS client_request_claim_token,
--     DROP COLUMN IF EXISTS client_request_started_at,
--     DROP COLUMN IF EXISTS client_request_state;

BEGIN;

ALTER TABLE equipment_notebook_turns
  ADD COLUMN IF NOT EXISTS client_request_state TEXT NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS client_request_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS client_request_claim_token UUID NULL,
  ADD COLUMN IF NOT EXISTS client_request_payload JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'equipment_notebook_turns_client_request_state'
       AND conrelid = 'equipment_notebook_turns'::regclass
  ) THEN
    ALTER TABLE equipment_notebook_turns
      ADD CONSTRAINT equipment_notebook_turns_client_request_state
      CHECK (client_request_state IN ('pending', 'complete'));
  END IF;
END $$;

COMMENT ON COLUMN equipment_notebook_turns.client_request_state IS
  'pending claims execution before inference; complete rows are visible/replayable terminal turns.';
COMMENT ON COLUMN equipment_notebook_turns.client_request_started_at IS
  'Lease start for a pending request; permits safe recovery of an abandoned claim.';
COMMENT ON COLUMN equipment_notebook_turns.client_request_claim_token IS
  'Lease token required to complete a pending request; prevents a stale worker from overwriting a takeover.';
COMMENT ON COLUMN equipment_notebook_turns.client_request_payload IS
  'Canonical JSON request bound to the idempotency key; changed payloads fail closed.';

COMMIT;
