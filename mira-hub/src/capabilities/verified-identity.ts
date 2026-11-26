import type { Pool } from "pg";
type IdentityRow = {
    credentialEpoch?: number;
} | null | undefined;
export function credentialEpoch(row: IdentityRow): number {
    const value = row?.credentialEpoch;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
export function credentialsAreCurrent(token: {
    credentialEpoch?: unknown;
}, row: IdentityRow): boolean {
    return (token.credentialEpoch ?? 0) === credentialEpoch(row);
}
/** Called only after a consumed email token or a verified Google identity.
 * Legacy password registration never verified the address. Claiming that address
 * removes its unproven password and revokes sessions minted with that credential.
 */
export async function claimVerifiedEmail(db: Pick<Pool, "query">, userId: string): Promise<void> {
    const result = await db.query(`UPDATE hub_users SET
    password_hash = CASE WHEN password_provenance='public_unverified' THEN NULL ELSE password_hash END,
    credential_epoch = credential_epoch + CASE WHEN password_provenance='public_unverified' AND password_hash IS NOT NULL THEN 1 ELSE 0 END,
    email_verified_at = COALESCE(email_verified_at,NOW()),
    updated_at = NOW()
    WHERE id=$1 AND (password_hash IS NULL OR password_provenance IN ('public_unverified','operator','verified'))
    RETURNING id`, [userId]);
    if (!result.rows[0])
        throw new CredentialReviewRequiredError();
}
/** The stored password's provenance is unknown: a NEW identity may not claim the row. */
export class CredentialReviewRequiredError extends Error {
    constructor() { super("Credential provenance requires operator review. Your existing password is unchanged; contact support@factorylm.com."); }
}
export class EmailVerificationRequiredError extends Error {
    constructor() { super("Verify your email using the sign-in link before creating a free workspace."); }
}
