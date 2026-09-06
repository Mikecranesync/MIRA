import { afterEach, describe, expect, it } from "bun:test";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

describe("shared FactoryLM shell", () => {
  for (const surface of ["public", "web", "mobile", "hub"] as const) {
    it(`renders the canonical landmarks in ${surface}`, () => {
      const view = render({ surface, fixture: "project-tree" });

      expect(view.container.querySelector("main")).not.toBeNull();
      expect(view.container.querySelector('[aria-label="FactoryLM navigation"]')).not.toBeNull();
      expect(view.container.querySelector("header")).not.toBeNull();
      expect(view.buttonNamed("New chat")).not.toBeNull();
      expect(view.buttonNamed("New chat")?.disabled).toBe(true);
      expect(view.container.querySelector('[aria-label="Conversation placeholder"]')).not.toBeNull();
      expect(view.container.textContent).not.toContain("Ask MIRA");
    });
  }

  it("links project, nested folder, and in-scope machine selections through the reducer", () => {
    const view = render({ surface: "web", fixture: "project-tree" });
    const project = view.container.querySelector('[data-project-id="project-brake-system"]');
    const folder = view.container.querySelector('[data-folder-id="folder-brake-history"]');
    const machine = view.container.querySelector('[data-machine-id="machine-drive-a"]');
    if (!project || !folder || !machine) throw new Error("project-tree fixture controls are required");

    view.click(project);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "", machineId: "" });
    view.click(folder);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "folder-brake-history", machineId: "" });
    view.click(machine);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "folder-brake-history", machineId: "machine-drive-a" });
  });

  it("gates the inspector to the Hub capability without a separate shell tree", () => {
    const web = render({ surface: "web", fixture: "enterprise-inspector" });
    const hub = render({ surface: "hub", fixture: "enterprise-inspector" });

    expect(web.buttonNamed("Inspector")).toBeNull();
    expect(web.container.querySelector('[aria-label="Inspector"]')).toBeNull();
    const inspector = hub.buttonNamed("Inspector");
    if (!inspector) throw new Error("Hub must expose its inspector control");
    hub.click(inspector);
    expect(hub.container.querySelector('[aria-label="Inspector"]')?.textContent).toContain("Asset binding");
  });
});
