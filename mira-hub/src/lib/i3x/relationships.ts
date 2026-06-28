import type { ObjectInstanceResponse, RelationshipType, RelatedObjectResult } from "@/lib/i3x/types";
import { MIRA_TYPE_NAMESPACE_URI } from "@/lib/i3x/objects";

/**
 * Relationship vocabulary + bidirectional traversal (architecture doc §7, gap G3).
 *
 * i3X requires every RelationshipType to declare a `reverseOf` and requires
 * relationships to be queryable in both directions. MIRA stores a single
 * directed edge (kg_relationships.relationship_type, Hub migration 001); we
 * SYNTHESIZE the reverse at the projection layer rather than doubling stored
 * edges. The registry below is the canonical forward↔reverse map.
 */

/** Canonical forward → reverse pairs. Both directions are registered below. */
const CANONICAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["has_component", "component_of"],
  ["has_parent", "has_child"],
  ["controlled_by", "controls"],
  ["drives", "driven_by"],
  ["monitors", "monitored_by"],
  ["alarm_for", "has_alarm"],
  ["instance_of", "has_instance"],
  ["feeds", "fed_by"],
  ["causes_fault", "caused_by"],
];

const REVERSE_OF = new Map<string, string>();
for (const [a, b] of CANONICAL_PAIRS) {
  REVERSE_OF.set(a, b);
  REVERSE_OF.set(b, a);
}

/** Prefix used to synthesize a deterministic, round-tripping inverse name. */
const SYNTH_PREFIX = "inverse__";

/** The inverse of a relationship type. Deterministic + round-tripping for unknowns. */
export function reverseOf(type: string): string {
  const known = REVERSE_OF.get(type);
  if (known) return known;
  if (type.startsWith(SYNTH_PREFIX)) return type.slice(SYNTH_PREFIX.length);
  return `${SYNTH_PREFIX}${type}`;
}

/** Project a MIRA relationship_type to an i3X RelationshipType. */
export function relationshipType(type: string): RelationshipType {
  return {
    elementId: `mira:rel:${type}`,
    displayName: type,
    namespaceUri: MIRA_TYPE_NAMESPACE_URI,
    relationshipId: type,
    reverseOf: `mira:rel:${reverseOf(type)}`,
  };
}

/** The canonical relationship-type registry as i3X RelationshipTypes (both directions). */
export function listRelationshipTypes(): RelationshipType[] {
  const types = new Set<string>();
  for (const [a, b] of CANONICAL_PAIRS) {
    types.add(a);
    types.add(b);
  }
  return [...types].map(relationshipType);
}

/** A MIRA kg_relationship row (Hub migration 001 + 029 approval_state). */
export interface KgRelationship {
  source_id: string;
  target_id: string;
  relationship_type: string;
  approval_state?: string | null;
}

/**
 * Resolve a stored directed edge into an i3X RelatedObjectResult *as seen from*
 * `queryElementId`. From the source node the forward relationship points at the
 * target; from the target node the reverse relationship points back at the
 * source. Returns null if the query id isn't on the edge or the other object
 * can't be resolved.
 */
export function relatedFromEdge(
  edge: KgRelationship,
  queryElementId: string,
  objectsById: Map<string, ObjectInstanceResponse>,
): RelatedObjectResult | null {
  let otherId: string;
  let relationship: string;
  if (queryElementId === edge.source_id) {
    otherId = edge.target_id;
    relationship = edge.relationship_type;
  } else if (queryElementId === edge.target_id) {
    otherId = edge.source_id;
    relationship = reverseOf(edge.relationship_type);
  } else {
    return null;
  }

  const object = objectsById.get(otherId);
  if (!object) return null;

  return { sourceRelationship: relationship, object };
}
