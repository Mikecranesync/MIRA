/**
 * #5102: the notebook action buttons (Machine state, Work Packet) are laid out by the host's
 * notebook-actions column, each in its own row. A button that positions itself again would sit on
 * the other one — the overlap a Pixel 9a measurement found (Machine state y 124–168, Work Packet
 * y 128–172) before this layout.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { floatingControlsWrapperStyle, NOTEBOOK_ACTIONS_STYLE, notebookActionsStyle } from "./notebook-actions";
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
 * #5372: the source viewer (a modal dialog, z-index 5) was drawn under the notebook controls
 * (z-index 40); on a 412 px phone the Job sheet button sat on the viewer's Close button.
 */
describe("floating notebook controls step aside for the source viewer (#5372)", () => {
  it("the actions column is hidden while a source is open, keeping the rest of its layout", () => {
    expect(notebookActionsStyle(true)).toEqual({ ...NOTEBOOK_ACTIONS_STYLE, display: "none" });
  });
  it("control: the actions column is unchanged while no source is open", () => {
    expect(notebookActionsStyle(false)).toEqual(NOTEBOOK_ACTIONS_STYLE);
    expect(notebookActionsStyle(false).display).toBe("flex");
  });
  it("the guided-procedure wrapper is hidden while a source is open and takes no box otherwise", () => {
    expect(floatingControlsWrapperStyle(true)).toEqual({ display: "none" });
    expect(floatingControlsWrapperStyle(false)).toEqual({ display: "contents" });
  });
  it("the host wires both to the open source and still mounts the panels (hidden, not unmounted)", () => {
    const src = readFileSync(join(__dirname, "hub-host.tsx"), "utf8");
    expect(src).toMatch(/const sourceOpen = view\.selectedSource != null;/);
    expect(src).toMatch(/data-testid="notebook-actions" style=\{notebookActionsStyle\(sourceOpen\)\}/);
    expect(src).toMatch(/data-testid="guided-procedure-slot" style=\{floatingControlsWrapperStyle\(sourceOpen\)\}/);
    expect(src).not.toMatch(/!sourceOpen &&/);
  });
});
