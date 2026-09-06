import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { composerKeyAction } from "../Composer";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

function key(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function back(): void {
  act(() => {
    document.dispatchEvent(new Event("factorylm:back", { bubbles: true, cancelable: true }));
  });
}

function must<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`${what} is required`);
  return value;
}

describe("layer-closing precedence", () => {
  it("closes the source viewer, then the inspector, then passes Back to the host", () => {
    const adapter = fakeAdapter();
    const view = render({ surface: "hub", fixture: "enterprise-inspector", adapter });
    view.click(must(view.buttonNamed("Inspector"), "Inspector toggle"));
    view.click(must(view.container.querySelector('button[data-part-type="source"]'), "citation"));
    expect(view.container.querySelector('[aria-label="Source viewer"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Inspector"]')).not.toBeNull();

    key(document, "Escape");
    expect(view.container.querySelector('[aria-label="Source viewer"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Inspector"]')).not.toBeNull();
    expect(adapter.calls).toEqual([]);

    key(document, "Escape");
    expect(view.container.querySelector('[aria-label="Inspector"]')).toBeNull();
    expect(adapter.calls).toEqual([]);

    key(document, "Escape");
    expect(adapter.calls).toEqual(["onBack"]);
  });

  it("closes the attachment menu, then the mobile drawer, then passes Back to the host", () => {
    const adapter = fakeAdapter();
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    const shell = must(view.container.querySelector<HTMLElement>(".fl-shell"), "shell");
    view.click(must(view.buttonNamed("Close navigation"), "Close navigation"));
    view.click(must(view.buttonNamed("Open navigation"), "Open navigation"));
    view.click(must(view.buttonNamed("Add attachment"), "Add attachment"));
    expect(view.container.querySelector('[aria-label="Attachment menu"]')).not.toBeNull();
    expect(shell.dataset.navigationVisible).toBe("true");

    back();
    expect(view.container.querySelector('[aria-label="Attachment menu"]')).toBeNull();
    expect(shell.dataset.navigationVisible).toBe("true");
    expect(adapter.calls).toEqual([]);

    back();
    expect(shell.dataset.navigationVisible).toBe("false");
    expect(adapter.calls).toEqual([]);

    back();
    expect(adapter.calls).toEqual(["onBack"]);
  });

  it("does not treat the desktop sidebar as a closable layer", () => {
    const adapter = fakeAdapter();
    const view = render({ surface: "web", fixture: "machine-ask", adapter });
    const shell = must(view.container.querySelector<HTMLElement>(".fl-shell"), "shell");

    expect(shell.dataset.navigationVisible).toBe("true");
    key(document, "Escape");
    expect(shell.dataset.navigationVisible).toBe("true");
    expect(adapter.calls).toEqual(["onBack"]);
  });

  it("closes the top modal layer when the scrim is tapped", () => {
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    view.click(must(view.buttonNamed("Close navigation"), "Close navigation"));
    expect(view.container.querySelector(".fl-scrim")).toBeNull();
    view.click(must(view.container.querySelector('button[data-part-type="source"]'), "citation"));
    const scrim = must(view.container.querySelector<HTMLElement>(".fl-scrim"), "scrim");
    expect(scrim.dataset.layer).toBe("source");

    view.click(scrim);
    expect(view.container.querySelector('[aria-label="Source viewer"]')).toBeNull();
    expect(view.container.querySelector(".fl-scrim")).toBeNull();
  });
});

describe("focus trap and return", () => {
  it("moves focus into the source viewer, wraps Tab, and returns focus to the citation on close", () => {
    const view = render({ surface: "web", fixture: "grounded-answer" });
    const citation = must(view.container.querySelector<HTMLButtonElement>('button[data-part-type="source"]'), "citation");
    act(() => citation.focus());
    view.click(citation);
    const viewer = must(view.container.querySelector<HTMLElement>('[aria-label="Source viewer"]'), "source viewer");
    const close = must(view.buttonNamed("Close source viewer"), "close");

    expect(viewer.contains(document.activeElement)).toBe(true);
    key(close, "Tab");
    expect(viewer.contains(document.activeElement)).toBe(true);
    key(must(document.activeElement, "active element"), "Tab", { shiftKey: true });
    expect(viewer.contains(document.activeElement)).toBe(true);
    expect(viewer.getAttribute("aria-modal")).toBe("true");

    key(document, "Escape");
    expect(document.activeElement).toBe(citation);
  });

  it("traps focus in the mobile drawer opened from a control and returns it on close", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    view.click(must(view.buttonNamed("Close navigation"), "Close navigation"));
    const open = must(view.buttonNamed("Open navigation"), "Open navigation");
    act(() => open.focus());
    view.click(open);
    const drawer = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "drawer");

    expect(drawer.contains(document.activeElement)).toBe(true);
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>("button:not(:disabled)"));
    act(() => focusable[focusable.length - 1].focus());
    key(focusable[focusable.length - 1], "Tab");
    expect(document.activeElement).toBe(focusable[0]);
    key(focusable[0], "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);

    key(document, "Escape");
    expect(document.activeElement).toBe(open);
  });

  it("does not steal focus for the drawer that is open at mount", () => {
    const view = render({ surface: "mobile", fixture: "project-tree" });
    const drawer = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "drawer");

    expect(drawer.contains(document.activeElement)).toBe(false);
    const textarea = must(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'), "message");
    act(() => textarea.focus());
    expect(document.activeElement).toBe(textarea);
  });
});

describe("composer keyboard contract", () => {
  it("decides send, newline, or none from the key event", () => {
    expect(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 })).toBe("send");
    expect(composerKeyAction({ key: "Enter", shiftKey: true, isComposing: false, keyCode: 13 })).toBe("newline");
    expect(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: true, keyCode: 13 })).toBe("none");
    expect(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 })).toBe("none");
    expect(composerKeyAction({ key: "a", shiftKey: false, isComposing: false, keyCode: 65 })).toBe("none");
  });

  it("sends on Enter, keeps Shift+Enter and IME Enter as text, and ignores an empty draft", () => {
    const view = render({ surface: "mobile", fixture: "general-ask" });
    const textarea = must(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'), "message");

    key(textarea, "Enter");
    expect(view.outputs().turnCount).toBe(2);

    view.type(textarea, "How is preload measured?");
    key(textarea, "Enter", { shiftKey: true });
    expect(view.outputs().turnCount).toBe(2);
    expect(view.outputs().draft).toBe("How is preload measured?");

    key(textarea, "Enter", { isComposing: true });
    expect(view.outputs().turnCount).toBe(2);

    key(textarea, "Enter");
    expect(view.outputs().turnCount).toBe(3);
    expect(view.outputs().draft).toBe("");
  });
});

describe("touch target and motion contract", () => {
  it("keeps 44px targets, a scrim, and reduced-motion rules in the shell stylesheet", () => {
    const css = readFileSync(new URL("../shell.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.fl-shell button\s*\{[^}]*min-block-size:\s*2\.75rem/s);
    expect(css).toMatch(/\.fl-shell button\s*\{[^}]*min-inline-size:\s*2\.75rem/s);
    expect(css).toMatch(/\.fl-scrim\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
