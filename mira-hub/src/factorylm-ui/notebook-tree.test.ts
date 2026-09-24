import { describe, expect, it } from "vitest";
import {
  LEGACY_THREAD_ID,
  machineNameFor,
  notebookIdFromProject,
  notebookMachines,
  notebookProjects,
  projectIdForNotebook,
  threadItemId,
  threadRefFromItem,
  type HubNotebook,
} from "./notebook-tree";

function notebook(over: Partial<HubNotebook> = {}): HubNotebook {
  return {
    id: "nb-1",
    displayName: "Conveyor CV-101",
    manufacturer: "Automation Direct",
    model: "GS10",
    catalogNumber: null,
    serialNumber: null,
    equipmentType: null,
    assetTag: null,
    locationLabel: null,
    identityStatus: "user_confirmed",
    identityConfidence: null,
    identitySourceType: null,
    nodeId: "node-1",
    sourceCount: 2,
    lastOpenedAt: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    asset: null,
    ...over,
  };
}

describe("item id grammar — shared with the mobile shell", () => {
  it("round-trips project and thread ids", () => {
    expect(projectIdForNotebook("nb-1")).toBe("project-nb-1");
    expect(notebookIdFromProject("project-nb-1")).toBe("nb-1");
    expect(notebookIdFromProject("thread-x")).toBeNull();
    expect(threadItemId("nb-1", "t-9")).toBe("notebook-nb-1:thread-t-9");
    expect(threadRefFromItem("notebook-nb-1:thread-t-9")).toEqual({ notebookId: "nb-1", threadId: "t-9" });
  });

  it("parses the pre-THRD-0 legacy item id and rejects garbage", () => {
    expect(threadRefFromItem("notebook-nb-1")).toEqual({ notebookId: "nb-1", threadId: LEGACY_THREAD_ID });
    expect(threadRefFromItem("notebook-")).toBeNull();
    expect(threadRefFromItem("notebook-nb-1:thread-")).toBeNull();
    expect(threadRefFromItem("project-nb-1")).toBeNull();
  });
});

describe("notebookProjects", () => {
  it("one Project per notebook; threads become thread rows with the shared id grammar", () => {
    const nb = notebook({
      threads: [
        { id: "t-1", notebookId: "nb-1", title: "Fault F0004", createdAt: "", updatedAt: "", turnCount: 3, sharedLegacy: false },
        { id: "t-2", notebookId: "nb-1", title: "   ", createdAt: "", updatedAt: "", turnCount: 0, sharedLegacy: false },
      ],
    });
    const [project] = notebookProjects([nb]);
    expect(project.id).toBe("project-nb-1");
    expect(project.name).toBe("Conveyor CV-101");
    expect(project.children).toEqual([
      { kind: "thread", id: "notebook-nb-1:thread-t-1", label: "Fault F0004" },
      // An empty thread title falls back to the notebook label, never a blank row.
      { kind: "thread", id: "notebook-nb-1:thread-t-2", label: "Conveyor CV-101" },
    ]);
  });

  it("a notebook with no threads still gets one legacy thread row so it can be opened", () => {
    const [project] = notebookProjects([notebook()]);
    expect(project.children).toEqual([{ kind: "thread", id: "notebook-nb-1:thread-legacy", label: "Conveyor CV-101" }]);
  });

  it("a bound notebook leads with a machine-link keyed by the canonical entityId, never a label", () => {
    const nb = notebook({ asset: { entityId: "asset-uuid-1", name: null, assetTag: null, selectedVia: null, confirmedBy: "u1", confirmedAt: "2026-09-17T00:00:00Z" } });
    const [project] = notebookProjects([nb]);
    expect(project.children[0]).toEqual({ kind: "machine-link", id: "link-nb-1", label: "Automation Direct GS10", machineId: "asset-uuid-1" });
  });

  it("an untitled notebook is labelled honestly", () => {
    const [project] = notebookProjects([notebook({ displayName: "  ", manufacturer: null, model: null })]);
    expect(project.name).toBe("Untitled notebook");
    expect(machineNameFor(notebook({ manufacturer: null, model: null }))).toBe("Conveyor CV-101");
  });
});

describe("notebookMachines", () => {
  it("dedupes by entityId and skips unbound notebooks", () => {
    const bound = notebook({ asset: { entityId: "asset-uuid-1", name: null, assetTag: null, selectedVia: null, confirmedBy: null, confirmedAt: null } });
    const twin = notebook({ id: "nb-2", displayName: "Twin", asset: { entityId: "asset-uuid-1", name: null, assetTag: null, selectedVia: null, confirmedBy: null, confirmedAt: null } });
    const machines = notebookMachines([bound, twin, notebook({ id: "nb-3" })]);
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({ id: "asset-uuid-1", canonicalAssetId: "asset-uuid-1", status: "unknown" });
  });
});

describe("unbound (asset: null) notebooks are addressable in the tree (#3922)", () => {
  it("lists a mobile-form notebook's threads as openable rows with no machine link, and each row resolves to its exact thread", () => {
    const mobile = notebook({
      id: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4",
      displayName: "EMU-WALK-3898-verify",
      manufacturer: "AutomationDirect",
      model: "GS10",
      identityStatus: "user_confirmed",
      asset: null,
      threads: [
        { id: "t-1", notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", title: "temperature", createdAt: "", updatedAt: "", turnCount: 3, sharedLegacy: false },
        { id: "t-2", notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", title: "ports", createdAt: "", updatedAt: "", turnCount: 1, sharedLegacy: false },
      ],
    });
    const [project] = notebookProjects([mobile]);
    expect(project.id).toBe("project-7a352ed1-5f8a-48d6-b66c-1ff641fea9d4");
    expect(project.children.map((c) => c.kind)).toEqual(["thread", "thread"]);
    for (const [row, threadId] of [[project.children[0], "t-1"], [project.children[1], "t-2"]] as const) {
      expect(threadRefFromItem(row.id)).toEqual({ notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", threadId });
    }
    expect(notebookMachines([mobile])).toEqual([]);
  });
});
