// Which earlier questions of this conversation is the next question still about?
//
// Seen on screen 2026-11-10 (local walk, stand-in answers): a technician typed
// "The plate reads AutomationDirect GS11N-20P2. It will not start." in a
// notebook holding only a controller's sheet. That was refused. The next
// question, "What supply voltage does it need?", names no model — and was
// answered from the controller sheet, marked grounded. "It" was the drive.
//
// A question that was NOT answered from a document leaves its subject open: a
// follow-up that names no model is still about it. A question that WAS
// answered from a document closes it — the manual applied, and what follows is
// an ordinary follow-up.
//
// Pure: stored turns in, question texts out. No model, no network, no clock.

export type PriorTurn = {
  question?: string | null;
  answerStatus?: string | null;
  basis?: string | null;
};

/** An answer that came from a document. Everything else — a refusal, a safety
 *  stop (stored "answered" with no basis), general reasoning, machine history,
 *  an error — leaves the subject of its question open. */
const DOCUMENT_BASES: ReadonlySet<string> = new Set(["workspace_evidence", "oem_documentation"]);

/**
 * How many turns to read, widening only while the open run has no start in
 * sight. The first step is the ordinary case: one small read. A conversation
 * whose newest six turns are all unanswered is read again, further back.
 */
export const SUBJECT_READ_STEPS: readonly number[] = [6, 60, 300];

export type SubjectRead = {
  /** The questions whose subject is still open, NEWEST FIRST. */
  questions: string[];
  /**
   * True when the start of the open run was seen: a document answer closed
   * what came before it, or the conversation began inside what was read.
   * False means older turns exist that were not read and nothing read closes
   * them off — a model named back there would still be the subject.
   */
  complete: boolean;
};

/**
 * `turns` is the newest `limit` completed turns of one conversation, OLDEST
 * FIRST (listTurns' order).
 */
export function readSubject(turns: readonly PriorTurn[], limit: number): SubjectRead {
  const questions: string[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.answerStatus === "answered" && typeof turn.basis === "string" && DOCUMENT_BASES.has(turn.basis)) {
      return { questions, complete: true };
    }
    const question = turn.question?.trim();
    if (question) questions.push(question);
  }
  return { questions, complete: turns.length < limit };
}

/**
 * The questions whose subject is still open, NEWEST FIRST.
 * `turns` is one conversation's completed turns, OLDEST FIRST (listTurns' order).
 */
export function openQuestions(turns: readonly PriorTurn[]): string[] {
  return readSubject(turns, Number.POSITIVE_INFINITY).questions;
}

/**
 * Does this question say, in so many words, that it is about the technician's
 * OWN unit again — the one the project is set up for?
 *
 * Seen on staging 6da4ab674 (CV-101 benchmark FU-A4, 2026-11-13): a look-alike
 * ("what about the GS13N-20P2, same thing?") was refused, as it must be, and
 * the technician typed "ok back to mine, what frame size is it". The refused
 * question was still open, so the look-alike carried into the new question and
 * it was refused again — with no way back except typing the catalog number.
 *
 * Mike's decision (2026-11-13, option A): "back to mine" / "back to my drive"
 * ends the carry; typing nothing after a sibling still means the sibling. So
 * this is narrow on purpose — anchored on "back to", followed by an ownership
 * word. A bare "my drive" is not a return (a follow-up still about the sibling
 * can say "my other drive"), nor is "back to the drive" (which one?).
 */
const RETURN_TO_OWN_UNIT =
  /\bback to (?:mine|ours|(?:my|our) (?:own\b|drive|vfd|unit|plc|controller|relay|machine|conveyor|motor|inverter|project|notebook)|this (?:project|notebook)(?:'s)?)\b/i;

export function returnsToRecord(question: string): boolean {
  return RETURN_TO_OWN_UNIT.test(question);
}
