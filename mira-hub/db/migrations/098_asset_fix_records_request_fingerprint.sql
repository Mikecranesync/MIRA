-- Migration 098: a request id replays only the SAME fix.
--
-- Codex adversarial review of #4057 (post-hardening F2): with 097's
-- idempotency key alone, reusing a clientRequestId for a DIFFERENT repair (or
-- the same text after the notebook was re-bound) returned the first repair as
-- a successful save, and the new repair was silently dropped.
--
-- Each keyed insert now stores a sha256 fingerprint of what was saved: the
-- validated symptom, fault code, fix, source turn, and the machine it was
-- filed against. A retry replays the stored record only when the fingerprint
-- matches; a mismatch is a 409 conflict. Rows without a fingerprint cannot be
-- matched and so never replay as someone else's success.
--
-- A new file rather than an edit to 095-097: migration-verify has already
-- applied them to staging (.claude/rules/mira-hub-migrations.md §8). Idempotent.

BEGIN;

ALTER TABLE asset_fix_records
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT NULL;

COMMIT;
