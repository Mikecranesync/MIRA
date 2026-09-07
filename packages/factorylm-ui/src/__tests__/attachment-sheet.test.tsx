// Slice A (FLM-UI-4000): the attachment chooser is a real shared layer — scrim,
// focus containment + return, Escape/BACK precedence — and the composer, drawer
// and sheet respect the device safe areas with zero-capable fallbacks.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });
function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}
function must<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`${what} is required`);
  return value;
}
function key(target: EventTarget, name: string): void {
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}
function back(): void {
  act(() => { document.dispatchEvent(new Event("factorylm:back", { bubbles: true, cancelable: true })); });
}
const sheet = (view: HarnessView) => view.container.querySelector<HTMLElement>('[aria-label="Attachment menu"]');

describe("attachment sheet layer", () => {
  it("opens as a modal dialog inside the attachment-menu overlay with a scrim, and the scrim dismisses it", () => {
    const adapter = fakeAdapter();
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    view.click(must(view.buttonNamed("Close navigation"), "Close navigation"));
    expect(sheet(view)).toBeNull();
    expect(view.container.querySelector('.fl-scrim[data-layer="attachment-menu"]')).toBeNull();

    view.click(must(view.buttonNamed("Add attachment"), "Add attachment"));
    const dialog = must(sheet(view), "attachment sheet");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.closest('.fl-overlay[data-layer="attachment-menu"]')?.getAttribute("data-active")).toBe("true");
    expect(dialog.closest("form.fl-composer")?.getAttribute("data-menu-open")).toBe("true");
    expect(view.buttonNamed("Add attachment")?.getAttribute("aria-expanded")).toBe("true");

    const scrim = must(view.container.querySelector<HTMLElement>('.fl-scrim[data-layer="attachment-menu"]'), "scrim");
    view.click(scrim);
    expect(sheet(view)).toBeNull();
    expect(view.container.querySelector(".fl-scrim")).toBeNull();
    expect(adapter.calls).toEqual([]);
  });

  it("moves focus into the sheet on open and returns it to the trigger on Escape", () => {
    const view = render({ surface: "web", fixture: "machine-ask" });
    const add = must(view.buttonNamed("Add attachment"), "Add attachment");
    act(() => { add.focus(); });
    expect(document.activeElement).toBe(add);

    view.click(add);
    const dialog = must(sheet(view), "attachment sheet");
    expect(dialog.contains(document.activeElement)).toBe(true);

    key(document, "Escape");
    expect(sheet(view)).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("closes on BACK before the inspector and the drawer, and routes actions through the composer", async () => {
    const adapter = fakeAdapter({ photo: { id: "a1", name: "IMG_0001.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" } });
    const view = render({ surface: "mobile", fixture: "machine-ask", adapter });
    // Drawer open (fixture contract) + sheet open: BACK closes the sheet first.
    view.click(must(view.buttonNamed("Add attachment"), "Add attachment"));
    expect(sheet(view)).not.toBeNull();
    back();
    expect(sheet(view)).toBeNull();
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    expect(adapter.calls).toEqual([]);

    // The actions are the composer's: a picked photo lands in the pending list.
    view.click(must(view.buttonNamed("Add attachment"), "Add attachment"));
    view.click(must(view.buttonNamed("Photo"), "Photo"));
    // attachPhoto is async: let the adapter resolve and the composer commit
    // the picked attachment inside act, so nothing updates after the test.
    await act(async () => { await Promise.resolve(); });
    expect(sheet(view)).toBeNull();
    expect(adapter.calls).toEqual(["attachPhoto"]);
  });
});

describe("focus return respects the layer stack", () => {
  it("returns focus into the still-open drawer, not to the composer behind its scrim, when the sheet closes", () => {
    const view = render({ surface: "mobile", fixture: "machine-ask" });
    // The mobile fixture opens the drawer at mount; open the sheet on top of it.
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    const add = must(view.buttonNamed("Add attachment"), "Add attachment");
    act(() => { add.focus(); });
    view.click(add);
    const dialog = must(sheet(view), "attachment sheet");
    expect(dialog.contains(document.activeElement)).toBe(true);

    key(document, "Escape");
    expect(sheet(view)).toBeNull();
    const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "drawer");
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    expect(document.activeElement).not.toBe(add);
    expect(nav.contains(document.activeElement)).toBe(true);

    // With no layer left above it, the drawer still returns focus to its own opener.
    key(document, "Escape");
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("false");
  });
});

describe("Tab trapping follows layer precedence", () => {
  it("traps Tab in the attachment sheet, not the drawer, when both are open", () => {
    const view = render({ surface: "mobile", fixture: "machine-ask" });
    // The mobile fixture opens the drawer at mount; open the sheet on top of it.
    expect(view.container.querySelector(".fl-shell")?.getAttribute("data-navigation-visible")).toBe("true");
    view.click(must(view.buttonNamed("Add attachment"), "Add attachment"));
    const dialog = must(sheet(view), "attachment sheet");
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const last = must(buttons[buttons.length - 1], "last sheet button");
    act(() => { last.focus(); });
    expect(document.activeElement).toBe(last);

    // The drawer's trap must not run at all: without the top-layer gate it
    // yanks focus into the drawer first and the sheet's trap pulls it back —
    // the same final element, but a focus bounce a screen reader announces.
    const nav = must(view.container.querySelector<HTMLElement>('[aria-label="FactoryLM navigation"]'), "drawer");
    let drawerFocusCalls = 0;
    // Instance-level overrides shadow whichever prototype defines focus().
    for (const element of Array.from(nav.querySelectorAll<HTMLElement>("button, a[href], [tabindex]"))) {
      const original = element.focus.bind(element);
      element.focus = () => { drawerFocusCalls += 1; original(); };
    }
    key(document, "Tab");
    expect(drawerFocusCalls).toBe(0);
    // The sheet's own trap acted: Tab from the last control wrapped to the first.
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe("safe areas and drawer scroll ownership (stylesheet contract)", () => {
  const conversation = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
  const mobileBlock = shell.slice(shell.indexOf("@media (max-width: 48rem)"));

  it("pads the composer, the drawer and the sheet with zero-capable safe-area insets", () => {
    expect(conversation).toMatch(/\.fl-composer\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
    expect(mobileBlock).toMatch(/\.fl-shell__sidebar\s*\{[^}]*env\(safe-area-inset-top,\s*0px\)/s);
    expect(mobileBlock).toMatch(/\.fl-shell__sidebar\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
    expect(conversation).toMatch(/\.fl-attachment-menu\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
    expect(conversation).not.toMatch(/env\(safe-area-inset-[a-z]+\)(?!,)/);
  });

  it("gives the main column an explicit minmax(0, 1fr) track so it can never size to the composer's min-content", () => {
    // CI runs this suite but not the lab e2e; with the implicit `auto` track
    // the main area measured 550px at a 412px viewport (Codex HOLD on 28b6137f3).
    expect(shell).toMatch(/\.fl-shell__main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  });

  it("gives the drawer's tree the scroll and keeps the footer out of it", () => {
    expect(mobileBlock).toMatch(/\.fl-shell__sidebar\s*\{[^}]*block-size:\s*100dvh/s);
    expect(shell).toMatch(/\n\.fl-shell__nav-scroll\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-block-size:\s*0;[^}]*overflow-y:\s*auto/s);
    expect(mobileBlock).toMatch(/\.fl-shell__nav-footer\s*\{[^}]*flex:\s*0 0 auto/s);
  });

  it("keeps a 44px physical floor and a 52px composer row", () => {
    expect(shell).toMatch(/\.fl-shell button\s*\{[^}]*min-block-size:\s*max\(2\.75rem,\s*44px\)/s);
    expect(conversation).toMatch(/\.fl-composer__row\s*\{[^}]*min-block-size:\s*max\(3\.25rem,\s*52px\)/s);
    expect(conversation).toMatch(/\.fl-attachment-menu__item\s*\{[^}]*min-block-size:\s*max\(3\.25rem,\s*52px\)/s);
  });

  it("uses the workspace scrim token so dark theme remaps it", () => {
    expect(shell).toMatch(/\.fl-scrim\s*\{[^}]*var\(--fl-workspace-scrim/s);
    const workspace = readFileSync(new URL("../../../factorylm-theme/src/workspace.css", import.meta.url), "utf8");
    expect(workspace).toMatch(/--fl-workspace-scrim:\s*var\(--fl-modal-scrim\)/);
    expect(workspace).toMatch(/--fl-workspace-scrim:\s*var\(--fl-dark-scrim\)/);
  });
});
