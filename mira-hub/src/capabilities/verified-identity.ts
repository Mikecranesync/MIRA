import type { Pool } from "pg";

type IdentityRow = { credentialEpoch?: number } | null | undefined;
export function credentialEpoch(row: IdentityRow): number {
  const value = row?.credentialEpoch;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function credentialsAreCurrent(token: { credentialEpoch?: unknown }, row: IdentityRow): boolean {
  return (token.credentialEpoch ?? 0) === credentialEpoch(row);
}

/** Called only after a consumed email token or a verified Google identity.
 * Legacy password registration never verified the address. Claiming that address
 * removes its unproven password and revokes sessions minted with that credential.
 */
export async function claimVerifiedEmail(db: Pick<Pool, "query">, userId: string): Promise<void> {
  await db.query(`UPDATE hub_users SET password_hash = NULL,
    credential_epoch = credential_epoch + 1,
    updated_at = NOW() WHERE id = $1 AND password_hash IS NOT NULL`, [userId]);
}

export class EmailVerificationRequiredError extends Error {
  constructor() { super("Verify your email using the sign-in link before creating a free workspace."); }
}
