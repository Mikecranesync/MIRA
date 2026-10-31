/**
 * The outbox dispatcher (#5020): claims due `notebook_event_deliveries` rows
 * on the raw pool (the same BYPASSRLS-owner-connection-plus-explicit-tenant-
 * filter posture `src/lib/atlas/sync.ts` already uses for its cross-tenant
 * worker loop), plans every tenant-scoped read for one row under
 * `withTenantContext` (RLS), and only then talks to the vendor.
 *
 * One tick, per claimed row:
 *   CLAIM    — one UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED): N dispatcher
 *              processes never double-claim a due row.
 *   ORDER    — an older, still-active delivery on the same aggregate (by the
 *              EVENT's sequence, never by timestamp) defers this one.
 *   PLAN     — a SHORT tenant-scoped transaction: load the event, revalidate the
 *              connection policy, and either reuse the destination pinned on
 *              the first attempt or resolve it now. No vendor call in here.
 *   PIN+RENEW— one lease-guarded UPDATE that persists the destination (first
 *              attempt only), re-verifies this worker still owns the row and
 *              renews the lease — BEFORE any external write. A row whose lease
 *              was reclaimed is skipped, not written.
 *   WRITE    — the provider call, outside every database transaction.
 *   FINALIZE — one lease-guarded UPDATE; a stale worker's late result can
 *              never clobber a row another worker has since re-claimed.
 *
 * Retry bounds apply to EVERY rescheduled outcome (Codex round 1, F5): a
 * `retryable_failure` that exhausts `maxAttempts` becomes `permanent_failure`;
 * an ambiguous `outcome_unknown` / `accepted_pending_verification` that cannot
 * be reconciled within the budget becomes `quarantined` (retained, operator-
 * visible) rather than retrying forever or claiming failure it cannot prove.
 *
 * Provider identity is checked three times before any vendor call (Codex
 * round 2, F1): the tenant's CURRENT connection must still be the one the
 * delivery was queued for (`connection_key`), the pinned/resolved target must
 * name that same provider, and the adapter selected for the row must report
 * that same `providerId`. Any mismatch is `blocked_policy` — retained, never
 * guessed, never written to a foreign vendor's record id.
 *
 * A POSSIBLY-SENT delivery is never written twice (Codex round 2 F7, round 3
 * F9): once a write may have reached the vendor — acknowledged
 * (`accepted_pending_verification`, usually with an `external_ref`), ambiguous
 * (`outcome_unknown`: the request was sent and the response lost), or an
 * expired-lease reclaim whose previous owner had already pinned the
 * destination and so may have reached the vendor before dying — later ticks
 * only READ BACK. Found once → verified; found more than once → conflict; not
 * visible yet → still pending until the attempt budget quarantines it for a
 * human. Without destination-side idempotency there is no proof a write did
 * NOT happen, so a lost write ends quarantined and visible, never duplicated.
 *
 * A single bad delivery must never stop the batch: every per-row step after
 * the claim is isolated so an unexpected throw degrades that ONE row.
 */
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import {
  RETRYABLE_STATES,
  backoffDelayMs,
  deliveryStateFor,
  isTerminalState,
  markerFor,
  type CmmsReadBackResult,
  type CmmsWriteProvider,
  type CmmsWriteResult,
  type DeliveryState,
  type WorkLogNote,
  type WorkOrderTarget,
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
  /** Rows whose lease was no longer ours at pin-time — skipped, never written. */
  leaseLost: number;
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
    leaseLost: 0,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

/**
 * The exported text carries the WHOLE accepted record (Codex round 2, F8).
 * Its bound is the record's own validation in `fix-records.ts` (symptom 500,
 * fault code 64, fix 2000 chars), and Atlas stores comment content as TEXT
 * (upstream `Comment.java`: `@Column(columnDefinition = "TEXT")`), so nothing
 * is cut here: a silent cut would let marker read-back "verify" an incomplete
 * maintenance record.
 */
function buildNoteText(symptom: string, faultCode: string | null, fix: string): string {
  const raw = `Recorded fix — symptom: ${symptom}` + (faultCode ? `; fault code: ${faultCode}` : "") + `; fix: ${fix}`;
  return raw.replace(CONTROL_CHARS_RE, "");
}

/** Receipt key under which the FIRST attempt pins the destination (Codex F1).
 *  Later attempts reconcile and retry against exactly this target; a policy
 *  or asset-link change after the first external write must never silently
 *  retarget an in-flight delivery. Revocation (policy disabled) still stops it. */
export const PINNED_TARGET_KEY = "pinned_target";

export type PinnedTarget = {
  providerId: string;
  externalWorkOrderId: string;
  source: string;
  pinnedAt: string;
};

export function pinnedTargetOf(row: Pick<DeliveryRow, "receipt">): PinnedTarget | null {
  const raw = row.receipt?.[PINNED_TARGET_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.providerId !== "string" || typeof t.externalWorkOrderId !== "string") return null;
  return {
    providerId: t.providerId,
    externalWorkOrderId: t.externalWorkOrderId,
    source: typeof t.source === "string" ? t.source : "unknown",
    pinnedAt: typeof t.pinnedAt === "string" ? t.pinnedAt : "",
  };
}

type Outcome = {
  state: DeliveryState;
  reason?: string | null;
  externalRef?: string | null;
  receiptPatch?: Record<string, unknown>;
};

type DeliverPlan = { kind: "deliver"; target: WorkOrderTarget; targetSource: string; alreadyPinned: boolean; note: WorkLogNote };
type Plan = { kind: "outcome"; outcome: Outcome } | DeliverPlan;

/** A claimed row plus the state it was in BEFORE this claim (the CLAIM query
 *  captures it from the locked subquery — `RETURNING d.*` alone would only
 *  ever say `leased`) and whether it was reclaimed from an expired lease. A
 *  reclaim reports the last finalized state (`receipt.state`), or `queued`
 *  if the row was never finalized. */
type ClaimedRow = DeliveryRow & { prior_state: string; reclaimed: boolean };

/** Did the vendor ACKNOWLEDGE this delivery? (prior state accepted, or a
 *  retained external_ref) — decides which pending state a not-yet-visible
 *  read-back preserves: an ack is never downgraded, an ambiguity is never
 *  promoted to an ack. */
function isAcknowledged(row: ClaimedRow): boolean {
  return row.prior_state === "accepted_pending_verification" || row.external_ref !== null;
}

/** MAY a write already have reached the vendor? Then this row is reconciled
 *  by read-back only — never written again (Codex round 2 F7, round 3 F9):
 *  acknowledged, ambiguous (`outcome_unknown`), or reclaimed from an expired
 *  lease whose previous owner had already PINNED the destination. PIN
 *  precedes WRITE and only succeeds for the lease holder, so a reclaimed row
 *  WITHOUT a pin was never written and may be delivered normally. */
function isPossiblySent(row: ClaimedRow): boolean {
  if (isAcknowledged(row)) return true;
  if (row.prior_state === "outcome_unknown") return true;
  return row.reclaimed && pinnedTargetOf(row) !== null;
}

/** The adapter, the target and the queued connection must all name the same
 *  provider (Codex round 2, F1). Checked immediately before every vendor call. */
function providerMismatch(row: ClaimedRow, plan: DeliverPlan, provider: CmmsWriteProvider): Outcome | null {
  if (provider.providerId === row.connection_key && plan.target.providerId === row.connection_key) return null;
  return {
    state: "blocked_policy",
    reason: `provider_mismatch:adapter=${provider.providerId},target=${plan.target.providerId},connection=${row.connection_key}`,
  };
}

/**
 * PLAN: everything tenant-scoped, in one short `withTenantContext` transaction
 * that holds NO vendor call. Policy is revalidated on every attempt (a revoked
 * or disabled connection stops delivery); the destination is pinned on the
 * first attempt and reused verbatim afterwards.
 */
async function planDelivery(row: DeliveryRow): Promise<Plan> {
  return withTenantContext(row.tenant_id, async (tc) => {
    const eventRes = await tc.query<DomainEventRow>(
      `SELECT * FROM notebook_domain_events WHERE event_id = $1::uuid AND tenant_id = $2::uuid`,
      [row.event_id, row.tenant_id],
    );
    const event = eventRes.rows[0];
    if (!event) {
      return { kind: "outcome", outcome: { state: "permanent_failure", reason: "event_not_found" } };
    }
    const config = await loadTenantWritePolicy(tc, row.tenant_id);
    if (!config) return { kind: "outcome", outcome: { state: "blocked_policy", reason: "no_connection" } };
    if (!config.enabled) return { kind: "outcome", outcome: { state: "blocked_policy", reason: "connection_disabled" } };
    if (!config.policy.fixRecorded.enabled) {
      return { kind: "outcome", outcome: { state: "blocked_policy", reason: "policy_disabled" } };
    }
    // PROVIDER IDENTITY (Codex round 2, F1): the delivery was accepted for
    // `connection_key`. If the tenant has since switched providers, the
    // current config would resolve a target that belongs to the NEW vendor
    // while the adapter is chosen by the OLD key. Fail closed before any
    // target resolution; the event is retained for a human.
    if (config.provider !== row.connection_key) {
      return {
        kind: "outcome",
        outcome: { state: "blocked_policy", reason: `provider_changed:${row.connection_key}->${config.provider}` },
      };
    }

    let target: WorkOrderTarget;
    let targetSource: string;
    let alreadyPinned = false;
    const pinned = pinnedTargetOf(row);
    if (pinned) {
      if (pinned.providerId !== row.connection_key) {
        return {
          kind: "outcome",
          outcome: { state: "blocked_policy", reason: `pinned_provider_mismatch:${pinned.providerId}` },
        };
      }
      target = { providerId: pinned.providerId, externalWorkOrderId: pinned.externalWorkOrderId };
      targetSource = pinned.source;
      alreadyPinned = true;
    } else {
      const targetRes = await resolveWorkOrderTarget(tc, {
        tenantId: row.tenant_id,
        provider: config.provider,
        policy: config.policy,
        equipmentEntityId: event.equipment_entity_id,
      });
      if (!targetRes.ok) {
        if (targetRes.reason === "legacy_push_pending") {
          return { kind: "outcome", outcome: { state: "retryable_failure", reason: targetRes.reason } };
        }
        return { kind: "outcome", outcome: { state: "blocked_policy", reason: targetRes.reason } };
      }
      target = targetRes.target;
      targetSource = targetRes.source;
      if (target.providerId !== row.connection_key) {
        return {
          kind: "outcome",
          outcome: { state: "blocked_policy", reason: `target_provider_mismatch:${target.providerId}` },
        };
      }
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
    return { kind: "deliver", target, targetSource, alreadyPinned, note };
  });
}

/**
 * PIN + RENEW: one lease-guarded statement on the pool, BEFORE any external
 * write (Codex F1 + F3). Persists the destination on the first attempt,
 * proves this worker still owns an unexpired lease, and extends the lease so
 * a long batch cannot run past its window mid-row. Zero rows = the lease was
 * reclaimed (or expired) — the caller must not write.
 */
async function pinAndRenewLease(row: ClaimedRow, plan: DeliverPlan, leaseMs: number, now: Date): Promise<boolean> {
  const patch: Record<string, unknown> = plan.alreadyPinned
    ? {}
    : {
        [PINNED_TARGET_KEY]: {
          providerId: plan.target.providerId,
          externalWorkOrderId: plan.target.externalWorkOrderId,
          source: plan.targetSource,
          pinnedAt: now.toISOString(),
        } satisfies PinnedTarget,
      };
  const res = await pool.query(
    `UPDATE notebook_event_deliveries
        SET receipt = receipt || $1::jsonb,
            lease_until = now() + make_interval(secs => $2),
            updated_at = now()
      WHERE delivery_id = $3
        AND lease_token = $4
        AND state = 'leased'
        AND lease_until > now()
      RETURNING delivery_id`,
    [JSON.stringify(patch), Math.round(leaseMs / 1000), row.delivery_id, row.lease_token],
  );
  return (res.rowCount ?? 0) === 1;
}

/** WRITE: the provider call, outside every database transaction. */
async function writeDelivery(row: ClaimedRow, plan: DeliverPlan, deps: DispatchDeps, maxAttempts: number): Promise<Outcome> {
  const provider = deps.providerFor(row.connection_key);
  if (!provider) {
    return { state: "unsupported", reason: "provider_not_available" };
  }
  const mismatch = providerMismatch(row, plan, provider);
  if (mismatch) return mismatch;
  let result: CmmsWriteResult;
  try {
    result = await provider.appendWorkLog(plan.target, plan.note);
  } catch (err) {
    // A throw is a poison signal, not an honest outcome — escalate to
    // quarantine once retries are exhausted rather than treating it like
    // any other `retryable_failure` forever.
    if (row.attempts >= maxAttempts) {
      return { state: "quarantined", reason: `poison: ${errMessage(err)}` };
    }
    return { state: "retryable_failure", reason: `throw: ${errMessage(err)}` };
  }
  const state = deliveryStateFor(result);
  const reason = "reason" in result ? result.reason : undefined;
  const externalRef = "externalRef" in result ? result.externalRef : null;
  return { state, reason, externalRef, receiptPatch: result.receipt };
}

/**
 * RECONCILE (Codex round 2 F7, round 3 F9): read-only. A write may already
 * have reached the vendor, so a second `appendWorkLog` could create a
 * duplicate whenever the vendor's search lags its own writes. Only read-back
 * moves the row: found exactly once → verified; more than once → conflict;
 * not visible yet, unsupported or failing read-back → the row KEEPS its
 * pending state — `accepted_pending_verification` when the vendor acknowledged
 * (the `external_ref` is kept by FINALIZE's COALESCE), `outcome_unknown` when
 * it did not — until the attempt budget quarantines it for a human.
 */
async function reconcileDelivery(row: ClaimedRow, plan: DeliverPlan, deps: DispatchDeps, maxAttempts: number): Promise<Outcome> {
  const pending: DeliveryState = isAcknowledged(row) ? "accepted_pending_verification" : "outcome_unknown";
  const provider = deps.providerFor(row.connection_key);
  if (!provider) {
    return { state: pending, reason: "provider_not_available" };
  }
  const mismatch = providerMismatch(row, plan, provider);
  if (mismatch) return mismatch;
  let readBack: CmmsReadBackResult;
  try {
    readBack = await provider.readBackWorkLog(plan.target, plan.note.marker);
  } catch (err) {
    if (row.attempts >= maxAttempts) {
      return { state: "quarantined", reason: `poison: ${errMessage(err)}` };
    }
    return { state: pending, reason: `readback_throw: ${errMessage(err)}` };
  }
  switch (readBack.kind) {
    case "found":
      if (readBack.count > 1) {
        return { state: "conflict", reason: "duplicate_marker", receiptPatch: readBack.receipt };
      }
      return { state: "verified_by_readback", externalRef: readBack.externalRef, receiptPatch: readBack.receipt };
    case "not_found":
      return { state: pending, reason: "readback_not_yet_visible", receiptPatch: readBack.receipt };
    case "unsupported":
      return { state: pending, reason: `readback_unsupported:${readBack.reason}`, receiptPatch: readBack.receipt };
    case "error":
      return { state: pending, reason: `readback_error:${readBack.reason}`, receiptPatch: readBack.receipt };
  }
}

/** Outcomes the tick reschedules instead of closing. Every one of them is
 *  bounded by `maxAttempts` (Codex F5). */
const RESCHEDULED_STATES: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  "retryable_failure",
  "outcome_unknown",
  "accepted_pending_verification",
]);

function boundOutcome(row: DeliveryRow, outcome: Outcome, maxAttempts: number): Outcome {
  if (!RESCHEDULED_STATES.has(outcome.state) || row.attempts < maxAttempts) return outcome;
  if (outcome.state === "retryable_failure") {
    return { ...outcome, state: "permanent_failure", reason: `max_attempts:${outcome.reason ?? "retryable_failure"}` };
  }
  // Ambiguous after the whole budget: retained for manual reconciliation,
  // never "failed" (it may have landed) and never retried forever.
  return { ...outcome, state: "quarantined", reason: `max_attempts_unreconciled:${outcome.state}` };
}

/** FINALIZE: one lease-guarded UPDATE on the pool. Returns false (and logs)
 *  if the lease was stolen out from under this attempt — the row is left
 *  for whoever holds it now; this tick never retries it itself. */
async function finalizeDelivery(
  row: ClaimedRow,
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

/** Put a claimed row back without counting an attempt (ordering deferral).
 *  It goes back to the state it was claimed FROM — an acknowledged delivery
 *  must not be demoted to `queued`, or the next claim would write it again. */
async function releaseForOrdering(row: ClaimedRow): Promise<void> {
  const restore: DeliveryState = (RETRYABLE_STATES as readonly string[]).includes(row.prior_state)
    ? (row.prior_state as DeliveryState)
    : "queued";
  await pool.query(
    `UPDATE notebook_event_deliveries
        SET state = $3,
            next_attempt_at = now() + interval '30 seconds',
            attempts = attempts - 1,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
      WHERE delivery_id = $1 AND lease_token = $2`,
    [row.delivery_id, row.lease_token, restore],
  );
}

export async function runDispatchTick(deps: DispatchDeps): Promise<DispatchStats> {
  const batchSize = deps.batchSize ?? 20;
  const leaseMs = deps.leaseMs ?? 120_000;
  const maxAttempts = deps.maxAttempts ?? 8;
  const now = deps.now ?? (() => new Date());
  const rand = deps.rand ?? Math.random;
  const stats = zeroStats();

  // The locked subquery also captures the state each row is claimed FROM
  // (`prior_state`) and whether it is an expired-lease reclaim (`reclaimed`):
  // `RETURNING d.*` alone would only ever say `leased`, and a possibly-sent
  // delivery must be reconciled, not re-written. For a reclaim the last
  // FINALIZED state is in `receipt.state`.
  const claimRes = await pool.query<ClaimedRow>(
    `UPDATE notebook_event_deliveries d
        SET state = 'leased',
            lease_token = gen_random_uuid(),
            lease_until = now() + make_interval(secs => $1),
            attempts = attempts + 1,
            updated_at = now()
       FROM (
         SELECT delivery_id,
                CASE WHEN state = 'leased' THEN COALESCE(receipt->>'state', 'queued') ELSE state END AS prior_state,
                (state = 'leased') AS reclaimed
           FROM notebook_event_deliveries
          WHERE next_attempt_at <= now()
            AND ((state = ANY($2::text[])) OR (state = 'leased' AND lease_until < now()))
          ORDER BY created_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       ) s
      WHERE d.delivery_id = s.delivery_id
    RETURNING d.*, s.prior_state, s.reclaimed`,
    [Math.round(leaseMs / 1000), RETRYABLE_STATES as readonly string[], batchSize],
  );
  stats.claimed = claimRes.rows.length;

  for (const row of claimRes.rows) {
    try {
      // ORDERING (Codex F4): predecessors are the same aggregate's deliveries
      // whose EVENT sequence is lower — the sequence is allocated under the
      // enqueue's advisory lock, so it is the one total order on a case.
      // created_at is a transaction-start timestamp and can disagree with it.
      const olderRes = await pool.query<{ state: DeliveryState }>(
        `SELECT d2.state
           FROM notebook_event_deliveries d2
           JOIN notebook_domain_events e2 ON e2.event_id = d2.event_id
          WHERE d2.aggregate_key = $1
            AND d2.delivery_id <> $2
            AND e2.sequence < (SELECT e.sequence FROM notebook_domain_events e WHERE e.event_id = $3::uuid)`,
        [row.aggregate_key, row.delivery_id, row.event_id],
      );
      const hasOlderActive = olderRes.rows.some((r) => !isTerminalState(r.state));
      if (hasOlderActive) {
        await releaseForOrdering(row);
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

      // PLAN (short tenant transaction, no vendor call).
      const plan = await planDelivery(row);
      let outcome: Outcome;
      if (plan.kind === "outcome") {
        outcome = plan.outcome;
      } else {
        // PIN + RENEW before any external write; skip if the lease is gone.
        const owned = await pinAndRenewLease(row, plan, leaseMs, now());
        if (!owned) {
          deps.log?.(`[cmms-dispatch] lease lost before write on delivery ${row.delivery_id} — skipped`);
          stats.leaseLost++;
          continue;
        }
        // WRITE or RECONCILE (outside any transaction): a delivery that may
        // already have reached the vendor is only ever read back, never
        // written again (F7, F9).
        outcome = isPossiblySent(row)
          ? await reconcileDelivery(row, plan, deps, maxAttempts)
          : await writeDelivery(row, plan, deps, maxAttempts);
      }

      outcome = boundOutcome(row, outcome, maxAttempts);
      let nextAttemptAt = now();
      if (RESCHEDULED_STATES.has(outcome.state)) {
        nextAttemptAt = new Date(now().getTime() + backoffDelayMs(row.attempts, rand));
      }
      const ok = await finalizeDelivery(row, outcome, nextAttemptAt, now(), deps);
      if (ok) bumpStat(stats, outcome.state);
    } catch (err) {
      // Isolation: one bad delivery never stops the batch. Best-effort
      // finalize as retryable (bounded by maxAttempts); if even that fails,
      // just log and move on.
      deps.log?.(`[cmms-dispatch] delivery ${row.delivery_id} errored: ${errMessage(err)}`);
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
