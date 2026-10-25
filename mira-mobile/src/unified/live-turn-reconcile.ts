/**
 * A silent thread reload (#3990: the app returns to the foreground after the
 * same thread was continued on web) brings back, as persisted rows, the turns
 * this session asked and still holds as live turns. Rendering both would show
 * each phone turn twice. Live turns carry no server id, so a live turn is
 * "now persisted" when a row that was NOT in the previous load asks the same
 * question — each new row consumes at most one live turn, in order. A live
 * turn with no such row (never saved, e.g. a local-only failure) stays.
 */
export function dropPersistedLiveTurns<L extends { q: string }>(
  previousRowIds: ReadonlySet<string>,
  rows: readonly { id: string; question: string }[],
  live: readonly L[],
): L[] {
  const fresh = rows.filter((r) => !previousRowIds.has(r.id)).map((r) => r.question);
  return live.filter((t) => {
    const i = fresh.indexOf(t.q);
    if (i < 0) return true;
    fresh.splice(i, 1);
    return false;
  });
}
