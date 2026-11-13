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
 * ends the carry; typing nothing after a sibling still means the sibling.
 *
 * THE RULE (Codex r1 + r2 on #5464 found the same class twice — a mention that
 * is not a return: "before we go back to mine, …", "let's go back to mine
 * later; …", "go back to mine? No, stay on this one." — so this is structural,
 * not a word list): a return is read only when one clause of the message IS the
 * return phrase and nothing else — leading and trailing words all from a short
 * closed set of connectives ("ok", "now", "let's go", "please"), and the clause
 * not ending in a question mark. Anything else in that clause, before or after
 * the phrase, means it is not a plain return and the sibling stays. This fails
 * closed on purpose: "ok back to mine what frame size is it" with no comma is
 * NOT read as a return (the carry stays, the catalog number is the way back).
 *
 * Accepted residue, by design: a reversal in a LATER clause is not detected
 * ("go back to mine. No, stay on this one." reads as a return); the sibling is
 * re-named by typing it. A bare "my drive" is not a return (a follow-up still
 * about the sibling can say "my other drive"), nor is "back to the drive".
 */
const OWN_UNIT = "(?:drive|vfd|unit|plc|controller|relay|machine|conveyor|motor|inverter)";
const RETURN_TO_OWN_UNIT = new RegExp(
  `\\bback to (?:mine|ours|(?:my|our) (?:own(?: ${OWN_UNIT})?|${OWN_UNIT}|project|notebook)|this (?:project|notebook)(?:'s(?: ${OWN_UNIT})?)?)\\b`,
  "i",
);

/** The only words allowed beside the phrase in its clause. */
const CONNECTIVES: ReadonlySet<string> = new Set([
  "ok", "okay", "alright", "right", "so", "and", "then", "now", "well", "anyway",
  "yes", "yeah", "yep", "let's", "lets", "go", "please", "pls", "just",
]);

/** Clause boundaries: , ; : . ! ? a spaced dash, or a line break (kept, to read the terminator). */
const CLAUSE_BOUNDARY = /(\s[-–—]\s|[,;:.!?]|\n)/;

export function returnsToRecord(question: string): boolean {
  const parts = question.split(CLAUSE_BOUNDARY);
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    if (!RETURN_TO_OWN_UNIT.test(clause)) continue;
    if ((parts[i + 1] ?? "").trim() === "?") return false;
    const rest = clause.replace(RETURN_TO_OWN_UNIT, " ").toLowerCase().split(/\s+/).filter(Boolean);
    return rest.every((word) => CONNECTIVES.has(word));
  }
  return false;
}
