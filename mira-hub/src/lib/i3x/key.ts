import { randomBytes } from "node:crypto";
import { hashKey } from "@/lib/i3x/auth";

/**
 * Generate a new i3X API key.
 *
 * Returns both the plaintext (shown to the user exactly once and never stored)
 * and its SHA-256 hash (stored in i3x_api_keys.key_hash).
 */
export function generateApiKey(): { plaintext: string; hash: string } {
  // 32 random bytes → base64url (Node handles +/→-_ and strips padding)
  const entropy = randomBytes(32).toString("base64url");
  const plaintext = `mira_i3x_${entropy}`;
  return { plaintext, hash: hashKey(plaintext) };
}
