-- 109_hub_users_terms_consent.sql — record signup consent version + timestamp
-- on hub_users (#4902, owner decision 5).
--
-- Columns (all nullable, NO default):
--   terms_version     TEXT         registry id, e.g. 'hub-signup-terms-v1'
--                                  (mira-hub/src/capabilities/hub-signup-terms.ts)
--   terms_sha256      TEXT         sha256 hex of the exact rendered sentence
--   terms_accepted_at TIMESTAMPTZ  server time the account was created via
--                                  /api/auth/register
--
-- Historical honesty: NULL means "not recorded". Existing rows stay NULL and
-- are never back-filled — we cannot know what any earlier user saw or agreed
-- to. That is why there is no DEFAULT here (ADD COLUMN ... DEFAULT would stamp
-- every existing row) and no UPDATE. Accounts created outside
-- /api/auth/register (Google OAuth, magic-link, invites) also stay NULL.
--
-- No RLS / no new grants: hub_users carries none and is scoped by explicit
-- predicates in application SQL (same convention as 107). Additive only.
-- mira-hub/src/lib/users.ts ensureSchema mirrors these three ADD COLUMNs so a
-- database that has not yet run 109 does not 500 on signup.

BEGIN;

ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_sha256 TEXT;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

COMMIT;
