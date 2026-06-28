import type { ObjectTypeResponse } from "@/lib/i3x";
import { MIRA_TYPE_NAMESPACE_URI, objectTypeElementId } from "@/lib/i3x";

/** Minimal core object types with hand-authored JSON Schemas (gap G1, MVP slice). */
const CORE_TYPES: ReadonlyArray<{ type: string; display: string; schema: Record<string, unknown> }> = [
  { type: "equipment", display: "Equipment",
    schema: { type: "object", properties: { name: { type: "string" }, uns_path: { type: "string" } } } },
  { type: "component", display: "Component",
    schema: { type: "object", properties: { name: { type: "string" }, uns_path: { type: "string" } } } },
  { type: "datapoint", display: "Datapoint (live signal)",
    schema: { type: "object", properties: { value: {}, quality: { type: "string" }, timestamp: { type: "string" } } } },
  { type: "fault_code", display: "Fault Code",
    schema: { type: "object", properties: { code: { type: "string" }, description: { type: "string" } } } },
];

export function listObjectTypes(): ObjectTypeResponse[] {
  return CORE_TYPES.map((t) => ({
    elementId: objectTypeElementId(t.type),
    displayName: t.display,
    namespaceUri: MIRA_TYPE_NAMESPACE_URI,
    sourceTypeId: t.type,
    schema: t.schema,
  }));
}
