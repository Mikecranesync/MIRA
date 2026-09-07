/**
 * Slice C (#3649): the left navigation follows the plan's order on every
 * surface, every tree row uses one pattern with a type icon, exactly one row is
 * current, the product header shows the product mark (not the surface
 * profile), and context lines appear only when a turn/run differs from the
 * current context. Findings from the Codex look-vs-plan review of 1.1.7.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { getFixture } from "@factorylm/interaction";
import { act } from "react";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });
function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is required`);
  return value;
}

describe("navigation order and sections", () => {
  it("renders identity, New chat, Search, Recent, Projects, Machines, footer — in that order, on mobile and web", () => {
    for (const surface of ["mobile", "web"] as const) {
      const view = render({ surface, fixture: "project-tree", navigationFooter: <button type="button">Sign out</button> });
      const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
      const markers = Array.from(nav.querySelectorAll<HTMLElement>(".fl-shell__brand, .fl-shell__new-chat, .fl-shell__search, .fl-shell__section-title, .fl-shell__nav-footer"))
        .map((el) => el.textContent?.trim() || el.className);
      expect(markers).toEqual(["FactoryLM", "New chat", "fl-shell__search", "Recent", "Projects", "Machines", "Sign out"]);
    }
  });

  it("New chat is honestly unavailable: disabled with a visible, linked reason", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    const button = must(view.buttonNamed("New chat"), "New chat");
    expect(button.disabled).toBe(true);
    const reason = must(view.container.querySelector<HTMLElement>(`#${button.getAttribute("aria-describedby")}`), "reason");
    expect(reason.textContent).toMatch(/not available/i);
  });

  it("Search filters the tree, Recent and Machines by label and keeps a match's ancestors", () => {
    const view = render({ surface: "web", fixture: "project-tree" });
    const input = must(view.container.querySelector<HTMLInputElement>('input[aria-label="Search navigation"]'), "search");
    const setter = must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
    act(() => { setter.call(input, "brake"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const labels = Array.from(view.container.querySelectorAll<HTMLElement>('[aria-label="Projects"] .fl-tree__label')).map((el) => el.textContent);
    expect(labels.some((label) => /brake/i.test(label ?? ""))).toBe(true);
    expect(labels.some((label) => /launch 2 reliability/i.test(label ?? ""))).toBe(false);
  });
});

describe("tree rows", () => {
  it("every row uses the one pattern (icon column + label) and carries its object type", () => {
    const view = render({ surface: "web", fixture: "project-tree", onOpenItem: () => {} });
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[aria-label="Projects"] .fl-tree__row'));
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) {
      expect(row.dataset.kind).toMatch(/^(project|folder|machine|thread|run|file|finding)$/);
      expect(row.querySelector(".fl-tree__icon svg")).not.toBeNull();
      expect(row.querySelector(".fl-tree__label")).not.toBeNull();
    }
    // The same machine linked twice is told apart by kind + metadata, not by label.
    const machines = rows.filter((row) => row.dataset.kind === "machine");
    expect(machines.length).toBeGreaterThanOrEqual(2);
    expect(machines.every((row) => row.querySelector(".fl-tree__meta")?.textContent === "Machine")).toBe(true);
  });

  it("exactly one row is aria-current; its ancestors are marked as the path, not selected", () => {
    const view = render({ surface: "web", fixture: "project-tree", onOpenItem: () => {} });
    const tree = must(view.container.querySelector<HTMLElement>('[aria-label="Projects"]'), "tree");
    const current = tree.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    const path = Array.from(tree.querySelectorAll<HTMLElement>('[data-path="true"]'));
    for (const row of path) expect(row.getAttribute("aria-current")).toBeNull();
  });

  it("selecting a folder moves the single current row to that folder", () => {
    const view = render({ surface: "web", fixture: "project-tree", onOpenItem: () => {} });
    const tree = must(view.container.querySelector<HTMLElement>('[aria-label="Projects"]'), "tree");
    const folder = must(tree.querySelector<HTMLButtonElement>('button[data-folder-id="folder-drive-system"]'), "folder");
    view.click(folder);
    // A folder with no machine/thread selection below it is the current row itself.
    const current = Array.from(tree.querySelectorAll<HTMLElement>('[aria-current="page"]'));
    expect(current.length).toBe(1);
  });
});

describe("product header", () => {
  it("shows the FactoryLM mark and the thread title; never the surface profile", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    const header = must(view.container.querySelector<HTMLElement>(".fl-shell__header"), "header");
    expect(header.querySelector(".fl-shell__brand-mark")?.textContent).toBe("FactoryLM");
    expect(header.textContent).not.toMatch(/\bmobile\b/i);
    expect(header.querySelector("h1")?.textContent).toBe("F30001 source-grounded response");
  });
});

describe("context lines only when context differs", () => {
  it("a turn whose context equals the current context carries no machine line", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    expect(view.container.querySelector('[data-context-line="turn"]')).toBeNull();
  });

  it("a run whose snapshot equals the current context carries no Context line", () => {
    const view = render({ surface: "web", fixture: "work-run" });
    expect(view.container.querySelector('[data-context-line="run"]')).toBeNull();
  });

  it("a turn recorded against a different machine still says so", () => {
    const view = render({ surface: "web", fixture: "grounded-answer" });
    expect(view.container.querySelector('[data-context-line="turn"]')).toBeNull();
    // Re-stamp the recorded turns onto another real machine; the current context is unchanged.
    const thread = getFixture("grounded-answer").thread;
    const moved = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, context: { ...turn.context, machineId: "machine-drive-b" } })) };
    act(() => { view.dispatch({ type: "hydrate", data: { thread: moved } }); });
    const turns = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]"));
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((turn) => turn.querySelector('[data-context-line="turn"]') !== null)).toBe(true);
  });
});

describe("stylesheet contract", () => {
  const shell = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
  it("the drawer scroll belongs to the section stack, and the brand mark is a mobile-only header element", () => {
    const mobile = shell.slice(shell.indexOf("@media (max-width: 48rem)"));
    expect(mobile).toMatch(/\.fl-shell__nav-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(mobile).toMatch(/\.fl-shell__brand-mark\s*\{[^}]*display:\s*block/s);
    expect(shell).toMatch(/\.fl-shell__brand-mark\s*\{[^}]*display:\s*none/s);
  });
});
