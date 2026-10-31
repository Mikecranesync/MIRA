/**
 * The outbox dispatcher (#5020): claims due `notebook_event_deliveries` rows
 * on the raw pool (the same BYPASSRLS-owner-connection-plus-explicit-tenant-
 * filter posture `src/lib/atlas/sync.ts` already uses for its cross-tenant
 * worker loop), then does every tenant-scoped read/write for that row under
 * `withTenantContext` so RLS still protects a single delivery's own data.
 *
 * One tick = CLAIM (one UPDATE ... FOR UPDATE SKIP LOCKED, so N dispatcher
 * processes never double-claim) → per-row ordering guard → per-row tenant
 * allowlist check → per-row policy/target/provider resolution → one
 * `appendWorkLog` call → FINALIZE (one UPDATE guarded by the lease token, so
 * a dispatcher that ran past its lease can never clobber a row a second
 * dispatcher has since re-claimed).
 *
 * A single bad delivery must never stop the batch: every per-row step after
 * the claim is wrapped so an unexpected throw degrades that ONE row to a
 * retryable failure (bounded by `maxAttempts`) and the loop continues.
 */
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import {
  RETRYABLE_STATES,
  backoffDelayMs,
  deliveryStateFor,
  isTerminalState,
  markerFor,
  type CmmsWriteProvider,
  type CmmsWriteResult,
  type DeliveryState,
  type WorkLogNote,
} from "@/lib/cmms/write-contract";
import { loadTenantWritePolicy } from "./policy";
import { resolveWorkOrderTarget } from "./target";
import type { DeliveryRow, DomainEventRow } from "./types";

export type DispatchDeps = {
  /** Resolve a `notebook_event_deliveries.connection_key` (the tenant's CMMS
   *  provider slug, e.g. "atlas") to a live write provider. `null` means
   *  "nothing wired for this connection" — reported as `unsupported`. */
  providerFor: (connectionKey: string) => CmmsWriteProvider | null;
  /** Tenants this tick is allowed to write for. Every other claimed row is
   *  finalized `blocked_policy` without ever touching the provider. */
  tenantAllowlist: Set<string>;
  now?: () => Date;
  rand?: () => number;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  log?: (line: string) => void;
};

export type DispatchStats = {
  claimed: number;
  verified: number;
  accepted: number;
  unsupported: number;
  blocked: number;
  conflict: number;
  retryable: number;
  permanent: number;
  unknown: number;
  quarantined: number;
  permissionDenied: number;
  skippedOrdering: number;
};

function zeroStats(): DispatchStats {
  return {
    claimed: 0,
    verified: 0,
    accepted: 0,
    unsupported: 0,
    blocked: 0,
    conflict: 0,
    retryable: 0,
    permanent: 0,
    unknown: 0,
    quarantined: 0,
    permissionDenied: 0,
    skippedOrdering: 0,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

function buildNoteText(symptom: string, faultCode: string | null, fix: string): string {
  const raw = `Recorded fix — symptom: ${symptom}` + (faultCode ? `; fault code: ${faultCode}` : "") + `; fix: ${fix}`;
  return raw.replace(CONTROL_CHARS_RE, "").slice(0, 1500);
}

type Outcome = {
  state: DeliveryState;
  reason?: string | null;
  externalRef?: string | null;
  receiptPatch?: Record<string, unknown>;
};

/**
 * Resolve policy/target/provider and attempt one `appendWorkLog` call for a
 * single claimed delivery. Runs under `withTenantContext(row.tenant_id)` so
 * RLS scopes every read to this tenant. Never throws — any failure resolves
 * to a `retryable_failure`/`quarantined` outcome instead, so the caller's
 * per-row isolation is a belt-and-suspenders backstop, not the only guard.
 */
async function attemptDelivery(
  row: DeliveryRow,
  deps: DispatchDeps,
  maxAttempts: number,
): Promise<Outcome> {
  return withTenantContext(row.tenant_id, async (tc) => {
    const eventRes = await tc.query<DomainEventRow>(
      `SELECT * FROM notebook_domain_events WHERE event_id = $1::uuid AND tenant_id = $2::uuid`,
      [row.event_id, row.tenant_id],
    );
    const event = eventRes.rows[0];
    if (!event) {
      return { state: "permanent_failure", reason: "event_not_found" };
    }

    const config = await loadTenantWritePolicy(tc, row.tenant_id);
    if (!config) return { state: "blocked_policy", reason: "no_connection" };
    if (!config.enabled) return { state: "blocked_policy", reason: "connection_disabled" };
    if (!config.policy.fixRecorded.enabled) return { state: "blocked_policy", reason: "policy_disabled" };

    const targetRes = await resolveWorkOrderTarget(tc, {
      tenantId: row.tenant_id,
      provider: config.provider,
      policy: config.policy,
      equipmentEntityId: event.equipment_entity_id,
    });
    if (!targetRes.ok) {
      if (targetRes.reason === "legacy_push_pending") {
        return { state: "retryable_failure", reason: targetRes.reason };
      }
      return { state: "blocked_policy", reason: targetRes.reason };
    }

    const provider = deps.providerFor(row.connection_key);
    if (!provider) {
      return { state: "unsupported", reason: "provider_not_available" };
    }

    const payload = event.payload as { symptom?: unknown; faultCode?: unknown; fix?: unknown };
    const symptom = typeof payload.symptom === "string" ? payload.symptom : "";
    const faultCode = typeof payload.faultCode === "string" ? payload.faultCode : null;
    const fix = typeof payload.fix === "string" ? payload.fix : "";

    const note: WorkLogNote = {
      idempotencyKey: row.dedupe_key,
      marker: markerFor(row.event_id),
      text: buildNoteText(symptom, faultCode, fix),
      attributionLabel: "Technician",
      occurredAt: new Date(event.occurred_at).toISOString(),
      sourceRef: event.subject_ref,
    };

    let result: CmmsWriteResult;
    try {
      result = await provider.appendWorkLog(targetRes.target, note);
    } catch (err) {
      // A throw is a poison signal, not an honest outcome — escalate to
      // quarantine once retries are exhausted rather than treating it like
      // any other `retryable_failure` forever.
      if (row.attempts >= maxAttempts) {
        return { state: "quarantined", reason: `poison: ${errMessage(err)}` };
      }
      return { state: "retryable_failure", reason: `throw: ${errMessage(err)}` };
    }

    let state = deliveryStateFor(result);
    let reason = "reason" in result ? result.reason : undefined;
    const externalRef = "externalRef" in result ? result.externalRef : null;

    if (state === "retryable_failure" && row.attempts >= maxAttempts) {
      state = "permanent_failure";
      reason = "max_attempts";
    }

    return { state, reason, externalRef, receiptPatch: result.receipt };
  });
}

/** FINALIZE: one lease-guarded UPDATE on the pool. Returns false (and logs)
 *  if the lease was stolen out from under this attempt — the row is left
 *  for whoever holds it now; this tick never retries it itself. */
async function finalizeDelivery(
  row: DeliveryRow,
  outcome: Outcome,
  nextAttemptAt: Date,
  now: Date,
  deps: DispatchDeps,
): Promise<boolean> {
  const receiptPatch = {
    ...(outcome.receiptPatch ?? {}),
    attempt: row.attempts,
    state: outcome.state,
    at: now.toISOString(),
  };

  const res = await pool.query(
    `UPDATE notebook_event_deliveries
        SET state = $1,
            external_ref = COALESCE($2, external_ref),
            last_error = $3,
            receipt = receipt || $4::jsonb,
            next_attempt_at = $5,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
      WHERE delivery_id = $6 AND lease_token = $7
      RETURNING delivery_id`,
    [
      outcome.state,
      outcome.externalRef ?? null,
      outcome.reason ?? null,
      JSON.stringify(receiptPatch),
      nextAttemptAt.toISOString(),
      row.delivery_id,
      row.lease_token,
    ],
  );
  if ((res.rowCount ?? 0) === 0) {
    deps.log?.(`[cmms-dispatch] stale lease on delivery ${row.delivery_id} — not retried this tick`);
    return false;
  }
  return true;
}

function bumpStat(stats: DispatchStats, state: DeliveryState): void {
  switch (state) {
    case "verified_by_readback":
      stats.verified++;
      break;
    case "accepted_pending_verification":
      stats.accepted++;
      break;
    case "unsupported":
      stats.unsupported++;
      break;
    case "blocked_policy":
      stats.blocked++;
      break;
    case "conflict":
      stats.conflict++;
      break;
    case "retryable_failure":
      stats.retryable++;
      break;
    case "permanent_failure":
      stats.permanent++;
      break;
    case "outcome_unknown":
      stats.unknown++;
      break;
    case "quarantined":
      stats.quarantined++;
      break;
    case "permission_denied":
      stats.permissionDenied++;
      break;
    case "queued":
    case "leased":
      // Never a finalize target — nothing to count.
      break;
  }
}

export async function runDispatchTick(deps: DispatchDeps): Promise<DispatchStats> {
  const batchSize = deps.batchSize ?? 20;
  const leaseMs = deps.leaseMs ?? 120_000;
  const maxAttempts = deps.maxAttempts ?? 8;
  const now = deps.now ?? (() => new Date());
  const rand = deps.rand ?? Math.random;

  const stats = zeroStats();

  const claimRes = await pool.query<DeliveryRow>(
    `UPDATE notebook_event_deliveries d
        SET state = 'leased',
            lease_token = gen_random_uuid(),
            lease_until = now() + make_interval(secs => $1),
            attempts = attempts + 1,
            updated_at = now()
       FROM (
         SELECT delivery_id FROM notebook_event_deliveries
          WHERE next_attempt_at <= now()
            AND ((state = ANY($2::text[])) OR (state = 'leased' AND lease_until < now()))
          ORDER BY created_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       ) s
      WHERE d.delivery_id = s.delivery_id
    RETURNING d.*`,
    [Math.round(leaseMs / 1000), RETRYABLE_STATES as readonly string[], batchSize],
  );

  stats.claimed = claimRes.rows.length;

  for (const row of claimRes.rows) {
    try {
      // ORDERING: an older, still-active delivery on the same machine
      // (aggregate_key) must be resolved first — a delayed older event can
      // never overtake a newer one at delivery time (111's own design goal).
      const olderRes = await pool.query<{ state: DeliveryState }>(
        `SELECT state FROM notebook_event_deliveries
          WHERE aggregate_key = $1 AND created_at < $2 AND delivery_id <> $3`,
        [row.aggregate_key, row.created_at, row.delivery_id],
      );
      const hasOlderActive = olderRes.rows.some((r) => !isTerminalState(r.state));
      if (hasOlderActive) {
        await pool.query(
          `UPDATE notebook_event_deliveries
              SET state = 'queued',
                  next_attempt_at = now() + interval '30 seconds',
                  attempts = attempts - 1,
                  lease_token = NULL,
                  lease_until = NULL,
                  updated_at = now()
            WHERE delivery_id = $1 AND lease_token = $2`,
          [row.delivery_id, row.lease_token],
        );
        stats.skippedOrdering++;
        continue;
      }

      // TENANT ALLOWLIST — checked before any provider/credential touch.
      if (!deps.tenantAllowlist.has(row.tenant_id)) {
        const ok = await finalizeDelivery(
          row,
          { state: "blocked_policy", reason: "tenant_not_allowlisted" },
          now(),
          now(),
          deps,
        );
        if (ok) bumpStat(stats, "blocked_policy");
        continue;
      }

      const outcome = await attemptDelivery(row, deps, maxAttempts);

      let nextAttemptAt = now();
      if (
        outcome.state === "retryable_failure" ||
        outcome.state === "outcome_unknown" ||
        outcome.state === "accepted_pending_verification"
      ) {
        nextAttemptAt = new Date(now().getTime() + backoffDelayMs(row.attempts, rand));
      }

      const ok = await finalizeDelivery(row, outcome, nextAttemptAt, now(), deps);
      if (ok) bumpStat(stats, outcome.state);
    } catch (err) {
      // Isolation: one bad delivery never stops the batch. Best-effort
      // finalize as retryable (bounded by maxAttempts on the NEXT claim's
      // attempts count); if even that fails, just log and move on.
      deps.log?.(`[cmms-dispatch] delivery ${row.delivery_id} errored outside attemptDelivery: ${errMessage(err)}`);
      try {
        const state: DeliveryState = row.attempts >= maxAttempts ? "quarantined" : "retryable_failure";
        const nextAttemptAt =
          state === "retryable_failure" ? new Date(now().getTime() + backoffDelayMs(row.attempts, rand)) : now();
        const ok = await finalizeDelivery(row, { state, reason: `tick_error: ${errMessage(err)}` }, nextAttemptAt, now(), deps);
        if (ok) bumpStat(stats, state);
      } catch (finalizeErr) {
        deps.log?.(`[cmms-dispatch] delivery ${row.delivery_id} could not even be finalized: ${errMessage(finalizeErr)}`);
      }
    }
  }

  return stats;
}
