/**
 * Owner-decided UX nitpicks (Mike, 2026-10-21): #4561 remove the redundant
 * Chat tag, #4567 visible text labels on Attach/Send, #4568 no duplicate
 * project name, #4569 FactoryLM = platform, MIRA = AI assistant.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, describe, expect, it } from "bun:test";
import { getFixture } from "@factorylm/interaction";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });
function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

describe("#4561 sidebar chat rows carry no redundant Chat tag", () => {
  it("drops the tag on chat rows but keeps it on runs, files and machines (control)", () => {
    const view = render({ surface: "web", fixture: "project-tree", onOpenItem: () => {} });
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[aria-label="Projects"] .fl-tree__row'));
    const threads = rows.filter((row) => row.dataset.kind === "thread");
    const others = rows.filter((row) => row.dataset.kind === "run" || row.dataset.kind === "machine");
    expect(threads.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    expect(threads.every((row) => row.querySelector(".fl-tree__meta") === null)).toBe(true);
    expect(others.every((row) => (row.querySelector(".fl-tree__meta")?.textContent ?? "").length > 0)).toBe(true);
  });

  it("drops it on the label-only rows too, when the host cannot open items", () => {
    const view = render({ surface: "web", fixture: "project-tree" });
    const threads = Array.from(view.container.querySelectorAll<HTMLElement>('[aria-label="Projects"] [data-item-kind="thread"]'));
    expect(threads.length).toBeGreaterThan(0);
    expect(threads.every((row) => row.querySelector(".fl-tree__meta") === null)).toBe(true);
  });
});

describe("#4567 Attach and Send show their words", () => {
  it("renders visible Attach and Send text while keeping the accessible names", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    const attach = view.buttonNamed("Add attachment");
    const send = view.buttonNamed("Send");
    expect(attach?.textContent).toContain("Attach");
    expect(send?.textContent).toContain("Send");
  });
});

describe("#4568 the context bar does not repeat the thread title", () => {
  const base = getFixture("grounded-answer").thread;

  function crumbs(view: HarnessView): string {
    return view.container.querySelector('[aria-label="Context"]')?.textContent ?? "";
  }

  it("omits a crumb that is the same text as the header title", () => {
    const view = render({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant" });
    const project = crumbs(view).split(" / ")[0]!;
    expect(project.length).toBeGreaterThan(0);
    act(() => { view.dispatch({ type: "hydrate", data: { thread: { ...base, title: project } } }); });
    expect(view.container.querySelector(".fl-shell__header h1")?.textContent).toBe(project);
    expect(crumbs(view).split(" / ")).not.toContain(project);
  });

  it("keeps the crumb when the title is different (control)", () => {
    const view = render({ surface: "web", fixture: "grounded-answer", conversationSurface: "assistant" });
    const project = crumbs(view).split(" / ")[0]!;
    act(() => { view.dispatch({ type: "hydrate", data: { thread: { ...base, title: "F30001 diagnosis" } } }); });
    expect(crumbs(view).split(" / ")).toContain(project);
  });
});

describe("#4569 FactoryLM is the platform, MIRA is its AI assistant", () => {
  it("says so once, under the first-run greeting", () => {
    const view = render({ surface: "web", fixture: "empty", conversationSurface: "assistant" });
    const identity = view.container.querySelector(".fl-conversation__identity");
    expect(identity?.textContent).toBe("MIRA is FactoryLM's AI maintenance assistant.");
  });

  it("groups the greeting and its lines in the centre instead of stretching rows apart", () => {
    const css = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.fl-conversation__first-run\s*\{[^}]*align-content:\s*center/s);
  });
});
