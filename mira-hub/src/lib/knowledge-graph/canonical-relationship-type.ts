// src/lib/knowledge-graph/canonical-relationship-type.ts
/**
 * Read-time relationship-type canonicalizer for DISPLAY/aggregation only.
 *
 * The hub has two relationship-type vocabularies in flight at once:
 *   - `kg_relationships` (verified edges) mostly carries the UPPERCASE
 *     canonical vocabulary (see `proposals-writer.ts`
 *     CANONICAL_PROPOSAL_RELATIONSHIP_TYPES).
 *   - `relationship_proposals` / LLM-extractor / CMMS-sync writers still
 *     produce the older lowercase vocabulary in places (`types.ts`
 *     RELATIONSHIP_TYPES).
 *
 * When a display surface (e.g. the /graph force-graph payload) mixes rows
 * from both, the same real relationship can show up under two different
 * type strings (`has_component` vs `HAS_COMPONENT`). This function folds a
 * raw type string to its canonical display label so a read-time consumer can
 * group/color/legend by type without caring which writer produced the row.
 *
 * Pure, no IO. Authority for the mapping (keep in lockstep with both):
 *   - mira-hub/src/lib/knowledge-graph/proposals-writer.ts:19-40
 *     (CANONICAL_PROPOSAL_RELATIONSHIP_TYPES) and :59-84
 *     (LOWERCASE_TO_CANONICAL_EDGE)
 *   - mira-crawler/ingest/proposal_writer.py:68-75 (_CANONICAL_RELATION_TYPE)
 *
 * Scope: THIS FILE IS DISPLAY-LAYER ONLY. It must never be imported by a
 * write path, a proposal-decision path, or the i3x layer — those paths have
 * their own canonicalization (`mapToCanonicalEdge` / `canonical_relation_type`)
 * which also handles edge *direction* flips (see below).
 */

/**
 * `parent_of` is deliberately NOT mapped here. Its canonical fold in
 * `proposals-writer.ts` (`{ type: "LOCATED_IN", flip: true }`) requires
 * swapping source/target — a type-only string function cannot express that
 * without silently producing a backwards edge. Leave it as a passthrough;
 * only the write-path `mapToCanonicalEdge` (which returns source/target
 * flip info alongside the type) may fold it.
 *
 * `CONTROLS` is out-of-vocabulary (proposals-writer.ts:83 — "no clean
 * canonical equivalent yet"). It passes through unchanged until a vocabulary
 * decision adds it to the CHECK constraint.
 */
const LOWERCASE_TO_CANONICAL_DISPLAY_TYPE: Record<string, string> = {
  has_component: "HAS_COMPONENT",
  located_at: "LOCATED_IN",
  has_manual: "HAS_DOCUMENT",
  documented_in: "HAS_DOCUMENT",
  has_fault_code: "HAS_FAILURE_MODE",
  has_work_order: "HAS_WORK_ORDER",
  instance_of: "INSTANCE_OF",
};

/**
 * Fold a raw relationship-type string to its canonical display label.
 * - Known lowercase types map to their UPPERCASE canonical form.
 * - Already-canonical UPPERCASE types (and any other unrecognized value,
 *   e.g. `CONTROLS`) pass through unchanged — display-safe, never throws.
 */
export function canonicalizeRelationshipType(raw: string): string {
  return LOWERCASE_TO_CANONICAL_DISPLAY_TYPE[raw] ?? raw;
}
