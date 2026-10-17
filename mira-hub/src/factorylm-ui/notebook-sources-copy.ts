/**
 * Copy for an equipment notebook's source count. Until the detail GET
 * settles, the count is unknown — never report "0 of 0 sources", which is
 * indistinguishable from a loaded empty notebook (#4371).
 *
 * Same pattern as `(hub)/schedule/schedule-empty.ts`: empty is only empty
 * once loading has settled.
 */

export const SOURCES_LOADING_LABEL = "Loading sources…";
export const SOURCES_LOADING_BUTTON = "…";
export const SOURCES_LOADING_GROUNDING = "Loading this notebook's sources…";

/** Header subtitle: "N of M sources", or a loading line while unknown. */
export function notebookSourcesCountLine(known: boolean, enabled: number, usable: number): string {
  if (!known) return SOURCES_LOADING_LABEL;
  return `${enabled} of ${usable} sources`;
}

/** Sources-sheet trigger: "N/M", or an ellipsis while unknown. */
export function notebookSourcesButtonCount(known: boolean, enabled: number, usable: number): string {
  if (!known) return SOURCES_LOADING_BUTTON;
  return `${enabled}/${usable}`;
}
