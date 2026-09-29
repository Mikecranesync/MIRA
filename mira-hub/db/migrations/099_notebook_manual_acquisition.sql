-- Migration 099: remember a notebook's automatic manual search (#4075).
--
-- When a technician confirms a machine's identity (the web Scan machine flow
-- creates the notebook with identity_status = 'user_confirmed'), MIRA now looks
-- for that machine's official manual in the background, through the same
-- discover -> download -> ingest -> applicability pipeline the nameplate
-- confirm route uses. The search can take a minute and its most common outcome
-- ("no official manual found") leaves no other durable trace, so its state is
-- recorded here. The notebook chat reads it to answer honestly ("still looking",
-- "found a possible manual, turned off until you check it", "none found") and
-- to avoid repeating a search it already ran for the same identity.
--
-- Shape (written only by src/capabilities/notebook-manual-acquisition.ts):
--   { "key": "<normalized manufacturer|model|catalog>",
--     "state": "running" | <ManualAcquisitionStatus>,
--     "started_at": "<iso>", "finished_at": "<iso>" | null,
--     "candidate_host": <text|null>, "match_state": <text|null>,
--     "oem_request_url": <text|null> }
-- NULL means never attempted. The claim is a conditional UPDATE keyed on "key",
-- with a staleness window so a restarted container cannot leave "running"
-- stuck forever.
--
-- Additive and nullable; code fails open when the column is absent (42703),
-- because prod applies migrations by hand after merge. Idempotent.

BEGIN;

ALTER TABLE equipment_notebooks
  ADD COLUMN IF NOT EXISTS manual_acquisition JSONB NULL;

COMMIT;
