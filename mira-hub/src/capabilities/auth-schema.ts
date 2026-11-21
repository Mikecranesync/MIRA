import pool from "@/lib/db";
/** Read-only deployment prerequisite. The request path never installs schema. */
export async function assertAuthMigrationReady() {
    try {
        await pool.query("SELECT u.id,u.email,u.email_lower,u.password_hash,u.google_sub,u.tenant_id,u.name,u.role,u.status,u.trial_expires_at,u.plan,u.preferences,u.created_at,u.updated_at,u.credential_epoch,u.email_verified_at,u.password_provenance,u.terms_version,u.terms_sha256,u.terms_accepted_at,t.id,t.name,t.owner_user_id,t.created_at,t.signup_offer,t.pilot_status,t.pilot_expires_at,m.token,m.email,m.tenant_id,m.role,m.invited_by,m.expires_at,m.used_at,m.purpose,m.onboarding FROM hub_users u, hub_tenants t, hub_magic_tokens m LIMIT 0");
        await pool.query("SELECT personal_user_id FROM hub_onboarding_recoveries LIMIT 0");
        await pool.query("SELECT id,name,contact_email FROM tenants LIMIT 0");
    }
    catch {
        throw new Error("Auth schema prerequisite missing: apply Hub migrations through 117 using apply-migrations.yml before deploying this runtime.");
    }
}
