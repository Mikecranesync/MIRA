/**
 * Dispatch gates (#5020): a process-level kill switch, a tenant allowlist,
 * and the per-tenant CMMS connection + write policy lookup. These are kept
 * separate from `enqueue.ts` and `dispatcher.ts` so both can read the SAME
 * "is this tenant even wired for CMMS writes" answer without duplicating the
 * query or the env-var parsing.
 *
 * `dispatchEnabled` / `dispatchTenantAllowlist` are env-driven and read by
 * whatever process schedules `runDispatchTick` (outside this capability's
 * scope) — `runDispatchTick` itself takes the allowlist as a `DispatchDeps`
 * input rather than reading the env directly, so a test can inject an
 * arbitrary allowlist without env-var gymnastics.
 */
import type { PoolClient } from "pg";
import { parseWritePolicy, type WritePolicy } from "./types";

/** Global kill switch for the dispatcher process. Default off. */
export function dispatchEnabled(): boolean {
  return process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED === "true";
}

/** Comma-separated tenant ids the dispatcher is allowed to write for.
 *  Empty/unset → empty set → nobody. Trimmed + lowercased so a stray space
 *  or case mismatch in the env var can't silently widen (or narrow) it. */
export function dispatchTenantAllowlist(): Set<string> {
  const raw = process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export type TenantWriteConnection = { provider: string; enabled: boolean; policy: WritePolicy };

/**
 * Load the tenant's CMMS connection + parsed write policy. Runs on whatever
 * client it is given (the caller's `withTenantContext` client at enqueue
 * time; the dispatcher's own `withTenantContext` client at dispatch time) —
 * this function has no transaction opinions of its own.
 *
 * `tenant_cmms_config.tenant_id` is TEXT (migration 008, the CMMS family);
 * notebook tenant ids are UUID (the kg/Hub family) — compare with `$1::text`,
 * never cast the UUID side to uuid (`.claude/rules/mira-hub-migrations.md §1`).
 */
export async function loadTenantWritePolicy(
  c: PoolClient,
  tenantId: string,
): Promise<TenantWriteConnection | null> {
  const res = await c.query<{ provider: string; enabled: boolean; write_policy: unknown }>(
    `SELECT provider, enabled, write_policy FROM tenant_cmms_config WHERE tenant_id = $1::text`,
    [tenantId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { provider: row.provider, enabled: row.enabled, policy: parseWritePolicy(row.write_policy) };
}
