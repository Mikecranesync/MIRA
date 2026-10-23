/**
 * Copy for an equipment notebook's source count. Until the count is known,
 * never report "Sources (0)" / an empty-sources grounding line — that is
 * indistinguishable from a loaded notebook with nothing attached (#4371).
 *
 * Hub counterpart: mira-hub/src/factorylm-ui/notebook-sources-copy.ts
 * (duplicated on purpose; Hub cannot import the mobile file).
 */

export const SOURCES_LOADING_GROUNDING = "Loading this notebook's sources…";
export const SOURCES_LOADING_DRAWER = "Sources (…)";

/** Drawer row. `null` means the list has not yet given a count. */
export function sourcesDrawerLabel(sourceCount: number | null): string {
  if (sourceCount === null) return SOURCES_LOADING_DRAWER;
  return `Sources (${sourceCount})`;
}

/** First-run grounding line under the greeting. */
export function notebookGroundingLine(args: { sourcesKnown: boolean; enabledCount: number }): string {
  if (!args.sourcesKnown) return SOURCES_LOADING_GROUNDING;
  if (args.enabledCount === 0) {
    return "Ask general questions now, or scan a machine to ground the notebook.";
  }
  return "Answers cite this notebook's selected manuals.";
}
