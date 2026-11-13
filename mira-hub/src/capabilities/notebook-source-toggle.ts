/**
 * Turning a notebook source on or off from a source list (#5456, Codex r1 on
 * #5476 F2). The checkbox is only half of what the row shows: the "will chat
 * search this" label is a SERVER projection (`deriveSearchable` in
 * lib/document-readiness.ts), so after the write the row must be re-read from
 * the server, never patched up locally. A refused or failed write puts the
 * checkbox back — and then the re-read decides: whatever the server says this
 * source's state is, the checkbox takes it (Codex r2 F2: a write can commit
 * and still lose its response, so a transport failure is "unknown", not "no").
 * Pure sequencing — the caller supplies the effects.
 */
export interface SourceToggleEffects {
  /** Set the checkbox for this source (optimistic, to undo, and to reconcile). */
  setEnabled: (enabled: boolean) => void;
  /** Persist the new state. Resolves `{ ok }` from the HTTP response. */
  patch: (enabled: boolean) => Promise<{ ok: boolean }>;
  /**
   * Re-read the source list from the server. Resolves this source's persisted
   * on/off state, or nothing when the re-read cannot say (source not listed).
   */
  refresh: () => Promise<boolean | undefined | void>;
  /**
   * False once a newer toggle of the same source has started. This call then
   * stops touching the checkbox — the newer one owns it. Defaults to true.
   */
  isLatest?: () => boolean;
}

/** Returns true when the server holds the new state. Never throws. */
export async function toggleSourceEnabled(next: boolean, fx: SourceToggleEffects): Promise<boolean> {
  const owns = () => (fx.isLatest ? fx.isLatest() : true);
  fx.setEnabled(next);
  let persisted = false;
  try {
    persisted = (await fx.patch(next)).ok;
  } catch {
    persisted = false;
  }
  let shown = next;
  if (!persisted && owns()) {
    fx.setEnabled(!next);
    shown = !next;
  }
  let server: boolean | undefined;
  try {
    const read = await fx.refresh();
    if (typeof read === "boolean") server = read;
  } catch {
    // The list keeps its last server state; the next load corrects it.
  }
  if (server === undefined) return persisted;
  if (server !== shown && owns()) fx.setEnabled(server);
  return server === next;
}

/**
 * What a re-read source list says about one source's on/off state — the same
 * rule the page seeds its checkboxes with (a rejected source is never on).
 * Undefined when the source is not in the list.
 */
export function persistedEnabled(
  sources: ReadonlyArray<{ docId: string; enabledByDefault: boolean; matchState?: string | null }>,
  docId: string,
): boolean | undefined {
  const row = sources.find((s) => s.docId === docId);
  if (!row) return undefined;
  return row.enabledByDefault && row.matchState !== "rejected";
}
