/**
 * F004 M2/M3 (#4303): resolve a "Get general guidance (not from the manual)"
 * tap on a shell answer turn to what the phone sends: the ORIGINAL question,
 * asked again in general mode, linked to the failed turn.
 *
 * - A saved answer (`<row id>-a`) links by its row id.
 * - A live answer (`live-<n>-a`, the n-th entry of the host's live turns —
 *   `turns-to-parts.ts`'s `liveTurnMessages` numbering) has no row id yet; it
 *   links by the request id it was sent with, which the server resolves to
 *   the same row inside the caller's own tenant, notebook, owner and thread.
 *
 * Null when the turn can't be resolved — never a guess.
 */
export interface GeneralGuidanceTarget {
  readonly question: string;
  readonly fallbackOf: string;
}

export function generalGuidanceTarget(
  shellTurnId: string,
  saved: readonly { readonly id: string; readonly question: string }[],
  live: readonly { readonly q: string; readonly requestId?: string }[],
): GeneralGuidanceTarget | null {
  const liveMatch = /^live-(\d+)-a$/.exec(shellTurnId);
  if (liveMatch) {
    const turn = live[Number(liveMatch[1])];
    return turn?.requestId && turn.q.trim() ? { question: turn.q, fallbackOf: turn.requestId } : null;
  }
  const rowId = /^(.+)-a$/.exec(shellTurnId)?.[1];
  const row = rowId ? saved.find((t) => t.id === rowId) : undefined;
  return row && row.question.trim() ? { question: row.question, fallbackOf: row.id } : null;
}
