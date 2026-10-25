-- 107_hub_users_session_version.sql — per-user Hub JWT revocation (#3831).
--
-- Hub sessions are stateless NextAuth JWTs. There is no session row to delete,
-- so a leaked cookie stayed valid until expiry (30 days) unless AUTH_SECRET was
-- rotated for everyone. session_version is stamped into the JWT at issuance
-- (auth.ts jwt callback) and compared in requireSession(). Bumping the column
-- for one user invalidates that user's existing tokens and nobody else's.
--
-- Do not apply this file from a code session. Promotion is the gated
-- apply-migrations.yml path (dev → staging → prod).
-- Idempotent, one transaction.

BEGIN;

ALTER TABLE hub_users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
