import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
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

  it("renders and selects the exact duplicate-machine link nested under the Brake folder", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    const project = view.container.querySelector('[data-project-id="project-brake-system"]');
    const folder = view.container.querySelector('[data-folder-id="folder-brake-history"]');
    if (!project || !folder) throw new Error("Brake project and folder controls are required");

    view.click(project);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "", machineId: "" });
    view.click(folder);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "folder-brake-history", machineId: "" });
    const brakeFolderItem = folder.closest("li");
    const machine = brakeFolderItem?.querySelector('[data-machine-id="machine-drive-a"]');
    expect(machine).not.toBeNull();
    if (!machine) throw new Error("Brake folder must render its duplicate Drive A machine link");
    view.click(machine);
    expect(view.activeContext()).toEqual({ projectId: "project-brake-system", folderId: "folder-brake-history", machineId: "machine-drive-a" });
  });

  it("opens and closes mobile navigation through the shared reducer", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    const shell = view.container.querySelector<HTMLElement>(".fl-shell");
    const close = view.buttonNamed("Close navigation");
    const open = view.buttonNamed("Open navigation");
    if (!shell || !close || !open) throw new Error("mobile navigation controls are required");

    expect(shell.dataset.navigationVisible).toBe("true");
    view.click(close);
    expect(shell.dataset.navigationVisible).toBe("false");
    view.click(open);
    expect(shell.dataset.navigationVisible).toBe("true");
  });

  it("closes mobile navigation after project, folder, and machine selection", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    const shell = view.container.querySelector<HTMLElement>(".fl-shell");
    const open = view.buttonNamed("Open navigation");
    const project = view.container.querySelector('[data-project-id="project-brake-system"]');
    const folder = view.container.querySelector('[data-folder-id="folder-brake-history"]');
    if (!shell || !open || !project || !folder) throw new Error("project-tree navigation controls are required");

    view.click(project);
    expect(shell.dataset.navigationVisible).toBe("false");
    view.click(open);
    view.click(folder);
    expect(shell.dataset.navigationVisible).toBe("false");
    view.click(open);
    const machine = folder.closest("li")?.querySelector('[data-machine-id="machine-drive-a"]');
    if (!machine) throw new Error("Brake folder must render its duplicate Drive A machine link");
    view.click(machine);
    expect(shell.dataset.navigationVisible).toBe("false");
  });

  it("retains mobile drawer and inspector-sheet layout foundations", () => {
    const css = readFileSync(new URL("../shell.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.fl-shell__sidebar\s*\{[^}]*position:\s*fixed[^}]*transform:\s*translateX\(-110%\)/s);
    expect(css).toMatch(/data-navigation-visible="true"[^}]*transform:\s*translateX\(0\)/s);
    expect(css).toMatch(/\.fl-shell__inspector\s*\{[^}]*position:\s*fixed[^}]*inset-block-end:\s*0/s);
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
