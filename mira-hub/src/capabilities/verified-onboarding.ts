import pool from "@/lib/db";
import { ensureSchema } from "@/lib/users";
import { publicSignupPolicy, type SignupIntent } from "./free-technician-signup";
import { ONBOARDING_VERSION, ONBOARDING_SHA256 } from "./onboarding-policy";
import { claimVerifiedEmail } from "./verified-identity";
import { attributionFromRequest, handlePilotApplicationSubmitted, type PilotAttribution } from "./pilot-funnel";
export interface OnboardingReceipt {
    intent: SignupIntent;
    agreementVersion: string;
    attribution?: PilotAttribution;
}
export class ExistingOnboardingAccountError extends Error {
    constructor() { super("This address already has an account. Sign in, or contact Mike to arrange a plant pilot or account change."); }
}
/** Only called with metadata from a consumed server-issued onboarding token and
 * the recipient's agreement confirmation. Ordinary sign-in cannot call this path.
 */
export async function completeVerifiedOnboarding(email: string, receipt: OnboardingReceipt) {
    if (!["technician", "pilot"].includes(receipt.intent))
        throw new Error("Invalid onboarding intent");
    if (receipt.agreementVersion !== ONBOARDING_VERSION)
        throw new Error("Please review the current account agreement.");
    const policy = publicSignupPolicy(receipt.intent);
    if ((receipt.intent === "technician" && policy.kind !== "free_technician") || (receipt.intent === "pilot" && policy.kind !== "pilot_application"))
        throw new Error("This signup offer is unavailable. Contact Mike to discuss access.");
    await ensureSchema();
    const client = await pool.connect();
    const address = email.trim().toLowerCase();
    let recoveryId: string | undefined;
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [71234011, address]);
        const { rows } = await client.query("SELECT u.id,u.tenant_id,u.status,u.plan,t.pilot_status,t.signup_offer FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.email_lower=LOWER($1) FOR UPDATE OF u,t", [address]);
        const existing = rows[0];
        if (existing) {
            if (receipt.intent === "pilot")
                throw new ExistingOnboardingAccountError();
            if (existing.plan === "technician_free" && existing.status === "approved" && existing.signup_offer === "technician_free") {
                await claimVerifiedEmail(client, String(existing.id));
                await client.query("UPDATE hub_users SET terms_version=$2,terms_sha256=$3,terms_accepted_at=NOW() WHERE id=$1", [existing.id, ONBOARDING_VERSION, ONBOARDING_SHA256]);
                await client.query("COMMIT");
                return { id: String(existing.id), tenantId: String(existing.tenant_id), email: address, created: false };
            }
            if (existing.status !== "pending" || existing.pilot_status !== "pending")
                throw new ExistingOnboardingAccountError();
            // A verified inbox owner chooses a fresh personal workspace. Preserve the
            // old unapproved application for review; never copy its untrusted state.
            const archived = await client.query("INSERT INTO hub_onboarding_recoveries (previous_user_id,previous_tenant_id,original_email) VALUES ($1,$2,$3) RETURNING id", [existing.id, existing.tenant_id, address]);
            recoveryId = String(archived.rows[0].id);
            await client.query("UPDATE hub_users SET email=$2,password_hash=NULL,google_sub=NULL,status='expired',credential_epoch=credential_epoch+1,updated_at=NOW() WHERE id=$1", [existing.id, `recovered-${existing.id}@identity.invalid`]);
        }
        const free = receipt.intent === "technician";
        const tenant = await client.query("INSERT INTO hub_tenants (name,signup_offer,pilot_status) VALUES ($1,$2,$3) RETURNING id", [address, free ? "technician_free" : null, free ? null : "pending"]);
        const tenantId = String(tenant.rows[0].id);
        await client.query("INSERT INTO tenants (id,name,contact_email) VALUES ($1::uuid,$2,$3) ON CONFLICT (id) DO NOTHING", [tenantId, address, address]);
        const user = await client.query("INSERT INTO hub_users (email,tenant_id,status,trial_expires_at,plan,terms_version,terms_sha256,terms_accepted_at) VALUES ($1,$2,$3,NULL,$4,$5,$6,NOW()) RETURNING id", [address, tenantId, free ? "approved" : "pending", free ? "technician_free" : null, ONBOARDING_VERSION, ONBOARDING_SHA256]);
        const id = String(user.rows[0].id);
        await client.query("UPDATE hub_tenants SET owner_user_id=$1 WHERE id=$2", [id, tenantId]);
        if (recoveryId)
            await client.query("UPDATE hub_onboarding_recoveries SET personal_user_id=$2 WHERE id=$1", [recoveryId, id]);
        await client.query("COMMIT");
        if (!free)
            void handlePilotApplicationSubmitted({ tenantId, userId: id, email: address, name: null, tenantName: address, attribution: receipt.attribution ?? attributionFromRequest(new Request("https://app.factorylm.com/signup/?intent=pilot")) }).catch(() => { });
        return { id, tenantId, email: address, created: true };
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    }
    finally {
        client.release();
    }
}
