// Asset-agent lifecycle transitions.
//
// The single place lifecycle state changes are validated. Per
// docs/specs/asset-agent-validation-spec.md §6 and .claude/CLAUDE.md
// (ADR-0017 pattern), routes MUST NOT run raw `UPDATE … SET state` — they go
// through `transitionAssetAgent`, which validates the move before writing.
//
// Invariant (spec §4): promotion to `approved` is ALWAYS a human action. A
// transition into `approved` without an actor is rejected here, not at the DB.

import type { PoolClient } from "pg";

export const ASSET_AGENT_STATES = [
  "draft",
  "training",
  "validating",
  "approved",
  "deployed",
  "rejected",
  "deprecated",
] as const;

export type AssetAgentState = (typeof ASSET_AGENT_STATES)[number];

// Forward lifecycle edges. `rejected` and `deprecated` are reachable from any
// active state (admin pull / asset retirement) and are handled separately so
// the map stays about the happy path.
const FORWARD: Record<AssetAgentState, AssetAgentState[]> = {
  draft: ["training"],
  training: ["validating"],
  validating: ["approved"],
  approved: ["deployed"],
  deployed: [],
  rejected: [],
  deprecated: [],
};

// Admin/system transitions allowed from any state that isn't already terminal.
const ACTIVE_STATES: AssetAgentState[] = [
  "draft",
  "training",
  "validating",
  "approved",
  "deployed",
];

// §5 approval thresholds (spec defaults; configurable per tenant later).
export const MIN_VALIDATION_QUESTIONS = 5;
export const MIN_GROUNDEDNESS = 4;

export interface ApprovalSignals {
  citationCoverage: number; // # validation Q with verdict='good' AND ≥1 citation
  minGroundedness: number | null; // lowest groundedness across the good answers
  openSafetyCritical?: number; // pending safety_critical ai_suggestions on the asset
}

/**
 * The spec §5 gate for advancing an asset agent to `approved`. Pure.
 * Returns the decision plus the specific reasons it isn't met (for the UI).
 */
export function meetsApprovalCriteria(s: ApprovalSignals): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (s.citationCoverage < MIN_VALIDATION_QUESTIONS) {
    reasons.push(
      `need ≥${MIN_VALIDATION_QUESTIONS} good, cited answers (have ${s.citationCoverage})`,
    );
  }
  if (s.minGroundedness == null || s.minGroundedness < MIN_GROUNDEDNESS) {
    reasons.push(`every approved answer needs groundedness ≥${MIN_GROUNDEDNESS}`);
  }
  if ((s.openSafetyCritical ?? 0) > 0) {
    reasons.push("resolve open safety-critical proposals first");
  }
  return { ok: reasons.length === 0, reasons };
}

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal asset-agent transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class MissingActorError extends Error {
  constructor(to: string) {
    super(`Transition to '${to}' requires a human actor (approvedBy)`);
    this.name = "MissingActorError";
  }
}

function isState(s: string): s is AssetAgentState {
  return (ASSET_AGENT_STATES as readonly string[]).includes(s);
}

export interface TransitionActor {
  approvedBy?: string;
}

/**
 * Validate a lifecycle transition. Throws IllegalTransitionError for a move
 * that isn't allowed, or MissingActorError when entering `approved` without a
 * non-blank actor. Pure — no side effects.
 */
export function validateTransition(
  from: string,
  to: string,
  actor: TransitionActor = {},
): void {
  if (!isState(from) || !isState(to)) {
    throw new IllegalTransitionError(from, to);
  }

  const allowed =
    FORWARD[from].includes(to) ||
    // admin pull / retirement from any active state
    ((to === "rejected" || to === "deprecated") && ACTIVE_STATES.includes(from));

  if (!allowed) {
    throw new IllegalTransitionError(from, to);
  }

  if (to === "approved" && !actor.approvedBy?.trim()) {
    throw new MissingActorError(to);
  }
}

export interface TransitionResult {
  id: string;
  equipment_id: string;
  state: AssetAgentState;
  approved_by: string | null;
  approved_at: string | null;
  deployed_at: string | null;
  deployed_by: string | null;
  deploy_surface: string | null;
  updated_at: string;
}

/**
 * Validate + apply a lifecycle transition for one asset's agent row, inside an
 * already-tenant-scoped client (use via withTenantContext). Reads the current
 * state, validates the move, then writes the new state and the relevant
 * actor/timestamp columns. Returns the updated row, or null if no row exists
 * for (tenant, equipment).
 *
 * `actor.approvedBy` is the human identity ('human:user_<uuid>'); required to
 * enter `approved`, recorded as deployer when entering `deployed`.
 */
export async function transitionAssetAgent(
  client: PoolClient,
  args: {
    equipmentId: string;
    to: AssetAgentState;
    approvedBy?: string;
    deploySurface?: string;
  },
): Promise<TransitionResult | null> {
  const { rows } = await client.query<{ state: string }>(
    `SELECT state FROM asset_agent_status WHERE equipment_id = $1 FOR UPDATE`,
    [args.equipmentId],
  );
  if (rows.length === 0) return null;

  validateTransition(rows[0].state, args.to, { approvedBy: args.approvedBy });

  const sets: string[] = ["state = $2", "updated_at = now()"];
  const params: unknown[] = [args.equipmentId, args.to];

  if (args.to === "approved") {
    params.push(args.approvedBy);
    sets.push(`approved_by = $${params.length}`, "approved_at = now()");
  }
  if (args.to === "deployed") {
    params.push(args.approvedBy ?? null);
    sets.push(`deployed_by = $${params.length}`, "deployed_at = now()");
    if (args.deploySurface) {
      params.push(args.deploySurface);
      sets.push(`deploy_surface = $${params.length}`);
    }
  }

  const { rows: updated } = await client.query<TransitionResult>(
    `UPDATE asset_agent_status SET ${sets.join(", ")}
     WHERE equipment_id = $1
     RETURNING id, equipment_id, state, approved_by, approved_at,
               deployed_at, deployed_by, deploy_surface, updated_at`,
    params,
  );
  return updated[0];
}
