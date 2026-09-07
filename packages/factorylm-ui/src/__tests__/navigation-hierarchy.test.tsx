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
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[aria-label="Projects"] .fl-tree__row'));
    const labels = rows.map((row) => row.querySelector(".fl-tree__label")?.textContent ?? "");
    expect(labels.some((label) => /brake/i.test(label))).toBe(true);
    // Non-matching rows disappear — unless they are the current row or on its path (P2):
    // "Launch 2 Drive B" is neither, so it is gone; the Launch 2 ancestors of the current
    // machine link remain, marked as the path, never as a match.
    expect(labels.some((label) => /drive b/i.test(label))).toBe(false);
    const byLabel = (re: RegExp) => rows.find((row) => re.test(row.querySelector(".fl-tree__label")?.textContent ?? ""));
    expect(byLabel(/recurring findings/i)).toBeDefined();          // ancestor of a match stays
    expect(byLabel(/launch 2 reliability/i)?.dataset.path).toBe("true"); // ancestor of the current row stays, as path
    expect(byLabel(/^drive a$/i)).toBeUndefined();                  // neither match, path nor current: gone
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

  it("across the WHOLE navigation exactly one element is aria-current; pins and Recent are references", () => {
    const view = render({ surface: "mobile", fixture: "project-tree", onOpenItem: () => {} });
    const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
    expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1);
    // The active machine's pin points at the object the tree already selects: quiet, not selected.
    const pin = must(nav.querySelector<HTMLElement>('[data-pinned-machine-id="machine-drive-a"]'), "pin");
    expect(pin.getAttribute("aria-current")).toBeNull();
    expect(pin.dataset.active).toBe("true");
  });

  it("a search that does not match the current row keeps it rendered, so exactly one row stays current (P2)", () => {
    const view = render({ surface: "web", fixture: "project-tree", onOpenItem: () => {} });
    const tree = () => must(view.container.querySelector<HTMLElement>('[aria-label="Projects"]'), "tree");
    const before = must(tree().querySelector<HTMLElement>('[aria-current="page"]'), "current before search");
    const input = must(view.container.querySelector<HTMLInputElement>('input[aria-label="Search navigation"]'), "search");
    const setter = must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
    act(() => { setter.call(input, "brake"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const current = Array.from(tree().querySelectorAll<HTMLElement>('[aria-current="page"]'));
    expect(current.length).toBe(1);
    expect(current[0].textContent).toBe(before.textContent);
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

  it("a context_change part equal to the current context renders nothing visible", () => {
    const view = render({ surface: "web", fixture: "work-run" });
    expect(view.container.querySelector('[data-part-type="context_change"]')).toBeNull();
    expect(view.container.querySelector(".fl-conversation")?.textContent ?? "").not.toContain("Context:");
  });

  it("a turn whose evidence authorization differs from the current context still says so (P1)", () => {
    const view = render({ surface: "web", fixture: "grounded-answer" });
    expect(view.container.querySelector('[data-context-line="turn"]')).toBeNull();
    const thread = getFixture("grounded-answer").thread;
    const revoked = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, context: { ...turn.context, evidenceAuthorization: "not_authorized" as const } })) };
    act(() => { view.dispatch({ type: "hydrate", data: { thread: revoked } }); });
    const turns = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]"));
    expect(turns.length).toBeGreaterThan(0);
    const lines = turns.map((turn) => turn.querySelector('[data-context-line="turn"]')?.textContent ?? "");
    // Presence is not enough: the line must SAY what differs — here, that evidence was not authorized.
    expect(lines.every((line) => /evidence not authorized/i.test(line))).toBe(true);

    // And the other way round: a turn recorded while authorized, shown after authorization moved on,
    // says "evidence authorized" — the two histories are distinguishable by their visible text.
    const revokedNow = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, context: { ...turn.context, evidenceAuthorization: "authorized" as const } })) };
    act(() => { view.dispatch({ type: "hydrate", data: { thread: revokedNow, activeContext: { ...getFixture("grounded-answer").activeContext, evidenceAuthorization: "not_authorized" } } }); });
    const after = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]")).map((turn) => turn.querySelector('[data-context-line="turn"]')?.textContent ?? "");
    expect(after.every((line) => /evidence authorized/i.test(line) && !/not authorized/i.test(line))).toBe(true);
  });

  it("a turn recorded under a different project/folder names them, and a machine-less scope still reads", () => {
    const view = render({ surface: "web", fixture: "grounded-answer" });
    const thread = getFixture("grounded-answer").thread;
    const moved = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, context: { ...turn.context, projectId: "project-brake-system", folderId: "folder-brake-history" } })) };
    act(() => { view.dispatch({ type: "hydrate", data: { thread: moved } }); });
    const lines = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-context-line="turn"]')).map((el) => el.textContent ?? "");
    expect(lines().length).toBeGreaterThan(0);
    expect(lines().every((line) => /project Brake System/.test(line) && /folder /.test(line))).toBe(true);
    const noMachine = { ...thread, turns: thread.turns.map((turn) => ({ ...turn, context: { ...turn.context, machineId: undefined, projectId: "project-brake-system" } })) };
    act(() => { view.dispatch({ type: "hydrate", data: { thread: noMachine } }); });
    expect(lines().every((line) => /^No machine · evidence /.test(line) && /project Brake System/.test(line))).toBe(true);
  });

  it("the open run outranks its thread and the machine link as the single current row", () => {
    const view = render({ surface: "web", fixture: "work-run", onOpenItem: () => {} });
    const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
    const current = Array.from(nav.querySelectorAll<HTMLElement>('[aria-current="page"]'));
    expect(current.length).toBe(1);
    expect(current[0].dataset.itemKind).toBe("run");
    expect(current[0].dataset.itemId).toBe("run-drive-a-f30001");
  });

  it("switching Work → Ask with a retained run moves the current row off the run (mode-aware priority)", () => {
    const view = render({ surface: "web", fixture: "work-run", onOpenItem: () => {} });
    const nav = () => must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
    const current = () => Array.from(nav().querySelectorAll<HTMLElement>('[aria-current="page"]'));
    expect(current()[0].dataset.itemKind).toBe("run");
    act(() => { view.dispatch({ type: "set-mode", mode: "ask" }); });
    expect(current().length).toBe(1);
    expect(current()[0].dataset.itemKind).not.toBe("run");
    expect(current()[0].dataset.kind).toBe("machine"); // the open thread is not in the tree, so the active machine link
    act(() => { view.dispatch({ type: "set-mode", mode: "work" }); });
    expect(current()[0].dataset.itemKind).toBe("run");
  });

  it("an inert current row matches the selection stylesheet selector (styled, not just semantic)", () => {
    const view = render({ surface: "web", fixture: "work-run" });
    const li = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"] li[aria-current="page"]'), "inert current li");
    expect(li.matches('.fl-tree__row[aria-current="page"]')).toBe(true);
    const shellCss = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
    expect(shellCss).toMatch(/\.fl-tree__row\[aria-current="page"\]\s*\{[^}]*--fl-workspace-accent-tint/s);
  });

  it("New chat is an enabled primary action when the host can start a thread, and it closes the drawer", () => {
    const calls: string[] = [];
    const view = render({ surface: "mobile", fixture: "project-tree", hooks: { onNewChat: () => calls.push("newChat") } });
    const button = must(view.buttonNamed("New chat"), "New chat");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(view.container.querySelector("#fl-new-chat-reason")).toBeNull();
    view.click(button);
    expect(calls).toEqual(["newChat"]);
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
  });

  it("an inert item row (no host opener) is the single current row when its thread is open, before and after a search", () => {
    const view = render({ surface: "web", fixture: "project-tree" });
    act(() => { view.dispatch({ type: "hydrate", data: { thread: { ...getFixture("project-tree").thread, id: "thread-drive-a" } } }); });
    const nav = () => must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
    const current = () => Array.from(nav().querySelectorAll<HTMLElement>('[aria-current="page"]'));
    expect(current().length).toBe(1);
    expect(current()[0].tagName).toBe("LI");
    expect(current()[0].dataset.itemId ?? current()[0].querySelector(".fl-tree__label")?.textContent).toBeTruthy();
    const input = must(view.container.querySelector<HTMLInputElement>('input[aria-label="Search navigation"]'), "search");
    const setter = must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
    act(() => { setter.call(input, "brake"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(current().length).toBe(1);
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

describe("closed drawer is inert", () => {
  it("on mobile the closed drawer carries inert and drops it when opened; on web it never does", () => {
    const view = render({ surface: "mobile", fixture: "machine-ask" });
    const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "navigation");
    expect(nav.hasAttribute("inert")).toBe(false); // opens at mount on mobile
    view.click(must(view.buttonNamed("Close navigation"), "Close navigation"));
    expect(nav.hasAttribute("inert")).toBe(true);
    view.click(must(view.buttonNamed("Open navigation"), "Open navigation"));
    expect(nav.hasAttribute("inert")).toBe(false);
    const web = render({ surface: "web", fixture: "machine-ask" });
    expect(web.container.querySelector('[aria-label="FactoryLM navigation"]')?.hasAttribute("inert")).toBe(false);
  });
});

describe("stylesheet contract", () => {
  const shell = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
  it("the drawer scroll belongs to the section stack, and the brand mark is a mobile-only header element", () => {
    // The rule must bind to a rendered element, not just exist in the stylesheet.
    const view = render({ surface: "mobile", fixture: "project-tree" });
    expect(view.container.querySelector('[aria-label="FactoryLM navigation"] .fl-shell__nav-scroll')).not.toBeNull();
    const mobile = shell.slice(shell.indexOf("@media (max-width: 48rem)"));
    expect(shell).toMatch(/\n\.fl-shell__nav-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(shell).toMatch(/\n\.fl-shell__sidebar\s*\{[^}]*position:\s*sticky;[^}]*block-size:\s*100dvh/s);
    expect(mobile).toMatch(/\.fl-shell__brand-mark\s*\{[^}]*display:\s*block/s);
    expect(shell).toMatch(/\.fl-shell__brand-mark\s*\{[^}]*display:\s*none/s);
  });

  it("a closed mobile drawer is out of the tab order (visibility hidden), visible again when open", () => {
    // Keyboard users were tabbing through an invisible drawer (e2e "whole core flow" caught it).
    const mobile = shell.slice(shell.indexOf("@media (max-width: 48rem)"));
    expect(mobile).toMatch(/\.fl-shell__sidebar\s*\{[^}]*visibility:\s*hidden/s);
    expect(mobile).toMatch(/\[data-navigation-visible="true"\] \.fl-shell__sidebar\s*\{[^}]*visibility:\s*visible/s);
  });
});
