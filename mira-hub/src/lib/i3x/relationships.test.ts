import { describe, expect, it } from "vitest";
import {
  reverseOf,
  relationshipType,
  listRelationshipTypes,
  relatedFromEdge,
  type KgRelationship,
} from "@/lib/i3x/relationships";
import type { ObjectInstanceResponse } from "@/lib/i3x/types";

describe("reverseOf — every relationship type has an inverse (i3X MUST)", () => {
  it("knows the canonical maintenance pairs both ways", () => {
    expect(reverseOf("has_component")).toBe("component_of");
    expect(reverseOf("component_of")).toBe("has_component");
    expect(reverseOf("controlled_by")).toBe("controls");
    expect(reverseOf("drives")).toBe("driven_by");
    expect(reverseOf("monitors")).toBe("monitored_by");
    expect(reverseOf("alarm_for")).toBe("has_alarm");
    expect(reverseOf("instance_of")).toBe("has_instance");
  });

  it("synthesizes a deterministic inverse for an unknown type that round-trips", () => {
    const inv = reverseOf("custom_rel");
    expect(inv).not.toBe("custom_rel");
    expect(reverseOf(inv)).toBe("custom_rel");
  });
});

describe("relationshipType — i3X RelationshipType projection", () => {
  it("emits a namespaced elementId and a non-empty reverseOf", () => {
    const rt = relationshipType("has_component");
    expect(rt.elementId).toBe("mira:rel:has_component");
    expect(rt.reverseOf).toBe("mira:rel:component_of");
    expect(rt.namespaceUri).toBeTruthy();
    expect(rt.relationshipId).toBe("has_component");
  });

  it("listRelationshipTypes gives every type a reverseOf (i3X MUST)", () => {
    const all = listRelationshipTypes();
    expect(all.length).toBeGreaterThan(0);
    for (const rt of all) {
      expect(rt.reverseOf).toBeTruthy();
      expect(rt.reverseOf).not.toBe(rt.elementId); // no self-inverse in the registry
    }
  });
});

describe("relatedFromEdge — bidirectional traversal (i3X MUST: stored both ways)", () => {
  const motor: ObjectInstanceResponse = {
    elementId: "motor", displayName: "Motor", typeElementId: "mira:type:component",
    parentId: null, isComposition: false, isExtended: false,
  };
  const conveyor: ObjectInstanceResponse = {
    elementId: "conveyor", displayName: "Conveyor", typeElementId: "mira:type:equipment",
    parentId: null, isComposition: true, isExtended: false,
  };
  const byId = new Map([["motor", motor], ["conveyor", conveyor]]);
  // Stored edge: conveyor has_component motor
  const edge: KgRelationship = {
    source_id: "conveyor", target_id: "motor", relationship_type: "has_component", approval_state: "verified",
  };

  it("from the source node, returns the target via the forward relationship", () => {
    const r = relatedFromEdge(edge, "conveyor", byId);
    expect(r).not.toBeNull();
    expect(r!.sourceRelationship).toBe("has_component");
    expect(r!.object.elementId).toBe("motor");
  });

  it("from the target node, returns the source via the REVERSE relationship", () => {
    const r = relatedFromEdge(edge, "motor", byId);
    expect(r).not.toBeNull();
    expect(r!.sourceRelationship).toBe("component_of");
    expect(r!.object.elementId).toBe("conveyor");
  });

  it("returns null when the query id is not part of the edge", () => {
    expect(relatedFromEdge(edge, "somethingelse", byId)).toBeNull();
  });

  it("returns null when the other object is not resolvable", () => {
    const onlyMotor = new Map([["motor", motor]]);
    expect(relatedFromEdge(edge, "motor", onlyMotor)).toBeNull();
  });
});
