import { describe, expect, it } from "vitest";
import type { Notebook } from "../../api/resources";
import { notebookIdFromItem, notebookMachines, notebookProjects, threadItemId } from "../notebook-tree";

const nb = (id: string, name: string, asset: string | null, mfr: string | null = null, model: string | null = null): Notebook =>
  ({ id, displayName: name, manufacturer: mfr, model, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null,
     asset: asset ? { entityId: asset, selectedVia: null, confirmedBy: null, confirmedAt: null } : null });

describe("notebook tree", () => {
  it("maps notebooks to one project with machine links and thread items, ids round-trip", () => {
    const list = [nb("a", "Drive A", "asset-1", "Siemens", "G120"), nb("b", "General notes", null), nb("c", "Drive A again", "asset-1")];
    const [project] = notebookProjects(list);
    expect(project.name).toBe("Notebooks");
    expect(project.children.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "machine-link:link-a", "thread:notebook-a", "thread:notebook-b", "machine-link:link-c", "thread:notebook-c",
    ]);
    expect(notebookMachines(list)).toEqual([{ id: "asset-1", canonicalAssetId: "asset-1", name: "Siemens G120", unsPath: "", status: "unknown" }]);
    expect(notebookIdFromItem(threadItemId("b"))).toBe("b");
    expect(notebookIdFromItem("link-a")).toBeNull();
  });

  it("gives unnamed notebooks a visible canonical-shell label", () => {
    const [project] = notebookProjects([nb("blank", "", null)]);
    expect(project.children).toEqual([
      { kind: "thread", id: "notebook-blank", label: "Untitled notebook" },
    ]);
  });
});
