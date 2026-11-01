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
