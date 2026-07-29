import { describe, expect, it } from "vitest";
import { listObjectTypes } from "@/lib/i3x/object-types";
import { MIRA_TYPE_NAMESPACE_URI, objectTypeElementId } from "@/lib/i3x";

describe("listObjectTypes", () => {
  it("includes core types each with a JSON Schema + namespace (i3X MUST)", () => {
    const types = listObjectTypes();
    const ids = types.map((t) => t.elementId);
    expect(ids).toContain(objectTypeElementId("equipment"));
    expect(ids).toContain(objectTypeElementId("component"));
    expect(ids).toContain(objectTypeElementId("datapoint"));
    for (const t of types) {
      expect(t.namespaceUri).toBe(MIRA_TYPE_NAMESPACE_URI);
      expect(t.schema).toBeTruthy();
      expect(t.schema.type).toBe("object"); // a real JSON Schema
    }
  });
});
