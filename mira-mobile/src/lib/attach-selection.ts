// Pure selection logic behind AttachFileSheet — kept out of the component so
// the rule that matters ("a retry must not create duplicate links") is
// unit-testable without a DOM.
//
// The server's POST /api/files/{id}/links/ is idempotent, but idempotency on
// the server only helps if the CLIENT sends the same request twice rather than
// two different ones. So request building here is deterministic: same selection
// in, byte-identical target list out, regardless of tap order.

/** The server's LINK_TARGET_TYPES verbatim (mira-hub/src/lib/workspace-files.ts).
 *  These strings go on the wire — do NOT prettify them here; the UI labels
 *  live in SEGMENTS/TARGET_TITLES where they belong. */
export type AttachTargetType =
  | "cmms_asset"
  | "equipment_notebook"
  | "namespace_node"
  | "work_order";

export interface AttachTarget {
  targetType: AttachTargetType;
  targetId: string;
  label: string;
  sublabel?: string | null;
}

export interface ExistingAttachment {
  linkId: string;
  targetType: string;
  targetId: string;
}

/** Stable identity of a destination across both lists. */
export function targetKey(t: { targetType: string; targetId: string }): string {
  return `${t.targetType}:${t.targetId}`;
}

/** Destinations the file is ALREADY filed under — rendered pre-checked. */
export function existingKeys(existing: ExistingAttachment[]): string[] {
  return Array.from(new Set(existing.map(targetKey))).sort();
}

/** Multi-select: toggling accumulates rather than replacing. */
export function toggleSelection(selection: string[], key: string): string[] {
  const set = new Set(selection);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return Array.from(set).sort();
}

export function isSelected(selection: string[], key: string): boolean {
  return selection.includes(key);
}

/** Newly-chosen destinations only (already-filed ones are a no-op), de-duped.
 *  The dedupe is not theoretical: two identical targets in ONE request is the
 *  same duplicate-link risk the idempotency key exists to prevent. */
export function newSelections(selection: string[], existing: ExistingAttachment[]): string[] {
  const have = new Set(existingKeys(existing));
  return Array.from(new Set(selection)).filter((k) => !have.has(k)).sort();
}

export function attachCount(selection: string[], existing: ExistingAttachment[]): number {
  return newSelections(selection, existing).length;
}

/** Final action label. Counts DESTINATIONS, never files. */
export function attachActionLabel(selection: string[], existing: ExistingAttachment[]): string {
  const n = attachCount(selection, existing);
  return n === 1 ? "Attach to 1 place" : `Attach to ${n} places`;
}

export interface AttachRequestTarget {
  targetType: string;
  targetId: string;
  role?: string;
}

/** Deterministic request body: sorted, de-duplicated, existing links excluded.
 *  Building it twice from the same selection yields the same list, so a retry
 *  replays an identical (idempotent) request. */
export function buildAttachRequest(
  selection: string[],
  existing: ExistingAttachment[],
  roleFor?: (t: { targetType: string; targetId: string }) => string | undefined,
): AttachRequestTarget[] {
  return newSelections(selection, existing).map((key) => {
    const i = key.indexOf(":");
    const t = { targetType: key.slice(0, i), targetId: key.slice(i + 1) };
    const role = roleFor?.(t);
    return role ? { ...t, role } : t;
  });
}
