-- 107_pilot_access.sql — approval-required pilot access (#4878) + the 5-seat
-- cap fix for Codex #4664 F1/F2/F4 (#4768). Entirely additive; every column
-- is nullable and every new object defaults to inert. With
-- MIRA_PILOT_APPROVAL_REQUIRED off (the default, and the only wired value
-- today — see PR body), nothing in mira-hub ever reads these columns, so
-- applying this migration changes no runtime behavior by itself.
--
-- hub_tenants.id is TEXT (see mira-hub/src/lib/users.ts ensureSchema) — not
-- UUID — so pilot_approved_by (a hub_users.id) is TEXT too, matching
-- mira-hub-migrations.md rule 1 (match the column you reference, don't guess).
--
-- pilot_seat_reservations is the durable seat ledger that fixes F1/F2/F4:
--   F1: reservation rows are created inside one tenant-scoped
--       pg_advisory_xact_lock'd transaction (capabilities/pilot-access.ts),
--       so two concurrent invites can't both observe the same pre-insert count.
--   F2: whether a tenant enforces the cap at all is read from
--       hub_tenants.pilot_status (durable), never derived from an ephemeral
--       hub_users.status='trial' row that a status change could erase.
--   F4: UNIQUE (tenant_id, email_lower) makes re-inviting the same pending
--       email idempotent — it finds the existing row instead of trying to
--       insert a second one, so a resend never consumes a second seat.
-- Rows are never deleted on redemption (status moves pending -> redeemed in
-- place), so "redeeming an invite never frees a seat, even temporarily" is
-- true by construction, not by timing.
--
-- No RLS: hub_tenants/hub_users carry none (mira-hub-migrations.md — Hub auth
-- tables are scoped by explicit `tenant_id = $N` predicates in application
-- SQL, not RLS). This table follows the same convention.
--
-- Settled against a throwaway local postgres:16 before this file was added,
-- per .claude/rules/mira-hub-migrations.md rule 8 (an applied migration file
-- is immutable) — see PR body for the session transcript.

BEGIN;

ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS pilot_status TEXT
  CHECK (pilot_status IN ('pending', 'active', 'ended'));
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS pilot_approved_at TIMESTAMPTZ;
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS pilot_expires_at TIMESTAMPTZ;
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS pilot_approved_by TEXT;

CREATE TABLE IF NOT EXISTS pilot_seat_reservations (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id    TEXT NOT NULL REFERENCES hub_tenants(id) ON DELETE CASCADE,
  email_lower  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, email_lower)
);

CREATE INDEX IF NOT EXISTS idx_pilot_seat_reservations_tenant
  ON pilot_seat_reservations (tenant_id);

GRANT SELECT, INSERT, UPDATE ON pilot_seat_reservations TO factorylm_app;

COMMIT;
