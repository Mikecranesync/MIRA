/**
 * Turning a notebook source on or off from a source list (#5456, Codex r1 on
 * #5476 F2). The checkbox is only half of what the row shows: the "will chat
 * search this" label is a SERVER projection (`deriveSearchable` in
 * lib/document-readiness.ts), so after the write the row must be re-read from
 * the server, never patched up locally. A refused or failed write puts the
 * checkbox back. Pure sequencing — the caller supplies the three effects.
 */
export interface SourceToggleEffects {
  /** Set the checkbox for this source (optimistic, and to undo). */
  setEnabled: (enabled: boolean) => void;
  /** Persist the new state. Resolves `{ ok }` from the HTTP response. */
  patch: (enabled: boolean) => Promise<{ ok: boolean }>;
  /** Re-read the source list from the server. */
  refresh: () => Promise<void>;
}

/** Returns true when the new state was persisted. Never throws. */
export async function toggleSourceEnabled(next: boolean, fx: SourceToggleEffects): Promise<boolean> {
  fx.setEnabled(next);
  let persisted = false;
  try {
    persisted = (await fx.patch(next)).ok;
  } catch {
    persisted = false;
  }
  if (!persisted) fx.setEnabled(!next);
  try {
    await fx.refresh();
  } catch {
    // The list keeps its last server state; the next load corrects it.
  }
  return persisted;
}
