/**
 * The navigation drawer is a closable layer wherever it OVERLAYS the page.
 *
 * The defect these tests pin: `shell.css` turned the sidebar into a fixed,
 * page-covering overlay below 48rem for EVERY surface, while the TypeScript
 * asked `profile.kind === "mobile"`. Two languages, two different answers to
 * one question. So a narrow `public` / `web` / `hub` window opened with the
 * drawer covering the page and:
 *
 *   - no scrim, so nothing looked dismissable and tapping the page did nothing
 *   - no Escape, because `topLayer` never returned "navigation"
 *   - no hardware Back, for the same reason
 *
 * leaving only the in-drawer close button. Found while building the public
 * SimLab demo (#3815), where the browser proof failed because the drawer
 * intercepted every click on a 412px viewport; the demo host worked around it
 * by closing the drawer at mount. This is the shell-level fix that replaces
 * that workaround.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { NAVIGATION_LAYER_QUERY } from "../FactoryLMShell";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

/** happy-dom drives matchMedia off a real viewport, so this is the true query. */
function setViewport(width: number) {
  (globalThis.window as unknown as { happyDOM: { setViewport(v: { width: number }): void } })
    .happyDOM.setViewport({ width });
}

const WIDE = 1280;
const NARROW = 412;

beforeEach(() => { setViewport(WIDE); });
afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
  setViewport(WIDE);
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

const shell = (view: HarnessView) => view.container.querySelector<HTMLElement>(".fl-shell");
const scrim = (view: HarnessView) => view.container.querySelector<HTMLElement>('.fl-scrim[data-layer="navigation"]');

/**
 * Escape reaches the shell through a `document` listener, not a React handler,
 * so the dispatch must be wrapped for React to flush the resulting state.
 */
/**
 * Replace `window.matchMedia` with one list whose `change` event the test fires.
 * Restores the original so nothing leaks into the viewport-driven tests.
 */
function stubMatchMedia(initiallyMatches: boolean, api: "modern" | "legacy" = "modern") {
  const win = globalThis.window as unknown as Record<string, unknown>;
  const original = win.matchMedia;
  const listeners: ((event: MediaQueryListEvent) => void)[] = [];
  const removed: ((event: MediaQueryListEvent) => void)[] = [];
  let matches = initiallyMatches;
  const add = (fn: (event: MediaQueryListEvent) => void) => { listeners.push(fn); };
  const remove = (fn: (event: MediaQueryListEvent) => void) => {
    const at = listeners.indexOf(fn);
    if (at >= 0) listeners.splice(at, 1);
    removed.push(fn);
  };
  win.matchMedia = ((media: string) => api === "modern"
    ? {
      media,
      get matches() { return matches; },
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => add(fn),
      removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => remove(fn),
    }
    // Safari < 14 and old WebViews expose ONLY the deprecated pair. Modelled by
    // omitting the modern methods entirely, which is what those engines do.
    : {
      media,
      get matches() { return matches; },
      addListener: (fn: (event: MediaQueryListEvent) => void) => add(fn),
      removeListener: (fn: (event: MediaQueryListEvent) => void) => remove(fn),
    }) as unknown;
  return {
    listenerCount: () => listeners.length,
    removedCount: () => removed.length,
    emit(next: boolean) {
      matches = next;
      listeners.slice().forEach((fn) => fn({ matches: next } as MediaQueryListEvent));
    },
    restore() { win.matchMedia = original; },
  };
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

describe("a narrow viewport makes the drawer a layer on every surface", () => {
  for (const surface of ["public", "web", "hub"] as const) {
    it(`gives ${surface} a scrim and Escape below the breakpoint`, () => {
      setViewport(NARROW);
      const view = render({ surface, fixture: "grounded-answer" });

      expect(shell(view)?.dataset.navigationVisible).toBe("true");
      expect(shell(view)?.dataset.topLayer).toBe("navigation");
      expect(scrim(view)).not.toBeNull();
    });

    it(`closes ${surface}'s drawer on Escape below the breakpoint`, () => {
      setViewport(NARROW);
      const view = render({ surface, fixture: "grounded-answer" });
      expect(shell(view)?.dataset.navigationVisible).toBe("true");

      pressEscape();
      expect(shell(view)?.dataset.navigationVisible).toBe("false");
    });

    it(`closes ${surface}'s drawer when the scrim is clicked`, () => {
      setViewport(NARROW);
      const view = render({ surface, fixture: "grounded-answer" });
      const element = scrim(view);
      expect(element).not.toBeNull();

      view.click(element as HTMLElement);
      expect(shell(view)?.dataset.navigationVisible).toBe("false");
    });
  }
});

describe("a wide viewport leaves the static sidebar exactly as it was", () => {
  for (const surface of ["public", "web", "hub"] as const) {
    it(`gives ${surface} no navigation scrim and no Escape-to-close`, () => {
      // The sidebar is a column here, not an overlay. A scrim over a column, or
      // an Escape that collapses it, would be a regression in the other
      // direction — the fix must not make every desktop sidebar dismissable.
      const view = render({ surface, fixture: "grounded-answer" });

      expect(scrim(view)).toBeNull();
      expect(shell(view)?.dataset.topLayer).toBe("");

      pressEscape();
      expect(shell(view)?.dataset.navigationVisible).toBe("true");
    });
  }
});

describe("the phone surface is unchanged", () => {
  it("stays a layer on a wide viewport, as it has always been", () => {
    // Deliberately a superset of the stylesheet's condition. The phone host
    // drives hardware Back through `topLayer`; narrowing that here would be a
    // behaviour change smuggled into a bug fix.
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    expect(shell(view)?.dataset.topLayer).toBe("navigation");
    expect(scrim(view)).not.toBeNull();
  });

  it("stays a layer on a narrow viewport", () => {
    setViewport(NARROW);
    const view = render({ surface: "mobile", fixture: "grounded-answer" });
    expect(shell(view)?.dataset.topLayer).toBe("navigation");
    expect(scrim(view)).not.toBeNull();
  });
});

describe("the drawer follows a window being resized, without a reload", () => {
  it("gains the scrim and Escape when a desktop window is dragged narrow", () => {
    // Every other test here sets the viewport BEFORE mounting, so all of them
    // pass against a hook that samples once and never subscribes. This is the
    // one that does not: it is the difference between reading the media query
    // and tracking it.
    const view = render({ surface: "web", fixture: "grounded-answer" });
    expect(scrim(view)).toBeNull();

    act(() => { setViewport(NARROW); });

    expect(scrim(view)).not.toBeNull();
    expect(shell(view)?.dataset.topLayer).toBe("navigation");
    pressEscape();
    expect(shell(view)?.dataset.navigationVisible).toBe("false");
  });

  it("loses them again when the window is dragged wide", () => {
    /**
     * Driven through a controllable `matchMedia` rather than the viewport,
     * because happy-dom emits `change` only in ONE direction: it notifies when
     * a query starts matching (wide -> narrow) and silently does not when it
     * stops (narrow -> wide), though `matches` itself updates correctly.
     * Verified directly before writing this. The test above is the genuine
     * environment-driven proof for the direction happy-dom supports; this one
     * covers the return trip at the hook's real contract — a `change` event
     * reporting `matches: false` must put the sidebar back.
     */
    const controllable = stubMatchMedia(true);
    try {
      const view = render({ surface: "web", fixture: "grounded-answer" });
      expect(scrim(view)).not.toBeNull();

      act(() => { controllable.emit(false); });

      expect(scrim(view)).toBeNull();
      expect(shell(view)?.dataset.topLayer).toBe("");
    } finally {
      controllable.restore();
    }
  });
});

describe("an engine with only the deprecated MediaQueryList API still works", () => {
  it("subscribes through addListener and still tracks the breakpoint", () => {
    // Safari < 14 and old Android WebViews have `addListener` but not
    // `addEventListener`. Without this the fallback branch never executes in
    // any test — happy-dom provides the modern API — so it would ship as an
    // untested claim about browsers we say we support.
    const legacy = stubMatchMedia(false, "legacy");
    try {
      const view = render({ surface: "web", fixture: "grounded-answer" });
      expect(legacy.listenerCount()).toBe(1);
      expect(scrim(view)).toBeNull();

      act(() => { legacy.emit(true); });
      expect(scrim(view)).not.toBeNull();
      expect(shell(view)?.dataset.topLayer).toBe("navigation");
    } finally {
      legacy.restore();
    }
  });

  it("unsubscribes through removeListener on unmount, leaving nothing attached", () => {
    const legacy = stubMatchMedia(false, "legacy");
    try {
      const view = render({ surface: "web", fixture: "grounded-answer" });
      expect(legacy.listenerCount()).toBe(1);

      view.cleanup();
      views.splice(views.indexOf(view), 1);

      expect(legacy.removedCount()).toBe(1);
      expect(legacy.listenerCount()).toBe(0);
    } finally {
      legacy.restore();
    }
  });
});

describe("the breakpoint cannot drift between the two languages again", () => {
  it("uses the same query the stylesheet keys the overlay on", () => {
    // This is the actual root cause guard. The TypeScript and the CSS each own
    // half of one decision; if they stop agreeing, the drawer silently becomes
    // undismissable again on exactly the widths where it covers the page.
    const css = readFileSync(new URL("../shell.css", import.meta.url), "utf8");
    expect(css).toContain("@media " + NAVIGATION_LAYER_QUERY + " {");

    const overlayBlock = css.slice(css.indexOf("@media " + NAVIGATION_LAYER_QUERY));
    expect(overlayBlock).toMatch(/\.fl-shell__sidebar\s*\{[^}]*position:\s*fixed/);
  });
});
