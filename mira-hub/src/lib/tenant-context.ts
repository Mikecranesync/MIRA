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

/**
 * withTenantContext, holding one hub_uploads row FOR SHARE for the whole
 * transaction (migration 099 / review of #4091).
 *
 * hub_uploads has no grant for factorylm_app, so the lock is taken as the
 * owner role BEFORE the role switch; the callback then runs under the tenant's
 * RLS role exactly as withTenantContext's does. Upload delete and cancel take
 * the same row FOR UPDATE first, so anything written here either commits
 * before them (and they then remove it) or finds the row gone / revoked.
 *
 * `attemptId === undefined` requires only that the upload still exists (file
 * linking, notebook-source sync). A string or null additionally requires that
 * the row still carries that import attempt and is not cancelled (chunk writes).
 * Returns `{ held: false }` — having run nothing — when the row does not qualify.
 */
export async function withUploadRowTenantContext<T>(
  tenantId: string,
  uploadId: string,
  attemptId: string | null | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<{ held: true; result: T } | { held: false }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const held =
      attemptId === undefined
        ? await client.query(
            `SELECT 1 FROM hub_uploads WHERE id = $1 AND tenant_id = $2 FOR SHARE`,
            [uploadId, tenantId],
          )
        : await client.query(
            `SELECT 1 FROM hub_uploads
              WHERE id = $1 AND tenant_id = $2
                AND attempt_id IS NOT DISTINCT FROM $3::uuid
                AND status <> 'cancelled'
              FOR SHARE`,
            [uploadId, tenantId, attemptId],
          );
    if ((held.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { held: false };
    }
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return { held: true, result };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
