/**
 * The i3X exposure gate — only human-approved context reaches the surface.
 *
 * Two complementary, FAIL-CLOSED filters (architecture doc §8):
 *   1. Entities/relationships: expose only `approval_state = 'verified'`
 *      (Hub migration 029 added `approval_state`, default 'proposed').
 *   2. Values: expose only readings whose UNS path is on the `approved_tags`
 *      allowlist (Hub migration 035, FAIL-CLOSED at ingest). This is
 *      defense-in-depth: even if a disabled tag lingers in live_signal_cache,
 *      the projection refuses to surface it.
 *
 * Anything not explicitly approved is hidden. `proposed` is never exposed.
 */

/** The one approval_state value an entity/relationship may have to be exposed. */
export const EXPOSABLE_APPROVAL_STATE = "verified" as const;

export interface HasApprovalState {
  approval_state?: string | null;
}

/** True iff this entity/relationship is verified (fail-closed on missing state). */
export function isExposable(row: HasApprovalState): boolean {
  return row.approval_state === EXPOSABLE_APPROVAL_STATE;
}

/** Keep only verified rows. */
export function filterExposable<T extends HasApprovalState>(rows: T[]): T[] {
  return rows.filter(isExposable);
}

/** Keep only readings whose `uns_path` is on the approved-tags allowlist. */
export function filterApprovedTags<T extends { uns_path?: string | null }>(
  rows: T[],
  allowlist: Set<string>,
): T[] {
  return rows.filter((r) => typeof r.uns_path === "string" && allowlist.has(r.uns_path));
}
