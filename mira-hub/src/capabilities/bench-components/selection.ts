// Which bench component is this conversation asking about? (Mike 2026-11-14)
//
// A machine notebook holds several components' documents. Until now the only
// way to say which unit a question was about was to type it ("the GS11N-20P2",
// "ok back to mine"), and every way of typing it was a parser case. Here the
// technician picks the component (or taps "Return to <component>" after a
// refusal) and the server stores that choice for the conversation. Nothing is
// typed into the message for a parser to read.
//
// What the stored choice does for a question, and nothing more:
//  - the component's CONFIRMED identity is the record the existing manual
//    check judges against (notebook-manual-identity.ts shape), so its
//    sibling and other-product rules apply unchanged;
//  - the choice is a boundary: only questions asked under this choice (same
//    component, same identity revision, after it was made) are read for the
//    "still about the same model" carry (conversation-subject.ts). A Return
//    therefore ends a refused sibling's carry without any wording rule.
//
// It never selects documents, never widens the gate and never confirms an
// identity on its own. Pure: no database, no clock, no network.

import { historyFromSavedTurns, type SavedTurnText } from "@/capabilities/conversation-history";
import { readSubject, type PriorTurn, type SubjectRead } from "@/capabilities/conversation-subject";
import { sanitizeHistory, type ChatHistoryTurn } from "@/lib/notebook-query";
import type { ManualIdentity } from "@/capabilities/notebook-manual-identity";

export type ComponentIdentityStatus = "unknown" | "candidate" | "user_confirmed";

/** How a revision's fields reached the record. */
export type ComponentInputKind = "typed" | "photo" | "schedule" | "inventory";

/** One identity revision of one component (append-only; a correction is a new revision). */
export type ComponentRevision = {
  componentId: string;
  revision: number;
  /** What the label or the technician said, verbatim. Never normalized. */
  rawLabel: string | null;
  inputKind: ComponentInputKind;
  manufacturer: string | null;
  family: string | null;
  catalogNumber: string | null;
  serialNumber: string | null;
  hardwareRevision: string | null;
  localTag: string | null;
  identityStatus: ComponentIdentityStatus;
  /** Fields the technician marked "Not sure". Kept, never filled in. */
  unresolved: string[];
  confirmedAt: string | null;
  createdAt: string;
};

/** The conversation's stored choice. */
export type SelectedComponent = {
  componentId: string;
  /** The identity revision the choice was made under. */
  revision: number;
  /** When the choice was made; every explicit pick or Return moves it. */
  selectedAt: string;
};

/** A stored turn as the carry read needs it (listTurns row + the component it was asked under). */
export type SelectionTurn = PriorTurn & {
  createdAt: string;
  componentId: string | null;
  componentRevision: number | null;
};

const text = (value: string | null | undefined) => value?.trim() || null;

/**
 * The record the manual check judges against while this component is selected.
 * Same shape as notebookManualIdentity, so the route spreads it into both
 * retrieveNodeChunks calls exactly as before. The family is the model when it
 * is known; otherwise the catalog number is. Nothing is inferred.
 */
export function componentManualIdentity(rev: ComponentRevision): ManualIdentity {
  return {
    identity: { manufacturer: text(rev.manufacturer), model: text(rev.family) ?? text(rev.catalogNumber) },
    catalogNumber: text(rev.catalogNumber),
    identityStatus: rev.identityStatus,
  };
}

/**
 * Why manuals may not answer for this component yet, or null when they may.
 *  - not_confirmed: nobody has confirmed what it is (or it was added without a description);
 *  - no_model: confirmed, but with neither family nor catalog number, so no manual
 *    can be checked against it (a maker name alone matches every document of that maker).
 */
export function componentManualsBlocked(rev: ComponentRevision | null): "not_confirmed" | "no_model" | null {
  if (!rev || rev.identityStatus !== "user_confirmed") return "not_confirmed";
  if (!text(rev.family) && !text(rev.catalogNumber)) return "no_model";
  return null;
}

/**
 * The open questions of this conversation that the next question may still be
 * about, read only from turns asked under the current selection.
 *
 * `turns` is listTurns' window (newest `limit` completed turns, OLDEST FIRST).
 * The turns asked under this selection are the newest ones after `selectedAt`
 * with the same component and revision. When the window holds any turn outside
 * that run, the start of the run was seen, so the read is complete. Otherwise
 * the ordinary widening rule applies unchanged.
 */
/**
 * An ISO instant in microseconds since the epoch. Date.parse keeps milliseconds
 * only, so the digits after the third are read here: a turn in the same
 * millisecond as a pick is still exactly before or after it.
 */
export function instantMicros(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.NaN;
  const frac = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(iso)?.[1] ?? "";
  return ms * 1000 + Number((frac + "000000").slice(3, 6));
}

export function readSubjectUnderSelection(turns: readonly SelectionTurn[], limit: number, selection: SelectedComponent): SubjectRead {
  const since = instantMicros(selection.selectedAt);
  const under = (t: SelectionTurn) =>
    t.componentId === selection.componentId && t.componentRevision === selection.revision && instantMicros(t.createdAt) > since;
  let start = turns.length;
  while (start > 0 && under(turns[start - 1])) start--;
  const run = turns.slice(start);
  if (start > 0) return readSubject(run, Number.POSITIVE_INFINITY);
  return readSubject(run, limit);
}

/**
 * What a turn under a selected component may see of the conversation before it:
 * only the turns the server saved under this selection (the same rule as the
 * carry above), each contributing what the screen would (conversation-history
 * historyFromSavedTurns). The client's history is plain text with no turn ids or
 * component, so under a component it is never read (#5504 Codex r2 F2): a stale
 * screen cannot carry another component's conversation, and no saved turn under
 * the selection carries nothing. `turnIds` scopes the prior technician reports
 * the same way. Explicit numbers in the new question still reach retrieval: only
 * implicit carry from another component is dropped.
 */
export function historyUnderSelection(
  turns: readonly (SelectionTurn & SavedTurnText & { id: string; clientRequestId?: string | null })[],
  selection: SelectedComponent,
  currentRequestId: string | null,
): { history: ChatHistoryTurn[]; turnIds: Set<string> } {
  const since = instantMicros(selection.selectedAt);
  const run = turns.filter(
    (t) =>
      t.componentId === selection.componentId &&
      t.componentRevision === selection.revision &&
      instantMicros(t.createdAt) > since &&
      (currentRequestId === null || t.clientRequestId !== currentRequestId),
  );
  return { history: sanitizeHistory(historyFromSavedTurns(run)), turnIds: new Set(run.map((t) => t.id)) };
}

/**
 * What an explicit whole-machine question may see of the conversation before it: only the
 * saved turns asked about the whole machine (no component), by the same saved-turn rule as
 * above. A component's answers never carry into a whole-machine question (#5504 follow-up
 * "whole-machine questions inherit component history"), and `turnIds` scopes prior reports
 * and photo recall the same way.
 */
export function historyForWholeMachine(
  turns: readonly (SelectionTurn & SavedTurnText & { id: string; clientRequestId?: string | null })[],
  currentRequestId: string | null,
): { history: ChatHistoryTurn[]; turnIds: Set<string> } {
  const run = turns.filter((t) => t.componentId === null && (currentRequestId === null || t.clientRequestId !== currentRequestId));
  return { history: sanitizeHistory(historyFromSavedTurns(run)), turnIds: new Set(run.map((t) => t.id)) };
}
