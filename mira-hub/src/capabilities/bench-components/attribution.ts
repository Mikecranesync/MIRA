/**
 * Which bench component an answer is about, saved WITH the turn (#5504 Codex r2 F1).
 *
 * The header shows what the NEXT question is about; it moves whenever the
 * technician picks another component. An answer must keep the component it was
 * asked under, so the label comes from the answer's own record: the component
 * frame the stream sent before its first content byte, persisted in the turn's
 * evidence (the identity_dispute pattern). The revision table is append-only, so
 * a later correction or switch cannot change what an earlier answer says.
 *
 * No server imports: the screen reads this too.
 */
export type ComponentAttributionEntry = {
  kind: "component_attribution";
  componentId: string;
  revision: number;
  /** The selection version the frame carried, so a retry replay re-sends the same frame. */
  selectionVersion: number;
  label: string;
};

/** The saved form of a component frame (`chat-turn.componentTurnFrame`). */
export function componentAttributionEntry(frame: { componentId: string; revision: number; selectionVersion: number; label: string }): ComponentAttributionEntry {
  return { kind: "component_attribution", componentId: frame.componentId, revision: frame.revision, selectionVersion: frame.selectionVersion, label: frame.label };
}

export function isComponentAttributionEntry(e: unknown): e is ComponentAttributionEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  return (
    r.kind === "component_attribution" &&
    typeof r.componentId === "string" &&
    typeof r.revision === "number" &&
    Number.isInteger(r.selectionVersion) &&
    typeof r.label === "string" &&
    r.label.trim() !== ""
  );
}

/** The line an answer shows above its text: the component it was asked under. */
export function componentAttributionText(label: string): string {
  return `About: ${label}`;
}
