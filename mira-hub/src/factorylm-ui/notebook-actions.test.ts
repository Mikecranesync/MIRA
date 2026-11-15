/**
 * #5102: the notebook action buttons (Machine state, Work Packet) are laid out by the host's
 * notebook-actions column, each in its own row. A button that positions itself again would sit on
 * the other one — the overlap a Pixel 9a measurement found (Machine state y 124–168, Work Packet
 * y 128–172) before this layout.
 */
import { describe, expect, it } from "vitest";
import { NOTEBOOK_ACTIONS_STYLE } from "./notebook-actions";
import { OBS_PILL_STYLE } from "./MachineObservations";
import { WP_PILL_STYLE } from "./WorkPacketPanel";

describe("notebook action buttons share one column (#5102)", () => {
  it("the host column stacks its buttons vertically with a gap", () => {
    expect(NOTEBOOK_ACTIONS_STYLE).toMatchObject({ position: "absolute", display: "flex", flexDirection: "column" });
    expect(Number(NOTEBOOK_ACTIONS_STYLE.gap)).toBeGreaterThan(0);
  });
  for (const [name, style] of [["Machine state", OBS_PILL_STYLE], ["Work Packet", WP_PILL_STYLE]] as const) {
    it(`the ${name} button flows in the column instead of placing itself`, () => {
      expect(style.position).toBeUndefined();
      expect(style.top).toBeUndefined();
      expect(style.right).toBeUndefined();
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    });
  }
});

/**
 * #5546: on a phone the open navigation drawer sat under the action column (zIndex 40), and the
 * column's box — as wide as its widest chip since #5504 — took the taps meant for "New project",
 * Search and the first project rows. While a layer covers the page the column is hidden and takes
 * no taps; it stays mounted so an unresolved component-selection write survives.
 */
import { readFileSync } from "node:fs";
import { actionsCoveredByLayer, notebookActionsStyle } from "./notebook-actions";

describe("the action column stays off an open layer (#5546)", () => {
  it("nothing open: shown", () => {
    expect(actionsCoveredByLayer(null, true)).toBe(false);
    expect(actionsCoveredByLayer(null, false)).toBe(false);
  });
  it("the navigation drawer covers the page only when it is layered (phone / narrow)", () => {
    expect(actionsCoveredByLayer("navigation", true)).toBe(true);
    expect(actionsCoveredByLayer("navigation", false)).toBe(false);
  });
  it("the inspector covers the page only when layered; a desktop inspector sits beside it", () => {
    expect(actionsCoveredByLayer("inspector", true)).toBe(true);
    expect(actionsCoveredByLayer("inspector", false)).toBe(false);
  });
  it("the source viewer and the attachment menu always cover the page", () => {
    for (const layered of [true, false]) {
      expect(actionsCoveredByLayer("source", layered)).toBe(true);
      expect(actionsCoveredByLayer("attachment-menu", layered)).toBe(true);
    }
  });
  it("covered: hidden and takes no taps, still laid out (not unmounted)", () => {
    const s = notebookActionsStyle(true);
    expect(s.visibility).toBe("hidden");
    expect(s.pointerEvents).toBe("none");
    expect(s.display).toBe("flex");
  });
  it("not covered: the unchanged column", () => {
    expect(notebookActionsStyle(false)).toBe(NOTEBOOK_ACTIONS_STYLE);
  });
  it("the host renders the column with the covered style, keyed on the shell's own top layer", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    expect(host).toMatch(/actionsCoveredByLayer\(layers\.top,/);
    expect(host).toMatch(/data-testid="notebook-actions"[^>]*style=\{notebookActionsStyle\(actionsCovered\)\}/);
    expect(host).not.toMatch(/style=\{NOTEBOOK_ACTIONS_STYLE\}/);
  });
});
