/**
 * Health-score calculator — pure function for L0-L6 namespace readiness.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Readiness levels"
 * Migration: db/migrations/021_namespace_builder.sql (health_scores)
 *
 * No DB, no fetch, no env reads — just (counts) → (level + next step).
 * Recomputable end-to-end from the same input. Unit-testable in vitest.
 *
 * Levels (per spec):
 *   L0  Empty namespace.
 *   L1  Company + at least one site declared.
 *   L2  At least one production line with at least one asset.
 *   L3  At least one component template attached to an asset.
 *   L4  At least one PLC tag or manual chunk grounded to a component.
 *   L5  Proposals queue active (LLM proposing, humans verifying).
 *   L6  Production-ready — verified > proposed and a recent recompute.
 */

export type ReadinessLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface HealthScoreCounts {
  /** Sites declared (kg_entities where kind='site' OR uns_path matches '*.sites.*'). */
  sites: number;
  /** Production lines declared. */
  lines: number;
  /** Asset rows (cmms_equipment or kg_entities kind='asset'). */
  assets: number;
  /** Component templates attached to at least one asset. */
  components: number;
  /** Documents (manuals, photos, tag lists) with at least one chunk. */
  docs: number;
  /** Proposals in `proposed` state on relationship_proposals. */
  proposalsPending: number;
  /** Proposals in `verified` state on relationship_proposals. */
  proposalsVerified: number;
  /** Distinct uns_paths populated on kg_entities. */
  unsPaths: number;
  /** Whether the onboarding wizard reached `completed`. */
  wizardCompleted: boolean;
}

export interface HealthScoreResult {
  level: ReadinessLevel;
  /** Display label, e.g. "L3 — Components attached". */
  levelName: string;
  /** Short next-step hint surfaced on the widget. */
  nextStep: string;
}

/**
 * Empty counts — for the "fresh tenant" path. Exported for tests and for the
 * API route to default to when the tenant has no data at all.
 */
export const EMPTY_COUNTS: HealthScoreCounts = {
  sites: 0,
  lines: 0,
  assets: 0,
  components: 0,
  docs: 0,
  proposalsPending: 0,
  proposalsVerified: 0,
  unsPaths: 0,
  wizardCompleted: false,
};

const LEVEL_NAMES: Record<ReadinessLevel, string> = {
  0: "L0 — Empty namespace",
  1: "L1 — Site declared",
  2: "L2 — Line + asset",
  3: "L3 — Components attached",
  4: "L4 — Grounded to data",
  5: "L5 — Proposal flywheel",
  6: "L6 — Production ready",
};

const NEXT_STEP: Record<ReadinessLevel, string> = {
  0: "Run the onboarding wizard to declare your first site.",
  1: "Add a production line with at least one asset.",
  2: "Attach component templates so MIRA can map fault codes.",
  3: "Upload a manual or PLC tag list to ground the components.",
  4: "Confirm proposals as they arrive — turn LLM guesses into verified edges.",
  5: "Keep verifying — once verified outnumber proposed you cross L6.",
  6: "Maintain: verify new proposals weekly and re-run the readiness scan after schema edits.",
};

export function computeHealthScore(
  rawCounts: Partial<HealthScoreCounts> = {},
): HealthScoreResult {
  const counts: HealthScoreCounts = { ...EMPTY_COUNTS, ...rawCounts };
  const level = pickLevel(counts);
  return {
    level,
    levelName: LEVEL_NAMES[level],
    nextStep: NEXT_STEP[level],
  };
}

function pickLevel(c: HealthScoreCounts): ReadinessLevel {
  // L6: verified outnumbers proposed AND the flywheel is running.
  if (
    c.proposalsVerified > c.proposalsPending &&
    c.proposalsVerified >= 10 &&
    c.components >= 5 &&
    c.docs >= 1
  ) {
    return 6;
  }
  // L5: proposals are flowing and at least one has been verified.
  if (c.proposalsPending >= 1 && c.proposalsVerified >= 1) {
    return 5;
  }
  // L4: components are grounded to real data — manuals or PLC tags.
  if (c.components >= 1 && c.docs >= 1) {
    return 4;
  }
  // L3: at least one component template attached.
  if (c.components >= 1 && c.assets >= 1) {
    return 3;
  }
  // L2: a production line with at least one asset on it.
  if (c.lines >= 1 && c.assets >= 1) {
    return 2;
  }
  // L1: company + site declared (wizard step 1 done, OR a manually-added site row).
  if (c.sites >= 1 || c.wizardCompleted) {
    return 1;
  }
  return 0;
}
