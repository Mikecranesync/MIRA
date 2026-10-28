-- 108_pilot_applications.sql — ad/signup attribution for the free 30-day
-- pilot application (#4877). Entirely additive: one new table, every column
-- nullable except the FK and the two gclid/fbclid booleans (which default
-- false). Nothing existing is read or written differently by applying this.
--
-- hub_tenants.id and hub_users.id are both TEXT (see mira-hub/src/lib/users.ts
-- ensureSchema) — not UUID — so tenant_id/user_id here are TEXT too, matching
-- mira-hub-migrations.md rule 1 (match the column you reference).
--
-- One row per tenant: UNIQUE (tenant_id) makes the register-route insert
-- idempotent under ON CONFLICT (tenant_id) DO NOTHING, which matters because
-- ensureUserAndTenant can, on a rare concurrent request, return an
-- already-created tenant a second time.
--
-- ON DELETE CASCADE on both FKs: qa-cleanup.yml periodically deletes
-- synthetic/system test tenants and users (see users.ts
-- SYSTEM_ACCOUNT_EMAIL_PATTERNS); without CASCADE those deletes would 23503
-- against this table. 107_pilot_access.sql's pilot_seat_reservations sets the
-- same precedent for a tenant-scoped table.
--
-- No RLS: hub_tenants/hub_users carry none (mira-hub-migrations.md — Hub auth
-- tables are scoped by explicit `tenant_id = $N` predicates in application
-- SQL, not RLS). This table follows the same convention as
-- pilot_seat_reservations (107_pilot_access.sql).
--
-- Settled against a throwaway local postgres:16 before this file was added,
-- per .claude/rules/mira-hub-migrations.md rule 8 (an applied migration file
-- is immutable) — applied twice to prove idempotency, inserted/updated under
-- SET ROLE factorylm_app, and a tenant delete was confirmed to cascade the
-- row away. See PR #4877 body for the session transcript.

BEGIN;

CREATE TABLE IF NOT EXISTS pilot_applications (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id     TEXT NOT NULL REFERENCES hub_tenants(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES hub_users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  has_gclid     BOOLEAN NOT NULL DEFAULT FALSE,
  has_fbclid    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_pilot_applications_created_at
  ON pilot_applications (created_at);

GRANT SELECT, INSERT, UPDATE ON pilot_applications TO factorylm_app;

COMMIT;
