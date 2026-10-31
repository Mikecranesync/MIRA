/**
 * A silent thread reload (#3990: the app returns to the foreground after the
 * same thread was continued on web) brings back, as persisted rows, the turns
 * this session asked and still holds as live turns. Rendering both would show
 * each phone turn twice.
 *
 * #4639: a live turn is "now persisted" when a row carries the request id this
 * phone minted for it. Question text alone cannot tell a phone turn from the
 * same question asked on web, and matching on it silently deleted the phone's
 * unsaved answer. A row that exposes the field (string or null) is matched by
 * id only; a null id is a request sent without one, never this phone's turn.
 *
 * Rows from a Hub that predates the field (`clientRequestId` absent) fall back
 * to the old rule, tightened: a row that was NOT in the previous load, with the
 * same question AND the same answer text, consumes at most one live turn, in
 * order. A live turn with no such row (never saved) stays — when in doubt the
 * turn shows twice rather than disappearing.
 *
 * `getNotebookDetail` passes the Hub's turn rows through unchanged, so the id
 * arrives on `NotebookDetail.turns` without a decoder change; it is declared
 * here, on the input this helper reads.
 */
export interface ReconcileRow {
  id: string;
  question: string;
  answerText: string | null;
  clientRequestId?: string | null;
}

export function dropPersistedLiveTurns<L extends { q: string; requestId?: string; a: { answer: string } }>(
  previousRowIds: ReadonlySet<string>,
  rows: readonly ReconcileRow[],
  live: readonly L[],
): L[] {
  const savedIds = new Set(rows.map((r) => r.clientRequestId).filter((id): id is string => Boolean(id)));
  const legacy = rows.filter((r) => r.clientRequestId === undefined && !previousRowIds.has(r.id));
  return live.filter((t) => {
    if (t.requestId !== undefined && savedIds.has(t.requestId)) return false;
    const i = legacy.findIndex((r) => r.question === t.q && (r.answerText ?? "") === t.a.answer);
    if (i < 0) return true;
    legacy.splice(i, 1);
    return false;
  });
}
