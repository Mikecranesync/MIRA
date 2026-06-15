import type { ObjectInstanceResponse } from "@/lib/i3x/types";

/**
 * Project a MIRA kg_entity onto an i3X ObjectInstance.
 *
 * elementId = the kg UUID (persistent), NOT the UNS path — UNS paths mutate on
 * site reassignment (INSTANCE_OF relink); see strategy doc §8.1. The UNS path is
 * carried as human-readable context in metadata.system.
 */

/** Namespace URI for MIRA's own type vocabulary (architecture doc §9, gap G2). */
export const MIRA_TYPE_NAMESPACE_URI = "https://factorylm.com/i3x/mira/v1";

/**
 * MIRA entity_types that contain children (i3X composition / can be a parentId
 * target with isComposition:true). Everything else is a leaf.
 */
const COMPOSITION_ENTITY_TYPES = new Set([
  "enterprise",
  "site",
  "area",
  "line",
  "work_cell",
  "equipment",
  "asset",
  "component",
]);

/** Normalize a free-form entity_type into an ltree-style label (mirrors uns.slug). */
function slugType(entityType: string): string {
  return (entityType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Stable, namespaced i3X ObjectType elementId for a MIRA entity_type. */
export function objectTypeElementId(entityType: string): string {
  return `mira:type:${slugType(entityType)}`;
}

/** A MIRA kg_entity row (Hub migration 001 + 029 approval_state). */
export interface KgEntity {
  id: string;
  entity_type: string;
  name: string;
  approval_state?: string | null;
  parent_id?: string | null;
  uns_path?: string | null;
  properties?: Record<string, unknown> | null;
}

export function kgEntityToObjectInstance(entity: KgEntity): ObjectInstanceResponse {
  const description =
    typeof entity.properties?.description === "string"
      ? (entity.properties.description as string)
      : null;

  return {
    elementId: entity.id,
    displayName: entity.name,
    typeElementId: objectTypeElementId(entity.entity_type),
    parentId: entity.parent_id ?? null,
    isComposition: COMPOSITION_ENTITY_TYPES.has(slugType(entity.entity_type)),
    isExtended: false,
    metadata: {
      typeNamespaceUri: MIRA_TYPE_NAMESPACE_URI,
      sourceTypeId: entity.entity_type,
      description,
      system: { uns_path: entity.uns_path ?? null },
    },
  };
}
