-- Additive auth prerequisite. Apply through apply-migrations.yml before runtime.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_email_lower ON hub_users(email_lower);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_google_sub ON hub_users(google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS credential_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS signup_offer TEXT;
CREATE TABLE IF NOT EXISTS hub_magic_tokens (
  token TEXT PRIMARY KEY, email TEXT NOT NULL, tenant_id TEXT, role TEXT,
  invited_by TEXT, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
ALTER TABLE hub_magic_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE hub_magic_tokens ADD COLUMN IF NOT EXISTS onboarding JSONB;
CREATE TABLE IF NOT EXISTS hub_onboarding_recoveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  previous_user_id TEXT NOT NULL REFERENCES hub_users(id),
  previous_tenant_id TEXT NOT NULL REFERENCES hub_tenants(id),
  original_email TEXT NOT NULL,
  personal_user_id TEXT REFERENCES hub_users(id),
  recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON hub_magic_tokens, hub_onboarding_recoveries TO factorylm_app;
GRANT SELECT, INSERT, UPDATE ON hub_users, hub_tenants, tenants TO factorylm_app;
COMMIT;
