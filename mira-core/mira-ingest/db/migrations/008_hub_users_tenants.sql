-- mira-core/mira-ingest/db/migrations/008_hub_users_tenants.sql
--
-- Hub auth + multi-tenant signup. Adds hub_tenants + hub_users for
-- Auth.js (Google + Credentials providers). Each new account creates
-- its own tenant — customers must not see each other's data.
--
-- Coordinated with mira-hub/src/lib/users.ts ensureSchema() which
-- creates the same tables lazily on first request (idempotent).
-- This file is the canonical record for prod review + manual apply.
--
-- tenant_id stays TEXT to match existing hub_channel_bindings (lib/bindings.ts)
-- and hub_uploads conventions; values are gen_random_uuid()::text strings.

BEGIN;

CREATE TABLE IF NOT EXISTS hub_tenants (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  owner_user_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_users (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email          TEXT NOT NULL,
  email_lower    TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
  password_hash  TEXT,                                  -- NULL for Google-only users
  google_sub     TEXT,                                  -- NULL for credentials-only users
  tenant_id      TEXT NOT NULL REFERENCES hub_tenants(id),
  name           TEXT,
  role           TEXT NOT NULL DEFAULT 'owner',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_email_lower
  ON hub_users (email_lower);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_google_sub
  ON hub_users (google_sub) WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hub_users_tenant
  ON hub_users (tenant_id);

-- Preserve Mike's existing data continuity. Existing hub tables
-- (hub_channel_bindings, hub_uploads) default tenant_id to 'mike',
-- and migration 009 backfills cmms_equipment / kb_chunks with the
-- same tag. When Mike signs in for the first time post-deploy,
-- ensureUserAndTenant() matches by email and attaches him to this
-- pre-seeded tenant rather than creating a fresh one.
INSERT INTO hub_tenants (id, name)
  VALUES ('mike', 'Mike Harper')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO hub_users (id, email, tenant_id, name, role)
  VALUES ('mike-owner', 'mike@factorylm.com', 'mike', 'Mike Harper', 'owner')
  ON CONFLICT DO NOTHING;

UPDATE hub_tenants SET owner_user_id = 'mike-owner'
  WHERE id = 'mike' AND owner_user_id IS NULL;

COMMIT;

-- Verification:
--   \d hub_tenants
--   \d hub_users
--   \di idx_hub_users_email_lower
--   \di idx_hub_users_google_sub
--   INSERT INTO hub_tenants (name) VALUES ('test-tenant') RETURNING id;
--   -- (use returned id below)
--   INSERT INTO hub_users (email, password_hash, tenant_id)
--     VALUES ('test@example.com', 'fake-hash', '<tenant-id>') RETURNING id;
--   INSERT INTO hub_users (email, password_hash, tenant_id)
--     VALUES ('TEST@example.com', 'fake-hash', '<tenant-id>');
--                                                       -- second INSERT errors with duplicate key on email_lower
--   DELETE FROM hub_users WHERE email = 'test@example.com';
--   DELETE FROM hub_tenants WHERE name = 'test-tenant';
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_hub_users_tenant;
--   DROP INDEX IF EXISTS idx_hub_users_google_sub;
--   DROP INDEX IF EXISTS idx_hub_users_email_lower;
--   DROP TABLE IF EXISTS hub_users;
--   DROP TABLE IF EXISTS hub_tenants;
