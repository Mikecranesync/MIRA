// Knowledge graph type registry.
//
// `entity_type` and `relationship_type` are TEXT columns in Postgres so we can
// add new categories without DDL. The allowlists below are the runtime gate:
// inserts that go through the typed helpers must use a registered type, which
// keeps the graph from accumulating typos and one-off categories.
//
// See docs/specs/knowledge-graph-multi-hop-spec.md §4.2 / §4.3.

export const ENTITY_TYPES = [
  // Existing (#791 / #793)
  "equipment",
  "equipment_tag",
  "work_order",
  "manual",
  "fault_code",
  "part",
  // Multi-hop additions (#806)
  "plant",
  "area",
  "line",
  "component",
  "resolution",
  "technician",
  "pm_task",
  // Phase 5 — schematic intelligence
  "electrical_component",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  // Existing
  "mentioned_tag",
  "exhibited_fault",
  "requires_part",
  "has_work_order",
  "has_pm",
  "located_at",
  // Multi-hop additions (#806)
  "parent_of",
  "has_component",
  "feeds",
  "caused_by",
  "resolved_by",
  "triggered_pm",
  "maintained_by",
  "had_fault",
  "similar_to",
  // Phase 5 — schematic intelligence
  "electrically_connected",
  "controls",
  "protects",
  "references_drawing",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function isEntityType(t: string): t is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t);
}

export function isRelationshipType(t: string): t is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(t);
}

export interface KGEntity {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  name: string;
  properties: Record<string, unknown>;
  unsPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGRelationship {
  id: string;
  tenantId: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  properties: Record<string, unknown>;
  confidence: number;
  sourceConversationId: string | null;
  createdAt: Date;
}

export interface KGTriple {
  id: string;
  tenantId: string;
  conversationId: string | null;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  extractedAt: Date;
}

// Hierarchy node returned by traversal helpers + the kg_asset_hierarchy view.
export interface HierarchyNode {
  tenantId: string;
  rootId: string;
  descendantId: string;
  depth: number;
  path: string[];
}
