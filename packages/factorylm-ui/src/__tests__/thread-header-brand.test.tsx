import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PROFILES, createShellState, getFixture, type ShellAction, type ShellState } from "@factorylm/interaction";
import type { HostHooks } from "../parts";
import { ThreadHeader } from "../ThreadHeader";

// The phone header stacks the product mark above the thread title. Both HOME
// hosts (mobile UnifiedRoot, Hub /v3) title the composer-home thread
// "FactoryLM", which put the word on screen twice, one above the other
// (Mike's Pixel screenshot, 2026-09-20). The mark is the product; the title
// is the thread — when they are the same word, render it once.

const roots: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  roots.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
});

function renderHeader(
  title: string,
  hooks?: HostHooks,
  profile: keyof typeof PROFILES = "mobile",
  dispatch: (action: ShellAction) => void = () => {},
): HTMLElement {
  const base = createShellState(getFixture("machine-ask"), PROFILES[profile]);
  const state: ShellState = { ...base, thread: { ...base.thread, title } };
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<ThreadHeader state={state} dispatch={dispatch} hooks={hooks} />);
  });
  roots.push({ root: root!, container });
  return container;
}

function headerNewChat(header: HTMLElement): HTMLButtonElement | null {
  return header.querySelector<HTMLButtonElement>(".fl-shell__header-new-chat");
}

describe("ThreadHeader — the brand appears once", () => {
  it("HOME (thread titled by the product name) renders the name once, as the heading", () => {
    const header = renderHeader("FactoryLM");
    const texts = Array.from(header.querySelectorAll(".fl-shell__header-title *"))
      .map((node) => node.textContent?.trim())
      .filter((text) => text === "FactoryLM");
    expect(texts).toHaveLength(1);
    expect(header.querySelector(".fl-shell__brand-mark")).toBeNull();
    expect(header.querySelector("h1")?.textContent).toBe("FactoryLM");
  });

  it("a project thread keeps the mark above its own title", () => {
    const header = renderHeader("Sensor v0 overnight 2026-08-28");
    expect(header.querySelector(".fl-shell__brand-mark")?.textContent).toBe("FactoryLM");
    expect(header.querySelector("h1")?.textContent).toBe("Sensor v0 overnight 2026-08-28");
  });
});

describe("ThreadHeader — New chat is always in the header", () => {
  it("is honestly disabled when the host cannot start a thread", () => {
    const header = renderHeader("Drive A");
    const button = headerNewChat(header);
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("New chat");
    expect(button?.getAttribute("title")).toMatch(/not available/i);
  });

  it("starts a host-owned thread and closes the drawer", () => {
    const calls: Array<string | ShellAction> = [];
    const header = renderHeader(
      "Drive A",
      { onNewChat: () => calls.push("newChat") },
      "mobile",
      (action) => calls.push(action),
    );
    const button = headerNewChat(header);
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-label")).toBe("New chat");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls).toEqual(["newChat", { type: "set-navigation-visible", visible: false }]);
  });

  it("names the public-demo control Start over", () => {
    const header = renderHeader("FactoryLM", { onNewChat: () => {} }, "public");
    expect(headerNewChat(header)?.getAttribute("aria-label")).toBe("Start over");
  });
});
