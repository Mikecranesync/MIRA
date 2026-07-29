// HubV3 Phase 4 — approval gate decision logic + SQL builders.
//
// Hub owns truth. Imported (offline/telegram/hub_upload) proposals land as
// `proposed`. A human approval — and ONLY a human approval — publishes them
// (proposed → verified). Nothing here ever auto-promotes (ADR-0017; KG Iron
// Rule: "MIRA proposes, the human verifies").
//
// The pure functions below are the single source of decision truth, shared by
// the promote route (import-time staging) and the batch-review route
// (approval-time publish). The SQL builders carry the no-overwrite guard at the
// DB layer so verified/deprecated rows are untouchable even under a race.

/** kg_entities.approval_state CHECK (migration 029). */
export type EntityApprovalState =
  | "proposed"
  | "verified"
  | "rejected"
  | "needs_review"
  | "deprecated";

/** ctx_import_batches.review_status CHECK (migration 056). */
export type BatchReviewStatus = "proposed" | "approved" | "rejected" | "needs_review";

/** What a human can decide about a staged import batch. */
export type ReviewDecision = "approve" | "reject" | "needs_review";

const REVIEW_DECISIONS: ReadonlySet<string> = new Set([
  "approve",
  "reject",
  "needs_review",
]);

/** Validate a request body's `decision` field. Returns the decision or null. */
export function parseReviewDecision(value: unknown): ReviewDecision | null {
  return typeof value === "string" && REVIEW_DECISIONS.has(value)
    ? (value as ReviewDecision)
    : null;
}

/** Everything imported lands here. Never `verified` at import time. */
export const IMPORT_APPROVAL_STATE: EntityApprovalState = "proposed";

/** The published state — only a human approval writes this. */
export const PUBLISHED_APPROVAL_STATE: EntityApprovalState = "verified";

/** Approved Hub data that import/publish must never overwrite. */
const PROTECTED_STATES: ReadonlySet<EntityApprovalState> = new Set([
  "verified",
  "deprecated",
]);

export interface PromotionDecision {
  action: "insert" | "skip";
  /** present when action === "insert" */
  approvalState?: EntityApprovalState;
  /** present when action === "skip" */
  reason?: string;
  /** true when the skip is because the existing row is approved/protected */
  protectedRow?: boolean;
}

/**
 * Import-time staging decision. Stages a proposed entity when absent; refuses
 * to overwrite approved (verified/deprecated) data; leaves other staged states
 * untouched (idempotent re-import).
 */
export function decidePromotion(
  existing: { approval_state: EntityApprovalState } | null,
): PromotionDecision {
  if (!existing) {
    return { action: "insert", approvalState: IMPORT_APPROVAL_STATE };
  }
  if (PROTECTED_STATES.has(existing.approval_state)) {
    return {
      action: "skip",
      protectedRow: true,
      reason: `entity already ${existing.approval_state} — import will not overwrite approved data`,
    };
  }
  return {
    action: "skip",
    protectedRow: false,
    reason: `entity already staged (${existing.approval_state}) — left unchanged`,
  };
}

export interface PublishDecision {
  action: "insert" | "update" | "skip";
  reason?: string;
}

/**
 * Approval-time publish decision (runs inside the human approve action).
 * - absent           → insert directly as verified (the approval IS the verification)
 * - proposed/needs_review → update to verified
 * - verified         → skip (idempotent re-approve)
 * - rejected/deprecated   → skip (a human already declined/retired it)
 */
export function decidePublish(
  existing: { approval_state: EntityApprovalState } | null,
): PublishDecision {
  if (!existing) return { action: "insert" };
  switch (existing.approval_state) {
    case "proposed":
    case "needs_review":
      return { action: "update" };
    case "verified":
      return { action: "skip", reason: "already verified" };
    case "rejected":
      return { action: "skip", reason: "previously rejected by a human" };
    case "deprecated":
      return { action: "skip", reason: "deprecated" };
  }
}

export interface BatchReviewOutcome {
  status: BatchReviewStatus;
  publish: boolean;
}

/**
 * Maps a human review decision to the batch's new review_status and whether it
 * triggers publishing. Only `approve` publishes — never auto.
 */
export function decideBatchReview(
  _current: BatchReviewStatus,
  decision: ReviewDecision,
): BatchReviewOutcome {
  switch (decision) {
    case "approve":
      return { status: "approved", publish: true };
    case "reject":
      return { status: "rejected", publish: false };
    case "needs_review":
      return { status: "needs_review", publish: false };
  }
}

// ─── SQL builders ───────────────────────────────────────────────────────────
// Kept pure (return {text, values}) so the no-overwrite guard and the correct
// conflict target are unit-testable without a live DB.

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

export interface EntityInsertParams {
  tenantId: string;
  name: string; // tag_name — the live natural key (tenant_id, entity_type, name)
  unsPath: string;
  ltreePath: string;
  propertiesJson: string;
  approvalState: EntityApprovalState;
}

/**
 * INSERT a signal entity. Conflict target is the LIVE natural key
 * (tenant_id, entity_type, name) — migration 026 dropped the old
 * (tenant_id, entity_type, entity_id) unique, so the spine's entity_id-based
 * ON CONFLICT referenced a non-existent constraint (latent runtime error).
 */
export function buildEntityInsert(p: EntityInsertParams): BuiltQuery {
  return {
    text: `INSERT INTO kg_entities
             (tenant_id, entity_type, entity_id, name, properties,
              approval_state, uns_path)
           VALUES ($1::uuid, 'signal', $2, $3, $4::jsonb, $5, $6::ltree)
           ON CONFLICT (tenant_id, entity_type, name) DO NOTHING
           RETURNING id`,
    values: [
      p.tenantId,
      p.unsPath,
      p.name,
      p.propertiesJson,
      p.approvalState,
      p.ltreePath,
    ],
  };
}

export interface PublishEntityUpdateParams {
  tenantId: string;
  name: string;
  propertiesJson: string;
}

/**
 * Publish (proposed → verified) a previously-staged signal entity. The WHERE
 * guard is the real no-overwrite enforcement: verified/deprecated rows are
 * untouchable at the DB layer. Returns 0 rows when the row is protected or
 * absent (caller falls back to an insert when truly absent).
 */
export function buildPublishEntityUpdate(p: PublishEntityUpdateParams): BuiltQuery {
  return {
    text: `UPDATE kg_entities
              SET approval_state = 'verified',
                  properties = properties || $3::jsonb,
                  updated_at = now()
            WHERE tenant_id = $1::uuid
              AND entity_type = 'signal'
              AND name = $2
              AND approval_state NOT IN ('verified', 'deprecated')
          RETURNING id`,
    values: [p.tenantId, p.name, p.propertiesJson],
  };
}
