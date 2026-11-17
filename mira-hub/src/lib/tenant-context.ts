import pool from "@/lib/db";
import { Client, type PoolClient } from "pg";

export type TenantContextOptions = { signal?: AbortSignal; readOnly?: boolean };
const abortError = () => new DOMException("The database request was aborted", "AbortError");

/** A cancelled pool waiter must release a connection if it arrives after the caller left. */
function acquire(signal?: AbortSignal): Promise<PoolClient> {
  if (!signal) return pool.connect();
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    pool.connect().then((client) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { client.release(); reject(abortError()); }
      else resolve(client);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

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
  options: TenantContextOptions = {},
): Promise<T> {
  const { signal, readOnly } = options;
  const client = await acquire(signal);
  let cancel: Promise<void> | undefined;
  let released = false;
  let began = false;
  let cancellable = true;
  let pid: number | undefined;
  const abort = () => {
    if (cancel || !cancellable || released) return;
    if (pid === undefined) {
      // During preamble there is not yet a transaction-pinned backend identity.
      // Closing this lease aborts its setup without signalling an unrelated backend.
      released = true; client.release(true); return;
    }
    // Public PostgreSQL cancellation, on a separate connection so a full pool cannot
    // starve it. The original login may cancel its own backend after SET LOCAL ROLE.
    cancel = (async () => {
      const control = new Client(pool.options);
      try {
        await control.connect();
        if (cancellable) await control.query("SELECT pg_cancel_backend($1)", [pid]);
      } catch {
        // An uncertain cancellation must never return a running lease to the pool.
        if (!released) { released = true; client.release(true); }
      } finally { await control.end().catch(() => {}); }
    })();
  };
  try {
    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) throw abortError();
    }
    // #4130: two round trips, not four. Each statement here is a full network
    // round trip (~76 ms staging→Neon) and every tenant-scoped read pays it, so
    // the preamble is collapsed without changing its effect: BEGIN + SET LOCAL
    // ROLE travel as one parameterless (simple-protocol) query, and both
    // transaction-local settings are written by one SELECT. The role and both
    // keys are in force before `fn` runs, exactly as before.
    // Mark before sending: failure midway through the simple-protocol preamble
    // still requires cleanup (BEGIN may already have succeeded).
    began = true;
    await client.query(`${readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"}; SET LOCAL ROLE factorylm_app`);
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    // Transaction poolers may change the server backend between autocommit and
    // BEGIN. Capture only after BEGIN, while the target backend remains pinned
    // until cancel completion and rollback/commit.
    if (signal) pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    if (signal?.aborted) throw abortError();
    const result = await fn(client);
    if (signal?.aborted) throw abortError();
    signal?.removeEventListener("abort", abort);
    cancellable = false;
    await client.query("COMMIT");
    return result;
  } catch (err) {
    cancellable = false;
    await cancel;
    if (began && !released) {
      try { await client.query("ROLLBACK"); }
      catch { released = true; client.release(true); }
    }
    throw signal?.aborted ? abortError() : err;
  } finally {
    signal?.removeEventListener("abort", abort);
    cancellable = false;
    await cancel;
    if (!released) client.release();
  }
}
