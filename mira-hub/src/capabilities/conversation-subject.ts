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

import { foldForDetection } from "./detection-fold";
import { namesAnyModel, namesOneMachine, photoIsAmbiguous, readPhotoModel } from "./photo-subject";

export type PriorTurn = {
  question?: string | null;
  answerStatus?: string | null;
  basis?: string | null;
  /** The reading of the photo sent with that question, from the same
   *  conversation (#5706; Codex r1 on #5764, F5): a GS20 plate sent with "Find
   *  me the manual" was refused; "what's its rated current?" is still about
   *  the GS20. Joined exactly as the live turn joins it (questionWithPhoto). */
  photoText?: string | null;
  /** That question had a photo whose reading could not be read back (a failed
   *  read, or past the read limit): its machine is unknown, so it is asked
   *  about, never answered (#5706). */
  photoUnread?: boolean;
};

export type QuestionWithPhoto = {
  /** What the model check reads: the question, plus the photo's public text when it joins. */
  text: string;
  /** The photo's public text that joined, or null. */
  photo: string | null;
  /** The photo ends an earlier open subject, as a typed model does. */
  releases: boolean;
  /** The photo names models but the reader cannot tell which one is meant. */
  ambiguous: boolean;
  /** The photo's machine cannot be known (readPhotoModel, or an unread photo). */
  unknown: boolean;
  /** Private-field codes of the joined photo (readPhotoModel `hidden`). */
  hidden: string[];
};

/**
 * ONE rule for a question and the photo sent with it — the live turn
 * (manual-rag.ts) and every carried turn (readSubject) use it, so a follow-up
 * is never judged on a machine its own turn was not judged on.
 *
 * The photo joins when the question names no model and does not return to the
 * technician's own unit (a return counts only with a catalog number on record,
 * the same condition manual-rag.ts applies). Joined, its public text is read
 * exactly as if typed (photo-subject.ts).
 */
export function questionWithPhoto(
  question: string,
  reading: string | null | undefined,
  recordOnFile: boolean,
  unread = false,
): QuestionWithPhoto {
  const asked = question.trim();
  const joins = !namesAnyModel(asked) && !(recordOnFile && returnsToRecord(asked));
  const read = joins ? readPhotoModel(reading) : { text: null, unknown: false, hidden: [] };
  const unknown = joins && (unread || read.unknown);
  const photo = read.text;
  const hidden = read.hidden;
  if (!photo) return { text: asked, photo: null, releases: false, ambiguous: false, unknown, hidden };
  return {
    text: [asked, photo].filter(Boolean).join("\n"),
    photo,
    releases: !unknown && namesAnyModel(photo) && namesOneMachine(photo),
    ambiguous: photoIsAmbiguous(photo),
    unknown,
    hidden,
  };
}

/** An answer that came from a document. Everything else — a refusal, a safety
 *  stop (stored "answered" with no basis), general reasoning, machine history,
 *  an error — leaves the subject of its question open. */
export const DOCUMENT_BASES: ReadonlySet<string> = new Set(["workspace_evidence", "oem_documentation"]);

/**
 * How many turns to read, widening only while the open run has no start in
 * sight. The first step is the ordinary case: one small read. A conversation
 * whose newest six turns are all unanswered is read again, further back.
 */
export const SUBJECT_READ_STEPS: readonly number[] = [6, 60, 300];

export type SubjectRead = {
  /** The questions whose subject is still open, NEWEST FIRST. */
  questions: string[];
  /** Per question: its machine came from a photo that does not say which
   *  machine is meant (#5706). Absent when no question is. */
  unclear?: boolean[];
  /** Per question: its photo's private-field codes (readPhotoModel `hidden`),
   *  for manual-rag.ts to check only. Absent when no question has any. */
  hidden?: string[][];
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
export function readSubject(turns: readonly PriorTurn[], limit: number, recordOnFile = false): SubjectRead {
  const read: QuestionWithPhoto[] = [];
  let complete = turns.length < limit;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.answerStatus === "answered" && typeof turn.basis === "string" && DOCUMENT_BASES.has(turn.basis)) {
      complete = true;
      break;
    }
    const subject = questionWithPhoto(turn.question ?? "", turn.photoText, recordOnFile, turn.photoUnread === true);
    if (subject.text || subject.unknown) read.push(subject);
  }
  const unclear = unclearPhotos(read, recordOnFile);
  const hidden = read.map((q) => q.hidden);
  return {
    questions: read.map((q) => q.text),
    ...(unclear.some(Boolean) ? { unclear } : {}),
    ...(hidden.some((h) => h.length > 0) ? { hidden } : {}),
    complete,
  };
}

/**
 * Which open questions took their machine from a photo that does not say
 * which machine is meant — the same two cases the live turn asks about
 * (manual-rag.ts): the photo's machine is unknown (a model among its private
 * fields, or its reading could not be read back), the reader finds several
 * models it cannot tell apart, or a photo naming models is not specific
 * enough to end the subject before it (two drives, a model beside an order
 * code). `read` is NEWEST FIRST; the
 * subject before a question is the nearest older question naming a model, up
 * to a return to the technician's own unit.
 */
function unclearPhotos(read: readonly QuestionWithPhoto[], recordOnFile: boolean): boolean[] {
  return read.map((q, i) => {
    if (q.unknown) return true;
    if (!q.photo || !namesAnyModel(q.photo)) return false;
    if (q.ambiguous) return true;
    if (q.releases) return false;
    for (let j = i + 1; j < read.length; j++) {
      if (recordOnFile && returnsToRecord(read[j].text)) return false;
      if (namesAnyModel(read[j].text)) return true;
    }
    return false;
  });
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
 * A reversal that OPENS THE NEXT CLAUSE cancels the return ("go back to mine.
 * No, stay on this one." — Codex r3 on #5464, Mike's B 2026-11-13). Accepted
 * residue, by design: a reversal two or more clauses later is not detected;
 * the sibling is re-named by typing it. A bare "my drive" is not a return (a
 * follow-up still about the sibling can say "my other drive"), nor is "back to
 * the drive".
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

/** A next clause that opens with one of these takes the return back. */
const REVERSAL_OPENERS = /^(?:no|nope|nah|never ?mind|actually|wait|hold on|hang on|stay|scratch that|forget (?:that|it)|on second thought|cancel)\b/i;

/** Clause boundaries: , ; : . ! ? a spaced dash, or a line break (kept, to read the terminator). */
const CLAUSE_BOUNDARY = /(\s[-–—]\s|[,;:.!?]|\n)/;

/**
 * #5485: what a phone keyboard types must read like its plain spelling. The shared
 * detection fold (#3980) handles hyphen look-alikes, curly apostrophes, Unicode spaces
 * and invisible characters. Dashes and the ellipsis stay with this reader, as #3980
 * requires of every grammar that splits on them:
 *  - U+2026 HORIZONTAL ELLIPSIS decomposes to "..." (iOS types it for "...").
 *  - An em dash (U+2014; iOS types it for "--"), en dash (U+2013; Gboard), horizontal
 *    bar (U+2015) or small em dash (U+FE58, <small> U+2014), or two or more hyphens, is a
 *    dash at any spacing, so it is written as the spaced dash CLAUSE_BOUNDARY reads.
 *    A single hyphen is not: it sits inside catalog numbers and "mine-ish".
 * Full-width punctuation is out of scope and still fails closed.
 */
const TYPED_ELLIPSIS = /…/g;
const TYPED_DASH = /\s*(?:[–—―﹘]|-{2,})\s*/g;

/** A clause "has words" when it holds a letter or a digit; anything else is punctuation. */
const HAS_WORDS = /[\p{L}\p{N}]/u;
const LEADING_NON_WORD = /^[^\p{L}\p{N}]+/u;
/** After asTyped every dash form is "-", so a token of hyphens only is a piece of a dash run. */
const HYPHENS_ONLY = /^-+$/;

function asTyped(question: string): string {
  return foldForDetection(question).replace(TYPED_ELLIPSIS, "...").replace(TYPED_DASH, " - ");
}

export function returnsToRecord(question: string): boolean {
  const parts = asTyped(question).split(CLAUSE_BOUNDARY);
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    if (!RETURN_TO_OWN_UNIT.test(clause)) continue;
    // #5493 (Codex r2 on #5490, F2): a dash run in front of the phrase ("ok—-back", "ok - -back")
    // leaves a token of hyphens only; it is part of the dash, not a word. Only hyphen tokens are
    // dropped: other punctuation (a full-width "？") still fails closed.
    const rest = clause.replace(RETURN_TO_OWN_UNIT, " ").toLowerCase().split(/\s+/).filter((word) => word && !HYPHENS_ONLY.test(word));
    if (!rest.every((word) => CONNECTIVES.has(word))) return false;
    // Codex r4 on #5464 (F1): ".\n" or "..." leaves empty clauses between the separators;
    // the next clause is the next one with words in it. Codex r1 on #5490 (F1): a clause of
    // punctuation only ("-" left between "—" and "-?") has no words either, so it is part of
    // the separator run too, whatever the punctuation is.
    let next = i + 2;
    while (next < parts.length && !HAS_WORDS.test(parts[next])) next += 2;
    // #5467 (Codex r5 on #5464, F1): the whole run of separators up to that clause is the
    // terminator. A "?" anywhere in it ("...?", "!?", "—-?") makes this a question, not a return.
    for (let sep = i + 1; sep < next; sep += 2) {
      if ((parts[sep] ?? "").includes("?")) return false;
    }
    // The reversal is read from the next clause's first word, past any punctuation in front of it.
    return !REVERSAL_OPENERS.test((parts[next] ?? "").replace(LEADING_NON_WORD, ""));
  }
  return false;
}
