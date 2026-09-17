import { describe, expect, it } from "vitest";
import type { Notebook } from "../../api/resources";
import { machineNameFor, notebookIdFromItem, notebookMachines, notebookProjects, threadItemId, threadRefFromItem } from "../notebook-tree";

const nb = (
  id: string,
  name: string,
  asset: string | null,
  mfr: string | null = null,
  model: string | null = null,
  assetIdentity: { name?: string | null; assetTag?: string | null } = {},
): Notebook =>
  ({ id, displayName: name, manufacturer: mfr, model, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null,
     asset: asset
       ? { entityId: asset, name: assetIdentity.name ?? null, assetTag: assetIdentity.assetTag ?? null, selectedVia: null, confirmedBy: null, confirmedAt: null }
       : null });

describe("notebook tree", () => {
  it("maps notebooks to projects with machine links and thread rows, ids round-trip", () => {
    const list = [
      { ...nb("a", "Drive A", "asset-1", "Siemens", "G120"), threads: [
        { id: "thrd-1", notebookId: "a", title: "Intermittent F004", createdAt: "", updatedAt: "", turnCount: 2, sharedLegacy: false },
        { id: "thrd-2", notebookId: "a", title: "Startup checks", createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false },
      ] },
      nb("b", "General notes", null),
      nb("c", "Drive A again", "asset-1"),
    ];
    const projects = notebookProjects(list);
    expect(projects.map((p) => p.name)).toEqual(["Drive A", "General notes", "Drive A again"]);
    expect(projects[0].children.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "machine-link:link-a", "thread:notebook-a:thread-thrd-1", "thread:notebook-a:thread-thrd-2",
    ]);
    expect(notebookMachines(list)).toEqual([{ id: "asset-1", canonicalAssetId: "asset-1", name: "Siemens G120", unsPath: "", status: "unknown" }]);
    expect(notebookIdFromItem(threadItemId("b"))).toBe("b");
    expect(threadRefFromItem(threadItemId("a", "thrd-2"))).toEqual({ notebookId: "a", threadId: "thrd-2" });
    expect(notebookIdFromItem("link-a")).toBeNull();
  });

  it("gives unnamed notebooks a visible canonical-shell label", () => {
    const [project] = notebookProjects([nb("blank", "", null)]);
    expect(project.children).toEqual([
      { kind: "thread", id: "notebook-blank:thread-legacy", label: "Untitled notebook" },
    ]);
  });

  // Slice 0 — the CV-101 bug, generalized. A stale notebook display_name must
  // never mask the CURRENT bound-asset identity in the drawer. These fail on the
  // pre-Slice-0 code (which used display_name / manufacturer+model).
  describe("bound-asset identity resolution (Slice 0)", () => {
    // A DIFFERENT asset than CV-101 on purpose: proves the label is resolved
    // from the bound asset's fields, not hard-coded to "CV-101".
    const stale = nb("pump", "Sensor v0 overnight 2026-08-28", "asset-pmp7", null, null, {
      name: "Coolant Pump",
      assetTag: "PMP-7",
    });

    it("resolves the machine label from tag · name, not the stale display_name", () => {
      expect(machineNameFor(stale)).toBe("PMP-7 · Coolant Pump");
    });

    it("names the Project from the bound asset so it is discoverable by tag or name", () => {
      const [project] = notebookProjects([stale]);
      expect(project.name).toBe("PMP-7 · Coolant Pump");
      // The drawer search is a plain substring over the label; both the sticker
      // tag and the human name are inside it.
      expect(project.name.toLowerCase()).toContain("pmp-7");
      expect(project.name.toLowerCase()).toContain("coolant pump");
      // The stale name is gone from the technician-facing label.
      expect(project.name).not.toContain("Sensor v0 overnight");
    });

    it("carries the bound-asset label onto the machine node", () => {
      expect(notebookMachines([stale])).toEqual([
        { id: "asset-pmp7", canonicalAssetId: "asset-pmp7", name: "PMP-7 · Coolant Pump", unsPath: "", status: "unknown" },
      ]);
    });

    it("falls back to the asset name alone when there is no tag", () => {
      const noTag = nb("p2", "stale name", "asset-x", null, null, { name: "Discharge Conveyor", assetTag: null });
      expect(machineNameFor(noTag)).toBe("Discharge Conveyor");
    });

    it("falls back to the asset tag alone when there is no name", () => {
      const noName = nb("p3", "stale name", "asset-y", null, null, { name: null, assetTag: "CV-101" });
      expect(machineNameFor(noName)).toBe("CV-101");
    });

    it("keeps manufacturer+model when the asset carries no resolved identity", () => {
      const unresolved = nb("p4", "stale name", "asset-z", "Siemens", "G120", { name: null, assetTag: null });
      expect(machineNameFor(unresolved)).toBe("Siemens G120");
    });
  });
});
