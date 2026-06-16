import pool from "@/lib/db";
import type { PoolClient } from "pg";

/**
 * Run a database callback inside a transaction that:
 *   1. Switches the session role to `factorylm_app` (SET LOCAL ROLE — limited,
 *      no BYPASSRLS) so RLS tenant_isolation policies are enforced.
 *   2. Sets app.tenant_id AND app.current_tenant_id (transaction-local). The
 *      project has both setting keys in the wild — newer code reads
 *      app.tenant_id, older policies (migrations 001–003) read
 *      app.current_tenant_id. Writing both keeps every RLS policy happy
 *      regardless of which it was authored against.
 *
 * neondb_owner has BYPASSRLS=true. Without the SET LOCAL ROLE switch the
 * owner connection skips every RLS policy. SET LOCAL ROLE scopes the
 * privilege drop to this transaction only — released on COMMIT/ROLLBACK.
 *
 * Pipeline services continue to use neondb_owner directly (no context set)
 * and bypass RLS as before. Hub API routes MUST go through this helper so
 * tenants cannot read each other's data.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
