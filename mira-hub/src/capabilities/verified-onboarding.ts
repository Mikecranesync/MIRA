import pool from "@/lib/db";
import { ensureSchema, readSessionSnapshot } from "@/lib/users";
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
/** Token lock, agreement, workspace and consumption commit as one unit. */
export async function redeemVerifiedOnboarding(token: string, agreementVersion: string) {
    if (agreementVersion !== ONBOARDING_VERSION)
        throw new Error("Review the current account agreement.");
    await ensureSchema();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const proof = await client.query("SELECT email,onboarding FROM hub_magic_tokens WHERE token=$1 AND purpose='onboarding' AND expires_at>NOW() AND used_at IS NULL FOR UPDATE", [token]);
        if (!proof.rows[0])
            throw new Error("Setup link is invalid or already used.");
        const receipt = proof.rows[0].onboarding as OnboardingReceipt;
        if (!receipt || receipt.agreementVersion !== ONBOARDING_VERSION || !["technician", "pilot"].includes(receipt.intent))
            throw new Error("Invalid account agreement or intent.");
        const policy = publicSignupPolicy(receipt.intent);
        if ((receipt.intent === "technician" && policy.kind !== "free_technician") || (receipt.intent === "pilot" && policy.kind !== "pilot_application"))
            throw new Error("Signup is closed. Contact Mike.");
        const address = String(proof.rows[0].email).trim().toLowerCase();
        await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [71234011, address]);
        const { rows } = await client.query("SELECT u.id,u.tenant_id,u.status,u.plan,u.email_verified_at,u.google_sub,u.terms_version,t.pilot_status,t.signup_offer FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.email_lower=LOWER($1) FOR UPDATE OF u,t", [address]);
        const existing = rows[0];
        if (existing) {
            if (receipt.intent === "pilot")
                throw new ExistingOnboardingAccountError();
            if (existing.plan === "technician_free" && existing.status === "approved" && existing.signup_offer === "technician_free") {
                await claimVerifiedEmail(client, String(existing.id));
                await client.query("UPDATE hub_users SET terms_version=$2,terms_sha256=$3,terms_accepted_at=NOW() WHERE id=$1", [existing.id, ONBOARDING_VERSION, ONBOARDING_SHA256]);
                await client.query("UPDATE hub_magic_tokens SET used_at=NOW() WHERE token=$1", [token]);
                const snapshot = await readSessionSnapshot(client, String(existing.id));
                if (!snapshot)
                    throw new Error("Account vanished during setup.");
                await client.query("COMMIT");
                return { ...snapshot, created: false };
            }
            // Any other existing account — including a legacy pending pilot — is never
            // retired or rewritten from a setup link: its password, application and
            // cohort eligibility stay exactly as they are, and an operator decides
            // (Codex F17/F23 — automatic recovery removed).
            throw new ExistingOnboardingAccountError();
        }
        const free = receipt.intent === "technician";
        const tenant = await client.query("INSERT INTO hub_tenants (name,signup_offer,pilot_status) VALUES ($1,$2,$3) RETURNING id", [address, free ? "technician_free" : null, free ? null : "pending"]);
        const tenantId = String(tenant.rows[0].id);
        await client.query("INSERT INTO tenants (id,name,contact_email) VALUES ($1::uuid,$2,$3) ON CONFLICT (id) DO NOTHING", [tenantId, address, address]);
        const user = await client.query("INSERT INTO hub_users (email,tenant_id,status,trial_expires_at,plan,terms_version,terms_sha256,terms_accepted_at,email_verified_at,password_provenance) VALUES ($1,$2,$3,NULL,$4,$5,$6,NOW(),NOW(),'none') RETURNING id", [address, tenantId, free ? "approved" : "pending", free ? "technician_free" : null, ONBOARDING_VERSION, ONBOARDING_SHA256]);
        const id = String(user.rows[0].id);
        await client.query("UPDATE hub_tenants SET owner_user_id=$1 WHERE id=$2", [id, tenantId]);
        // Codex F32: the spent token carries a receipt of the workspace IT created,
        // so cleanup tooling can prove ownership instead of inferring it.
        await client.query("UPDATE hub_magic_tokens SET used_at=NOW(),onboarding=onboarding||jsonb_build_object('createdTenantId',$2::text) WHERE token=$1", [token, tenantId]);
        // Codex F34/F35: the session is minted from this in-transaction snapshot.
        const snapshot = await readSessionSnapshot(client, id);
        if (!snapshot)
            throw new Error("Account vanished during setup.");
        await client.query("COMMIT");
        if (!free)
            void handlePilotApplicationSubmitted({ tenantId, userId: id, email: address, name: null, tenantName: address, attribution: receipt.attribution ?? attributionFromRequest(new Request("https://app.factorylm.com/signup/?intent=pilot")) }).catch(() => { });
        return { ...snapshot, created: true };
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    }
    finally {
        client.release();
    }
}
