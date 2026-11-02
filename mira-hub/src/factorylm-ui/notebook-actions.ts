import type { CSSProperties } from "react";

/** The notebook's action buttons (Machine state, Work Packet) share this column below the
 *  guided-procedure pill (top 72px + its 44px + a gap), each in its own row, so no button sits on
 *  another on a phone (#5102). The buttons themselves carry no position. */
export const NOTEBOOK_ACTIONS_STYLE: CSSProperties = {
  position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 124px)", right: 12, zIndex: 40,
  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8,
};
