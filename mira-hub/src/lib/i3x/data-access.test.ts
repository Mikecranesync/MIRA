import { describe, expect, it } from "vitest";
import { parentUnsPath, loadEntitiesByIds } from "@/lib/i3x/data-access";

describe("parentUnsPath", () => {
  it("drops the last ltree segment", () => {
    expect(parentUnsPath("enterprise.acme.site.s1.area.a1.equipment.cv101")).toBe(
      "enterprise.acme.site.s1.area.a1.equipment",
    );
  });
  it("returns null for a single-segment or empty path", () => {
    expect(parentUnsPath("enterprise")).toBeNull();
    expect(parentUnsPath("")).toBeNull();
    expect(parentUnsPath(null)).toBeNull();
  });
});

describe("loadEntitiesByIds", () => {
  it("returns ONLY verified entities, with parent_id resolved from ancestry", async () => {
    const fakeRows = [
      { id: "child", entity_type: "equipment", name: "CV-101", approval_state: "verified",
        uns_path: "enterprise.acme.equipment.cv101", properties: {} },
      { id: "hidden", entity_type: "equipment", name: "Secret", approval_state: "proposed",
        uns_path: "enterprise.acme.equipment.secret", properties: {} },
      { id: "parent", entity_type: "area", name: "Area", approval_state: "verified",
        uns_path: "enterprise.acme.equipment", properties: {} },
    ];
    const client = {
      query: async () => ({ rows: fakeRows }),
    };
    const out = await loadEntitiesByIds(client, ["child", "hidden", "parent"]);
    // proposed 'hidden' is filtered out
    expect(out.map((e) => e.id).sort()).toEqual(["child", "parent"]);
    // child's parent_id resolves to the entity whose uns_path is its ancestor
    const child = out.find((e) => e.id === "child")!;
    expect(child.parent_id).toBe("parent");
    // a root (no ancestor present) has null parent_id
    const parent = out.find((e) => e.id === "parent")!;
    expect(parent.parent_id).toBeNull();
  });
});
