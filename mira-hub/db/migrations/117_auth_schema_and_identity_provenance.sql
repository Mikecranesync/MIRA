-- Reconcile the full 008 Hub bootstrap contract after removal of request DDL.
-- 116 is immutable. No existing credential is guessed to be operator-managed
-- or public: unknown passwords keep working, but email/Google claims require
-- operator classification before changing that identity. New issuers tag origin.
BEGIN;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS password_provenance TEXT NOT NULL DEFAULT 'unknown';

-- Accounts from the already-reviewed verified setup protocol have a durable
-- server-issued consent receipt. Preserve their pending verified identity.
UPDATE hub_users SET email_verified_at = terms_accepted_at
 WHERE email_verified_at IS NULL AND password_hash IS NULL
   AND terms_version = 'factorylm-verified-onboarding-v1'
   AND terms_accepted_at IS NOT NULL;

-- Recovery audits live only while all linked accounts exist. Account/tenant
-- deletion removes the audit as well; the existing bounded QA cleanup can run.
ALTER TABLE hub_onboarding_recoveries DROP CONSTRAINT IF EXISTS hub_onboarding_recoveries_previous_user_id_fkey;
ALTER TABLE hub_onboarding_recoveries ADD CONSTRAINT hub_onboarding_recoveries_previous_user_id_fkey
 FOREIGN KEY (previous_user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE hub_onboarding_recoveries DROP CONSTRAINT IF EXISTS hub_onboarding_recoveries_previous_tenant_id_fkey;
ALTER TABLE hub_onboarding_recoveries ADD CONSTRAINT hub_onboarding_recoveries_previous_tenant_id_fkey
 FOREIGN KEY (previous_tenant_id) REFERENCES hub_tenants(id) ON DELETE CASCADE;
ALTER TABLE hub_onboarding_recoveries DROP CONSTRAINT IF EXISTS hub_onboarding_recoveries_personal_user_id_fkey;
ALTER TABLE hub_onboarding_recoveries ADD CONSTRAINT hub_onboarding_recoveries_personal_user_id_fkey
 FOREIGN KEY (personal_user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
GRANT SELECT, INSERT, UPDATE ON hub_users, hub_tenants, hub_magic_tokens, hub_onboarding_recoveries, tenants TO factorylm_app;
COMMIT;
