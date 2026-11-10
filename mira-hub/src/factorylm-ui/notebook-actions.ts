import type { CSSProperties } from "react";

/** The notebook's action buttons (Machine state, Work Packet) share this column below the
 *  guided-procedure pill (top 72px + its 44px + a gap), each in its own row, so no button sits on
 *  another on a phone (#5102). The buttons themselves carry no position. */
export const NOTEBOOK_ACTIONS_STYLE: CSSProperties = {
  position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 124px)", right: 12, zIndex: 40,
  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8,
};

/** #5372: the source viewer is a modal dialog drawn below these floating controls (z-index 5 vs
 *  40), so on a phone the column and the guided-procedure pill covered its header and Close button.
 *  While a source is open they are hidden, not unmounted, so the pending-manuals panel keeps its
 *  upload and polling state. `display` is set here because the column's inline `display: flex`
 *  would override a `hidden` attribute. */
export function notebookActionsStyle(sourceOpen: boolean): CSSProperties {
  return sourceOpen ? { ...NOTEBOOK_ACTIONS_STYLE, display: "none" } : NOTEBOOK_ACTIONS_STYLE;
}

/** #5372: wrapper for the guided-procedure pill; hides it while a source is open, without
 *  unmounting it. The wrapper itself takes no space (`display: contents`). */
export function floatingControlsWrapperStyle(sourceOpen: boolean): CSSProperties {
  return { display: sourceOpen ? "none" : "contents" };
}
