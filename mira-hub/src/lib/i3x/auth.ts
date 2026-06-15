import { createHash } from "node:crypto";
import pool from "@/lib/db";

/** SHA-256 hex of a plaintext key. Only the hash is ever stored. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

type KeyRow = {
  tenant_id: string;
  enabled: boolean;
};

/** Pure: map a looked-up key row to a tenantId (or null). */
export function resolveTenantFromKeyRow(row: KeyRow | null): string | null {
  return row && row.enabled ? row.tenant_id : null;
}

/**
 * Resolve the tenant for a request from its bearer key. Runs as owner (the key
 * identifies the tenant before any RLS context exists). Returns null on any
 * failure — callers turn that into a 401. NEVER logs the plaintext key.
 */
export async function resolveI3xTenant(req: Request): Promise<string | null> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) return null;
  try {
    const { rows } = await pool.query<KeyRow>(
      "SELECT tenant_id, enabled FROM i3x_api_keys WHERE key_hash = $1 AND enabled = true LIMIT 1",
      [hashKey(token)],
    );
    return resolveTenantFromKeyRow(rows[0] ?? null);
  } catch {
    console.error("i3x key lookup failed");
    return null;
  }
}
