/**
 * #4061 — give the answer the technician JUST received its server turn id.
 *
 * A live answer is rendered as `live-<i>-a` (the frozen chat adapter owns that
 * naming), so `serverTurnIdFor` returns null and the answer offers no "Record
 * what fixed it" button until the notebook is reopened. The Hub closes this by
 * re-reading the persisted row after the stream; this is the same move for the
 * unified shell, kept inside the canonical adapter root.
 *
 * The stream's `trace` frame is NOT a substitute: its `turnId` is the client
 * request id (not `equipment_notebook_turns.id`, which POST /fixes requires as
 * `sourceTurnId`), and it is only sent when tracing is enabled.
 *
 * Pure: pairs live answered turns with newly persisted server rows by question
 * text, oldest first. Anything it cannot pair stays unmapped (no button) —
 * never guessed.
 */

export interface LiveTurnLike {
  readonly q: string;
  readonly a: { readonly status: string };
}

export interface PersistedTurnLike {
  readonly id: string;
  readonly question: string;
  readonly answerStatus: string;
  readonly threadId?: string;
  readonly createdAt?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** `live-<i>-a` → persisted row id, for live answers that have a persisted
 *  answered row this shell has not already rendered from the server. */
export function mapLiveAnswersToServerIds(
  liveTurns: readonly LiveTurnLike[],
  persisted: readonly PersistedTurnLike[],
  opts: { readonly alreadyRendered: ReadonlySet<string>; readonly threadId?: string | null },
): Map<string, string> {
  const candidates = persisted
    .map((t, order) => ({ t, order }))
    .filter(
      ({ t }) =>
        UUID.test(t.id) &&
        t.answerStatus === "answered" &&
        !opts.alreadyRendered.has(t.id.toLowerCase()) &&
        (!opts.threadId || !t.threadId || t.threadId === opts.threadId),
    )
    .sort((x, y) => {
      const byTime = (x.t.createdAt ?? "").localeCompare(y.t.createdAt ?? "");
      return byTime !== 0 ? byTime : x.order - y.order;
    })
    .map(({ t }) => t);

  const used = new Set<string>();
  const out = new Map<string, string>();
  liveTurns.forEach((turn, i) => {
    if (turn.a.status !== "answered") return;
    const q = norm(turn.q);
    const hit = candidates.find((c) => !used.has(c.id) && norm(c.question) === q);
    if (!hit) return;
    used.add(hit.id);
    out.set(`live-${i}-a`, hit.id.toLowerCase());
  });
  return out;
}

/** Live answers that are answered but not yet mapped — the trigger for a
 *  re-read. Empty means there is nothing to fetch. */
export function unmappedLiveAnswers(liveTurns: readonly LiveTurnLike[], mapped: ReadonlyMap<string, string>): string[] {
  return liveTurns
    .map((t, i) => ({ t, id: `live-${i}-a` }))
    .filter(({ t, id }) => t.a.status === "answered" && !mapped.has(id))
    .map(({ id }) => id);
}

/** Identity of the live-turn list a mapping was computed for. `live-<i>-a`
 *  ids restart at 0 in every thread, so a mapping is only valid while the
 *  notebook, thread and live questions it was built from are unchanged. */
export function liveTurnsSignature(
  notebookId: string | null | undefined,
  threadId: string | null | undefined,
  liveTurns: readonly LiveTurnLike[],
): string {
  return JSON.stringify([notebookId ?? "", threadId ?? "", liveTurns.map((t) => [norm(t.q), t.a.status])]);
}
