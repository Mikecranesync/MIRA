import pool from "@/lib/db";
/** Read-only deployment prerequisite. The request path never installs schema. */
export async function assertAuthMigrationReady() {
    try {
        await pool.query("SELECT u.credential_epoch, u.terms_version, u.terms_sha256, u.terms_accepted_at, t.signup_offer, t.pilot_status, t.pilot_expires_at, m.purpose, m.onboarding FROM hub_users u, hub_tenants t, hub_magic_tokens m LIMIT 0");
        await pool.query("SELECT personal_user_id FROM hub_onboarding_recoveries LIMIT 0");
        await pool.query("SELECT id FROM tenants LIMIT 0");
    }
    catch {
        throw new Error("Auth schema prerequisite missing: apply Hub migrations through 116 using apply-migrations.yml before deploying this runtime.");
    }
}
