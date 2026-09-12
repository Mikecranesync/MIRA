import { describe, expect, it } from "vitest";
import type { Notebook } from "../../api/resources";
import { notebookIdFromItem, notebookMachines, notebookProjects, threadItemId } from "../notebook-tree";

const nb = (id: string, name: string, asset: string | null, mfr: string | null = null, model: string | null = null): Notebook =>
  ({ id, displayName: name, manufacturer: mfr, model, equipmentType: null, identityStatus: "unknown", nodeId: "n", sourceCount: 0, createdAt: null,
     asset: asset ? { entityId: asset, selectedVia: null, confirmedBy: null, confirmedAt: null } : null });

describe("notebook tree", () => {
  it("maps each notebook to its own project with optional machine link and thread", () => {
    const list = [nb("a", "Drive A", "asset-1", "Siemens", "G120"), nb("b", "General notes", null), nb("c", "Drive A again", "asset-1")];
    const projects = notebookProjects(list);
    expect(projects.map((p) => `${p.id}:${p.name}`)).toEqual([
      "project-a:Siemens G120",
      "project-b:General notes",
      "project-c:Siemens G120",
    ]);
    expect(projects[0].children.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "machine-link:link-a", "thread:notebook-a",
    ]);
    expect(projects[1].children.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "thread:notebook-b",
    ]);
    expect(notebookMachines(list)).toEqual([{ id: "asset-1", canonicalAssetId: "asset-1", name: "Siemens G120", unsPath: "", status: "unknown" }]);
    expect(notebookIdFromItem(threadItemId("b"))).toBe("b");
    expect(notebookIdFromItem("link-a")).toBeNull();
  });

  it("gives unnamed notebooks a visible chat label", () => {
    const [project] = notebookProjects([nb("blank", "", null)]);
    expect(project.id).toBe("project-blank");
    expect(project.name).toBe("Untitled chat");
    expect(project.children).toEqual([
      { kind: "thread", id: "notebook-blank", label: "Untitled chat" },
    ]);
  });
});
