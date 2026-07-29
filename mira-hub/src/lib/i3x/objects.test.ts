import { describe, expect, it } from "vitest";
import {
  MIRA_TYPE_NAMESPACE_URI,
  objectTypeElementId,
  kgEntityToObjectInstance,
  type KgEntity,
} from "@/lib/i3x/objects";

const equipment: KgEntity = {
  id: "11111111-1111-1111-1111-111111111111",
  entity_type: "equipment",
  name: "Conveyor CV-101",
  approval_state: "verified",
  parent_id: "00000000-0000-0000-0000-0000000000aa",
  uns_path: "enterprise.acme.site.s1.area.a1.equipment.cv101",
  properties: { description: "Main packaging conveyor" },
};

describe("objectTypeElementId", () => {
  it("derives a stable namespaced type id from a MIRA entity_type", () => {
    expect(objectTypeElementId("equipment")).toBe("mira:type:equipment");
    expect(objectTypeElementId("fault_code")).toBe("mira:type:fault_code");
  });

  it("slugs/normalizes unexpected casing or spacing", () => {
    expect(objectTypeElementId("Fault Code")).toBe("mira:type:fault_code");
  });
});

describe("kgEntityToObjectInstance", () => {
  it("uses the kg UUID as elementId (not the UNS path) — §8.1", () => {
    expect(kgEntityToObjectInstance(equipment).elementId).toBe(equipment.id);
  });

  it("carries the UNS path as displayName context, not as the id", () => {
    const obj = kgEntityToObjectInstance(equipment);
    expect(obj.displayName).toBe("Conveyor CV-101");
    expect(obj.metadata?.system).toMatchObject({ uns_path: equipment.uns_path });
  });

  it("points typeElementId at the derived object type", () => {
    expect(kgEntityToObjectInstance(equipment).typeElementId).toBe("mira:type:equipment");
  });

  it("preserves parentId for the containment chain", () => {
    expect(kgEntityToObjectInstance(equipment).parentId).toBe(equipment.parent_id);
  });

  it("marks containers (equipment) as composition", () => {
    expect(kgEntityToObjectInstance(equipment).isComposition).toBe(true);
  });

  it("marks leaf signals (datapoint) as non-composition", () => {
    const dp = kgEntityToObjectInstance({ ...equipment, entity_type: "datapoint", name: "motor_current" });
    expect(dp.isComposition).toBe(false);
  });

  it("never declares isExtended on a plain projection", () => {
    expect(kgEntityToObjectInstance(equipment).isExtended).toBe(false);
  });

  it("puts entity_type + namespace + description in metadata", () => {
    const obj = kgEntityToObjectInstance(equipment);
    expect(obj.metadata?.sourceTypeId).toBe("equipment");
    expect(obj.metadata?.typeNamespaceUri).toBe(MIRA_TYPE_NAMESPACE_URI);
    expect(obj.metadata?.description).toBe("Main packaging conveyor");
  });

  it("nulls a missing parentId and description rather than inventing them", () => {
    const root = kgEntityToObjectInstance({
      id: "22222222-2222-2222-2222-222222222222",
      entity_type: "site",
      name: "Site 1",
      approval_state: "verified",
    });
    expect(root.parentId).toBeNull();
    expect(root.metadata?.description).toBeNull();
  });
});
