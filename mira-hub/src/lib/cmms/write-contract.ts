/**
 * Vendor-neutral CMMS WRITE contract (#5020, slice E-lite).
 *
 * The read side already has a vendor-neutral seam (`./provider.ts` — deep links
 * and tenant config). There is NO write seam today: every Atlas write in the
 * repo calls `AtlasClient` directly (catalog A5 §1.3). This file is the
 * contract an outbox dispatcher speaks, and that every adapter — Atlas first,
 * an in-memory mock second — implements. The language-neutral twin lives at
 * `contracts/cmms-write-contract.v1.json`; Python adapters (`mira-mcp/cmms/`)
 * adopt it later, compatibly.
 *
 * Honesty rules the contract encodes (mission §6.2):
 *   - every operation reports its support PER PROVIDER AND PER TARGET
 *     (`capabilities()`), discovered at runtime where the vendor version is not
 *     known statically — a provider never claims an operation it cannot prove;
 *   - a result is one of a closed set of outcomes; a legacy `{error: …}` dict
 *     or an empty body is never success;
 *   - `outcome_unknown` is a real outcome (ambiguous timeout after a possible
 *     write) that the caller reconciles via `readBackWorkLog`, never by a blind
 *     second non-idempotent write.
 */

export const CMMS_OPERATIONS = [
  "append_work_log",
  "attach_evidence",
  "record_reading",
  "transition_work_order",
  "read_work_log",
  "list_changes",
] as const;
export type CmmsOperation = (typeof CMMS_OPERATIONS)[number];

export type CmmsSupport = "implemented" | "unsupported" | "unknown";

export type CmmsCapability = {
  support: CmmsSupport;
  /** Machine-readable reason when not implemented (e.g. `atlas_version_without_comments`). */
  reason?: string;
  /** How support was established (e.g. `GET /comments/count/{id} → 200`). */
  probe?: string;
};

export type CmmsCapabilityMatrix = Record<CmmsOperation, CmmsCapability>;

/** A destination work order, identified by the provider's own id. */
export type WorkOrderTarget = {
  providerId: string;
  externalWorkOrderId: string;
};

/**
 * One attributed work-log note. `marker` is the stable idempotency token the
 * provider must embed verbatim in the delivered record so read-back can find
 * it (`[MIRA:<event_id>]`). `text` is the permitted exported content only.
 */
export type WorkLogNote = {
  idempotencyKey: string;
  marker: string;
  text: string;
  attributionLabel: string;
  occurredAt: string;
  /** Source reference for audit (e.g. `asset_fix_records:<id>`), not a URL. */
  sourceRef: string;
};

export type CmmsReceipt = Record<string, unknown>;

export type CmmsWriteResult =
  | { kind: "success"; externalRef: string; receipt: CmmsReceipt }
  | { kind: "accepted_pending_verification"; externalRef: string | null; receipt: CmmsReceipt }
  | { kind: "verified_by_readback"; externalRef: string; receipt: CmmsReceipt }
  | { kind: "unsupported"; reason: string; receipt: CmmsReceipt }
  | { kind: "permission_denied"; reason: string; receipt: CmmsReceipt }
  | { kind: "conflict"; reason: string; receipt: CmmsReceipt }
  | { kind: "retryable_failure"; reason: string; retryAfterMs?: number; receipt: CmmsReceipt }
  | { kind: "permanent_failure"; reason: string; receipt: CmmsReceipt }
  | { kind: "outcome_unknown"; reason: string; receipt: CmmsReceipt };

export type CmmsReadBackResult =
  | { kind: "found"; externalRef: string; count: number; receipt: CmmsReceipt }
  | { kind: "not_found"; receipt: CmmsReceipt }
  | { kind: "unsupported"; reason: string; receipt: CmmsReceipt }
  | { kind: "error"; reason: string; retryable: boolean; receipt: CmmsReceipt };

export interface CmmsWriteProvider {
  readonly providerId: string;
  /** Per-target capability negotiation. Must never throw; unknown on error. */
  capabilities(target: WorkOrderTarget): Promise<CmmsCapabilityMatrix>;
  /**
   * Append one attributed note. Must be idempotent on `note.marker`: if a
   * record carrying the marker already exists, return `verified_by_readback`
   * for it instead of writing a second one. Must never throw.
   */
  appendWorkLog(target: WorkOrderTarget, note: WorkLogNote): Promise<CmmsWriteResult>;
  /** Find delivered records carrying `marker`. Must never throw. */
  readBackWorkLog(target: WorkOrderTarget, marker: string): Promise<CmmsReadBackResult>;
}

// ── Delivery states (mirrors migration 111's CHECK list; keep in sync) ──────

export const DELIVERY_STATES = [
  "queued",
  "leased",
  "accepted_pending_verification",
  "verified_by_readback",
  "conflict",
  "unsupported",
  "permission_denied",
  "retryable_failure",
  "permanent_failure",
  "outcome_unknown",
  "quarantined",
  "blocked_policy",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** States the dispatcher will pick up again. Everything else is terminal. */
export const RETRYABLE_STATES: readonly DeliveryState[] = [
  "queued",
  "retryable_failure",
  "outcome_unknown",
  "accepted_pending_verification",
];

export function isTerminalState(state: DeliveryState): boolean {
  return state !== "leased" && !RETRYABLE_STATES.includes(state);
}

/** Map a provider result to the delivery state it produces. */
export function deliveryStateFor(result: CmmsWriteResult): DeliveryState {
  switch (result.kind) {
    case "success":
      // A plain success without read-back proof is "accepted"; the next
      // dispatcher pass verifies it. Only read-back can say "verified".
      return "accepted_pending_verification";
    case "accepted_pending_verification":
      return "accepted_pending_verification";
    case "verified_by_readback":
      return "verified_by_readback";
    case "unsupported":
      return "unsupported";
    case "permission_denied":
      return "permission_denied";
    case "conflict":
      return "conflict";
    case "retryable_failure":
      return "retryable_failure";
    case "permanent_failure":
      return "permanent_failure";
    case "outcome_unknown":
      return "outcome_unknown";
  }
}

// ── Marker + note text ──────────────────────────────────────────────────────

export const MARKER_PREFIX = "[MIRA:";

/** The idempotency marker embedded in every delivered record. */
export function markerFor(eventId: string): string {
  return `${MARKER_PREFIX}${eventId}]`;
}

/** Exactly how many times `marker` occurs in `text` (non-overlapping). */
export function countMarker(text: string, marker: string): number {
  if (!marker) return 0;
  let n = 0;
  let i = text.indexOf(marker);
  while (i !== -1) {
    n++;
    i = text.indexOf(marker, i + marker.length);
  }
  return n;
}

/**
 * The delivered text: marker first (so read-back is a substring match),
 * then the permitted content, then attribution + time. No URLs, no ids of
 * people, no model output.
 */
export function renderWorkLogText(note: WorkLogNote): string {
  const when = note.occurredAt;
  return `${note.marker} ${note.text}\n— ${note.attributionLabel} via MIRA, ${when} (ref ${note.sourceRef})`;
}

// ── Backoff ─────────────────────────────────────────────────────────────────

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 30 * 60_000;

/**
 * Bounded exponential backoff with full jitter: base·2^(attempts-1), capped,
 * then scaled by a random factor in [0.5, 1]. `rand` is injectable for tests.
 */
export function backoffDelayMs(attempts: number, rand: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  const factor = 0.5 + 0.5 * Math.min(1, Math.max(0, rand()));
  return Math.round(exp * factor);
}
