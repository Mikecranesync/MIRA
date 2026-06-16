import { createHmac } from "crypto";

export function deriveAtlasPassword(tenantId: string): string {
  const key = process.env.ATLAS_PASSWORD_DERIVATION_KEY;
  if (!key) throw new Error("ATLAS_PASSWORD_DERIVATION_KEY not set");
  return createHmac("sha256", key)
    .update(tenantId)
    .digest("base64url")
    .slice(0, 32);
}
