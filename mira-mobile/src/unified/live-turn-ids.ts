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
 * text, oldest first, only when the pairing is one-to-one per question.
 * Anything it cannot pair with certainty stays unmapped (no button) — never
 * guessed.
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

  // Identity rule (Codex #4073 F1): rows carry no request id, so a pairing is
  // only sound when, for a question, the new persisted rows and this screen's
  // answered live turns correspond one-to-one. Another device's same-question
  // row (one row too many) or a row outside the API's 50-turn window (one too
  // few) makes that question ambiguous — it maps nothing and offers no button.
  const byQuestion = new Map<string, PersistedTurnLike[]>();
  for (const c of candidates) {
    const q = norm(c.question);
    byQuestion.set(q, [...(byQuestion.get(q) ?? []), c]);
  }
  const liveByQuestion = new Map<string, number[]>();
  liveTurns.forEach((turn, i) => {
    if (turn.a.status !== "answered") return;
    const q = norm(turn.q);
    liveByQuestion.set(q, [...(liveByQuestion.get(q) ?? []), i]);
  });
  const out = new Map<string, string>();
  for (const [q, indexes] of liveByQuestion) {
    const rows = byQuestion.get(q) ?? [];
    if (rows.length !== indexes.length) continue;
    indexes.forEach((i, k) => out.set(`live-${i}-a`, rows[k].id.toLowerCase()));
  }
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

/** Codex #4073 F2: a failed re-read is retried a bounded number of times while
 *  the same live list is on screen, then left alone (reopen still works). */
const LOOKUP_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;
export function nextLookupDelayMs(failedAttempts: number): number | null {
  return LOOKUP_RETRY_DELAYS_MS[failedAttempts - 1] ?? null;
}
