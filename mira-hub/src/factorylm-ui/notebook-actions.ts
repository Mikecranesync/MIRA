import type { CSSProperties } from "react";
import type { topLayer } from "@factorylm/ui";

/** The notebook's action buttons (Machine state, Work Packet) share this column below the
 *  guided-procedure pill (top 72px + its 44px + a gap), each in its own row, so no button sits on
 *  another on a phone (#5102). The buttons themselves carry no position.
 *
 *  The column is as wide as its widest row (the open equipment panel) and as tall as all its rows,
 *  so on a tablet with the panel open its box reaches down over the chat composer. Its own empty
 *  area therefore takes no taps; only its rows do (NOTEBOOK_ACTIONS_CSS), so Send under that empty
 *  area stays tappable (#5658, #5667). */
export const NOTEBOOK_ACTIONS_STYLE: CSSProperties = {
  position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 124px)", right: 12, zIndex: 40,
  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, pointerEvents: "none",
};

/** Gives the column's rows their taps back. Not while the column is covered by a layer: then it is
 *  hidden and every row takes no taps either (#5546). Rendered once inside the column. */
export const NOTEBOOK_ACTIONS_CSS =
  '[data-testid="notebook-actions"]:not([data-covered]) > * { pointer-events: auto; }';

/**
 * #5546: the column floats beside the shell at zIndex 40, above the shell's own layers (drawer 1,
 * sheets 2–3, source 5). While a layer covers the page it must neither show over that layer nor take
 * its taps. "Covers the page" is exactly where the shell draws a scrim: the source viewer, the
 * attachment menu, and the inspector or navigation drawer when they are layered (phone profile or a
 * narrow viewport). A desktop inspector or sidebar sits beside the page and covers nothing.
 */
export function actionsCoveredByLayer(top: ReturnType<typeof topLayer>, layered: boolean): boolean {
  if (top === null) return false;
  if (top === "inspector" || top === "navigation") return layered;
  return true;
}

/** The column's style for the current layer state. Hidden, not unmounted: the component checklist
 *  keeps an unresolved selection write in its own state, which must survive the drawer opening. */
export function notebookActionsStyle(covered: boolean): CSSProperties {
  return covered ? { ...NOTEBOOK_ACTIONS_STYLE, visibility: "hidden", pointerEvents: "none" } : NOTEBOOK_ACTIONS_STYLE;
}
