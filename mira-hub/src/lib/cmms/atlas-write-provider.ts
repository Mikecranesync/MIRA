// Atlas-backed CmmsWriteProvider (#5020): work-log append/read-back only.
//
// At the deployed Atlas digest there is NO non-destructive text write
// (no CommentController, no `feedback` field, PATCH on tasks replaces the
// whole list, /files/upload is license-gated) — see
// contracts/cmms-write-contract.v1.json `atlasSupportAtDeployedDigest`. This
// provider probes `GET /comments/count/{id}` once per target and reports
// `unsupported` honestly rather than falling back to a destructive PATCH.
//
// Atlas >= v1.6.0 exposes POST /comments + POST /comments/search/{id}; the
// latter also returns synthetic system-generated history rows (system=true)
// that are filtered out before looking for our idempotency marker.

import { AtlasAuthError, AtlasHttpError, type AtlasComment } from "@/lib/atlas/client";

import {
  type CmmsCapability,
  type CmmsCapabilityMatrix,
  type CmmsReadBackResult,
  type CmmsWriteProvider,
  type CmmsWriteResult,
  type WorkLogNote,
  type WorkOrderRequest,
  type WorkOrderTarget,
  countMarker,
  renderWorkLogText,
} from "./write-contract";

/** The subset of AtlasClient this provider needs — lets tests inject a fake. */
export interface AtlasCommentApi {
  countComments(workOrderId: string | number): Promise<{ count: number }>;
  createComment(payload: { workOrder: { id: number }; content: string }): Promise<AtlasComment>;
  searchComments(workOrderId: string | number): Promise<AtlasComment[]>;
}

/**
 * The subset of `AtlasClient` the create-work-order path needs. Deliberately
 * a SEPARATE, OPTIONAL interface from `AtlasCommentApi` — not a new required
 * method on it — because existing inline test fakes
 * (`dispatcher.integration.test.ts`) implement only `AtlasCommentApi` and
 * would fail to typecheck if that interface grew a required member.
 */
export interface AtlasWorkOrderApi {
  createWorkOrder(payload: {
    title: string;
    description: string;
    priority: string;
    asset?: { id: number };
  }): Promise<{ id: number }>;
  searchWorkOrders(payload: {
    pageSize?: number;
    pageNum?: number;
  }): Promise<{ content: Array<{ id: number; description?: string }> }>;
}

export interface AtlasWriteProviderOptions {
  log?: (line: string) => void;
  /** How long a DEFINITIVE capability answer is trusted. Default 10 minutes. */
  capabilityTtlMs?: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /** Wires the create-work-order path. Absent ⇒ `createWorkOrder` reports
   *  `unsupported` and `capabilities().create_work_order` reflects that. */
  workOrders?: AtlasWorkOrderApi;
}

/** Bounds the read-back page scan (`findWorkOrderByMarker`) — Atlas's
 *  `/work-orders/search` has no text filter, so finding a marker means
 *  paging and checking `description` client-side. A scan that exhausts the
 *  cap without reaching the last page CANNOT prove the marker is absent, so
 *  it must never be read as `not_found` (that would let a pre-create check
 *  double-create). */
const WORK_ORDER_SEARCH_PAGE_SIZE = 25;
const WORK_ORDER_SEARCH_PAGE_CAP = 20;

export const CAPABILITY_TTL_MS = 10 * 60_000;

const PROBE = "GET /comments/count/{id}";

export class AtlasWriteProvider implements CmmsWriteProvider {
  readonly providerId = "atlas";

  private readonly api: AtlasCommentApi;
  private readonly workOrders: AtlasWorkOrderApi | undefined;
  private readonly log: (line: string) => void;
  // Codex round 1, F2: only DEFINITIVE probe results are cached, and only for
  // a bounded time. A transient error (network, 5xx, expired token) yields
  // `unknown`, which is never cached, so the next attempt re-probes; a
  // definitive answer (200 = comments exist, 404/405 = this Atlas version has
  // no comment endpoint) is re-checked after the TTL so an Atlas upgrade is
  // noticed without a worker restart.
  private readonly capabilityCache = new Map<string, { matrix: CmmsCapabilityMatrix; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(api: AtlasCommentApi, opts: AtlasWriteProviderOptions = {}) {
    this.api = api;
    this.workOrders = opts.workOrders;
    this.log = opts.log ?? (() => {});
    this.ttlMs = opts.capabilityTtlMs ?? CAPABILITY_TTL_MS;
    this.clock = opts.now ?? Date.now;
  }

  async capabilities(target: WorkOrderTarget): Promise<CmmsCapabilityMatrix> {
    if (target.providerId !== this.providerId) return this.foreignTargetMatrix(target);
    const key = this.targetKey(target);
    const cached = this.capabilityCache.get(key);
    if (cached && cached.expiresAt > this.clock()) return cached.matrix;
    this.capabilityCache.delete(key);

    const matrix = await this.probeCapabilities(target);
    if (matrix.append_work_log.support !== "unknown") {
      this.capabilityCache.set(key, { matrix, expiresAt: this.clock() + this.ttlMs });
    }
    return matrix;
  }

  /** Drop every cached probe (e.g. after re-authentication). */
  invalidateCapabilities(): void {
    this.capabilityCache.clear();
  }

  async appendWorkLog(target: WorkOrderTarget, note: WorkLogNote): Promise<CmmsWriteResult> {
    // Codex round 2, F1: a target that names another vendor is never sent to
    // Atlas, whatever its id happens to look like.
    if (target.providerId !== this.providerId) {
      return { kind: "permanent_failure", reason: `target_provider_mismatch:${target.providerId}`, receipt: {} };
    }
    const caps = await this.capabilities(target);
    const cap = caps.append_work_log;

    if (cap.support === "unsupported") {
      return {
        kind: "unsupported",
        reason: cap.reason ?? "atlas_version_without_comments",
        receipt: this.probeReceipt(cap),
      };
    }
    if (cap.support === "unknown") {
      if (cap.reason === "permission_denied") {
        return { kind: "permission_denied", reason: cap.reason, receipt: this.probeReceipt(cap) };
      }
      return { kind: "retryable_failure", reason: "capability_unknown", receipt: this.probeReceipt(cap) };
    }

    // cap.support === "implemented" — read-back FIRST (idempotency before any write).
    try {
      const existing = await this.findByMarker(target, note.marker);
      if (existing.length > 1) {
        return { kind: "conflict", reason: "duplicate_marker", receipt: { ids: existing.map((c) => c.id) } };
      }
      if (existing.length === 1) {
        return {
          kind: "verified_by_readback",
          externalRef: String(existing[0].id),
          receipt: { ids: [existing[0].id] },
        };
      }
    } catch (err) {
      return this.mapPreCreateLookupError(err);
    }

    let created: AtlasComment;
    try {
      created = await this.api.createComment({
        workOrder: { id: Number(target.externalWorkOrderId) },
        content: renderWorkLogText(note),
      });
    } catch (err) {
      return this.mapCreateError(err);
    }

    try {
      const after = await this.findByMarker(target, note.marker);
      if (after.length > 1) {
        return { kind: "conflict", reason: "duplicate_marker", receipt: { ids: after.map((c) => c.id) } };
      }
      if (after.length === 1) {
        return {
          kind: "verified_by_readback",
          externalRef: String(after[0].id),
          receipt: { ids: [after[0].id] },
        };
      }
      // The create succeeded (2xx) but read-back can't yet see it — report
      // the known created id, pending verification on a later pass.
      return {
        kind: "accepted_pending_verification",
        externalRef: String(created.id),
        receipt: { createdId: created.id },
      };
    } catch {
      // The write itself succeeded (`created` exists); only the confirming
      // read-back failed. Don't lose the create's result over that.
      this.log(`atlas write-back: post-create read-back failed for wo=${target.externalWorkOrderId}`);
      return {
        kind: "accepted_pending_verification",
        externalRef: String(created.id),
        receipt: { createdId: created.id },
      };
    }
  }

  async readBackWorkLog(target: WorkOrderTarget, marker: string): Promise<CmmsReadBackResult> {
    if (target.providerId !== this.providerId) {
      return { kind: "error", reason: `target_provider_mismatch:${target.providerId}`, retryable: false, receipt: {} };
    }
    try {
      const matches = await this.findByMarker(target, marker);
      if (matches.length === 0) {
        return { kind: "not_found", receipt: {} };
      }
      return {
        kind: "found",
        externalRef: String(matches[0].id),
        count: matches.length,
        receipt: { ids: matches.map((c) => c.id) },
      };
    } catch (err) {
      if (err instanceof AtlasHttpError && (err.status === 404 || err.status === 405)) {
        return { kind: "unsupported", reason: "atlas_version_without_comments", receipt: { status: err.status } };
      }
      if (err instanceof AtlasHttpError && (err.status === 401 || err.status === 403)) {
        return { kind: "error", reason: "permission_denied", retryable: false, receipt: { status: err.status } };
      }
      if (err instanceof AtlasAuthError) {
        return { kind: "error", reason: "atlas_not_configured", retryable: false, receipt: {} };
      }
      return { kind: "error", reason: "atlas_read_back_failed", retryable: true, receipt: {} };
    }
  }

  async createWorkOrder(req: WorkOrderRequest): Promise<CmmsWriteResult> {
    if (!this.workOrders) {
      return { kind: "unsupported", reason: "atlas_work_order_create_not_wired", receipt: {} };
    }

    // Idempotency before any write: a matching order already exists.
    const existing = await this.findWorkOrderByMarker(req.marker);
    if (existing.status === "cap_exhausted") {
      return { kind: "retryable_failure", reason: "readback_scan_cap_exhausted", receipt: {} };
    }
    if (existing.matches.length > 1) {
      return { kind: "conflict", reason: "duplicate_marker", receipt: { ids: existing.matches.map((m) => m.id) } };
    }
    if (existing.matches.length === 1) {
      return {
        kind: "verified_by_readback",
        externalRef: String(existing.matches[0].id),
        receipt: { id: existing.matches[0].id },
      };
    }

    const description = `${req.marker} ${req.description}\n— ${req.attributionLabel} via MIRA, ${req.occurredAt} (ref ${req.sourceRef})`;
    let created: { id: number };
    try {
      created = await this.workOrders.createWorkOrder({
        title: req.title,
        description,
        priority: req.priority,
        ...(req.externalAssetId ? { asset: { id: Number(req.externalAssetId) } } : {}),
      });
    } catch (err) {
      return this.mapCreateError(err);
    }

    try {
      const after = await this.findWorkOrderByMarker(req.marker);
      if (after.status === "cap_exhausted") {
        // The create itself succeeded (`created` exists) — only the
        // confirming scan was inconclusive. Don't lose the create's result.
        return { kind: "accepted_pending_verification", externalRef: String(created.id), receipt: { createdId: created.id } };
      }
      if (after.matches.length > 1) {
        return { kind: "conflict", reason: "duplicate_marker", receipt: { ids: after.matches.map((m) => m.id) } };
      }
      if (after.matches.length === 1) {
        return {
          kind: "verified_by_readback",
          externalRef: String(after.matches[0].id),
          receipt: { id: after.matches[0].id },
        };
      }
      return { kind: "accepted_pending_verification", externalRef: String(created.id), receipt: { createdId: created.id } };
    } catch {
      this.log(`atlas work-order create: post-create read-back failed for marker=${req.marker}`);
      return { kind: "accepted_pending_verification", externalRef: String(created.id), receipt: { createdId: created.id } };
    }
  }

  async readBackWorkOrder(marker: string): Promise<CmmsReadBackResult> {
    if (!this.workOrders) {
      return { kind: "unsupported", reason: "atlas_work_order_create_not_wired", receipt: {} };
    }
    try {
      const scan = await this.findWorkOrderByMarker(marker);
      if (scan.status === "cap_exhausted") {
        return { kind: "error", reason: "readback_scan_cap_exhausted", retryable: true, receipt: {} };
      }
      if (scan.matches.length === 0) return { kind: "not_found", receipt: {} };
      return {
        kind: "found",
        externalRef: String(scan.matches[0].id),
        count: scan.matches.length,
        receipt: { ids: scan.matches.map((m) => m.id) },
      };
    } catch (err) {
      if (err instanceof AtlasHttpError && (err.status === 404 || err.status === 405)) {
        return { kind: "unsupported", reason: "atlas_version_without_work_order_search", receipt: { status: err.status } };
      }
      if (err instanceof AtlasHttpError && (err.status === 401 || err.status === 403)) {
        return { kind: "error", reason: "permission_denied", retryable: false, receipt: { status: err.status } };
      }
      if (err instanceof AtlasAuthError) {
        return { kind: "error", reason: "atlas_not_configured", retryable: false, receipt: {} };
      }
      return { kind: "error", reason: "atlas_read_back_failed", retryable: true, receipt: {} };
    }
  }

  /** Pages `/work-orders/search` and filters by `marker` in `description`
   *  client-side (Atlas has no server-side text filter). Bounded by
   *  `WORK_ORDER_SEARCH_PAGE_CAP`; exhausting the cap WITHOUT reaching a
   *  short last page cannot prove absence — callers must treat that as
   *  inconclusive, never as `not_found`. */
  private async findWorkOrderByMarker(
    marker: string,
  ): Promise<{ status: "ok"; matches: Array<{ id: number }> } | { status: "cap_exhausted" }> {
    const matches: Array<{ id: number }> = [];
    for (let pageNum = 0; pageNum < WORK_ORDER_SEARCH_PAGE_CAP; pageNum++) {
      const resp = await this.workOrders!.searchWorkOrders({ pageSize: WORK_ORDER_SEARCH_PAGE_SIZE, pageNum });
      const items = resp.content ?? [];
      for (const item of items) {
        if (typeof item.description === "string" && countMarker(item.description, marker) > 0) {
          matches.push({ id: item.id });
        }
      }
      if (items.length < WORK_ORDER_SEARCH_PAGE_SIZE) return { status: "ok", matches };
    }
    return { status: "cap_exhausted" };
  }

  private foreignTargetMatrix(target: WorkOrderTarget): CmmsCapabilityMatrix {
    const cap: CmmsCapability = { support: "unsupported", reason: `target_provider_mismatch:${target.providerId}` };
    return {
      append_work_log: cap,
      read_work_log: cap,
      attach_evidence: cap,
      record_reading: cap,
      transition_work_order: cap,
      list_changes: cap,
      create_work_order: this.createWorkOrderCapability(),
    };
  }

  /** Static (not probed): creation has no existing target to probe against.
   *  `implemented` iff this provider was wired with a `workOrders` API. */
  private createWorkOrderCapability(): CmmsCapability {
    return this.workOrders
      ? { support: "implemented" }
      : { support: "unsupported", reason: "atlas_work_order_create_not_wired" };
  }

  private targetKey(target: WorkOrderTarget): string {
    return `${target.providerId}:${target.externalWorkOrderId}`;
  }

  private probeReceipt(cap: CmmsCapability): Record<string, unknown> {
    return cap.probe ? { probe: cap.probe } : {};
  }

  private async probeCapabilities(target: WorkOrderTarget): Promise<CmmsCapabilityMatrix> {
    let workLogCap: CmmsCapability;
    try {
      await this.api.countComments(target.externalWorkOrderId);
      workLogCap = { support: "implemented", probe: `${PROBE} → 200` };
    } catch (err) {
      workLogCap = this.capabilityFromProbeError(err);
    }
    this.log(`atlas write-back capability probe wo=${target.externalWorkOrderId}: ${workLogCap.support}`);

    return {
      append_work_log: workLogCap,
      read_work_log: workLogCap,
      attach_evidence: { support: "unsupported", reason: "files_license_gated_not_implemented" },
      record_reading: { support: "unsupported", reason: "not_implemented" },
      transition_work_order: { support: "unsupported", reason: "not_implemented" },
      list_changes: { support: "unsupported", reason: "not_implemented" },
      create_work_order: this.createWorkOrderCapability(),
    };
  }

  private capabilityFromProbeError(err: unknown): CmmsCapability {
    if (err instanceof AtlasHttpError) {
      if (err.status === 404 || err.status === 405) {
        return {
          support: "unsupported",
          reason: "atlas_version_without_comments",
          probe: `${PROBE} → ${err.status}`,
        };
      }
      if (err.status === 401 || err.status === 403) {
        return { support: "unknown", reason: "permission_denied", probe: `${PROBE} → ${err.status}` };
      }
      return { support: "unknown", reason: "probe_failed", probe: `${PROBE} → ${err.status}` };
    }
    if (err instanceof AtlasAuthError) {
      return { support: "unknown", reason: "atlas_not_configured" };
    }
    return { support: "unknown", reason: "probe_failed" };
  }

  private async findByMarker(target: WorkOrderTarget, marker: string): Promise<AtlasComment[]> {
    const comments = await this.api.searchComments(target.externalWorkOrderId);
    return comments.filter(
      (c) => !c.system && typeof c.content === "string" && countMarker(c.content, marker) > 0,
    );
  }

  /**
   * A failed marker lookup BEFORE create (#5027, Codex #5024 round 6 F13).
   * `createComment` has not been called on this attempt, so nothing can have
   * been written: a thrown network error is `retryable_failure`, never
   * `outcome_unknown` (which the dispatcher reconciles read-only and would
   * quarantine a fix that was never sent). HTTP and auth errors keep the
   * shared mapping.
   */
  private mapPreCreateLookupError(err: unknown): CmmsWriteResult {
    if (err instanceof AtlasAuthError || err instanceof AtlasHttpError) return this.mapWriteError(err);
    return { kind: "retryable_failure", reason: "precreate_lookup_network_error", receipt: {} };
  }

  /**
   * A failed CREATE (Codex round 4, F11). Only a response that proves Atlas
   * rejected the request before acting on it may authorize another create:
   * a 4xx other than 408. A 5xx (500/502/503/504 — a gateway can lose the
   * upstream's committed 2xx), a 408 or a thrown network error does not prove
   * the comment was NOT written, so it is `outcome_unknown` and the dispatcher
   * only ever reconciles it by read-back.
   */
  private mapCreateError(err: unknown): CmmsWriteResult {
    if (err instanceof AtlasAuthError) return this.mapWriteError(err);
    if (err instanceof AtlasHttpError && err.status >= 400 && err.status < 500 && err.status !== 408) {
      return this.mapWriteError(err);
    }
    const status = err instanceof AtlasHttpError ? err.status : undefined;
    return {
      kind: "outcome_unknown",
      reason: status !== undefined ? `create_ambiguous_http_${status}` : "timeout_or_network_after_send",
      receipt: status !== undefined ? { status } : {},
    };
  }

  private mapWriteError(err: unknown): CmmsWriteResult {
    if (err instanceof AtlasAuthError) {
      return { kind: "permission_denied", reason: "atlas_not_configured", receipt: {} };
    }
    if (err instanceof AtlasHttpError) {
      if (err.status === 401 || err.status === 403) {
        return { kind: "permission_denied", reason: "permission_denied", receipt: { status: err.status } };
      }
      if (err.status === 404) {
        return { kind: "permanent_failure", reason: "work_order_not_found", receipt: { status: err.status } };
      }
      if (err.status === 409) {
        return { kind: "conflict", reason: "atlas_conflict", receipt: { status: err.status } };
      }
      if (err.status === 429) {
        return { kind: "retryable_failure", reason: "rate_limited", receipt: { status: err.status } };
      }
      if (err.status >= 500) {
        return { kind: "retryable_failure", reason: "atlas_server_error", receipt: { status: err.status } };
      }
      return { kind: "retryable_failure", reason: "atlas_http_error", receipt: { status: err.status } };
    }
    // A thrown non-HTTP error (TypeError "fetch failed", AbortError/TimeoutError) —
    // the request may have landed; the caller reconciles via read-back next time.
    return { kind: "outcome_unknown", reason: "timeout_or_network_after_send", receipt: {} };
  }
}
