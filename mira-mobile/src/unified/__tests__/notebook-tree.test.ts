import { describe, expect, it } from "vitest";
import type { Notebook } from "../../api/resources";
import { notebookIdFromItem, notebookMachines, notebookProjects, threadItemId, threadRefFromItem } from "../notebook-tree";

const nb = (id: string, name: string, asset: string | null, mfr: string | null = null, model: string | null = null): Notebook =>
  ({ id, displayName: name, manufacturer: mfr, model, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null,
     asset: asset ? { entityId: asset, selectedVia: null, confirmedBy: null, confirmedAt: null } : null });

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
});
