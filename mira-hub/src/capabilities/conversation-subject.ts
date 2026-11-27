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

import { faultCodeTokens } from "./answer-validation";
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
  /** Per question: it was asked WITH a photo (joined or unreadable). A follow-up after such a turn
   *  is about that photo's machine even with no pointer in it (#5671 combined release). Absent when none. */
  photo?: boolean[];
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
    ...(read.some((q) => q.photo !== null || q.unknown) ? { photo: read.map((q) => q.photo !== null || q.unknown) } : {}),
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

/**
 * #5720 / #5416 / #5671: does this question take its subject from an EARLIER
 * question? A refusal belongs to the question that named the product. A
 * question that has a subject of its own is judged on its own words, under the
 * project's record; only one that points back is judged against what it points
 * back to. Length decides nothing ("huh?" points back, a long question that
 * says "on that drive" points back, a long one with no pointer does not).
 *
 *  - A POINTER in any form leans: a leading connective ("and", "what about"),
 *    "its"/"their", a pronoun after an auxiliary or a preposition ("does it
 *    need", "wrong with it"), "this/that/the same/the other <unit>", "same
 *    thing", "back to mine".
 *  - Otherwise a bare object pronoun at the end of a sentence ("how do I reset
 *    it") or a fragment of three words or fewer leans, in EVERY sentence.
 *  - Anything else (a code question, a spec question in any language) stands
 *    alone.
 * Stated limit: a pointer this grammar does not read ("that one", spelled in
 * another language) stands on its own words and is judged under the record,
 * which is how a question with no earlier subject always was judged.
 */
const POINTED_AT = "(?:drive|vfd|unit|motor|machine|controller|plc|relay|converter|inverter|device|one|model|thing|axis|servo|panel|hmi)";
const AUXILIARY = "(?:is|are|was|were|does|do|did|can|could|will|would|should|has|have|had|need|needs)";
const POINTERS: readonly RegExp[] = [
  /^\s*(?:and|also|but|plus|then|so|what about|how about)\b/,
  /\b(?:its|it's|their|theirs)\b/,
  new RegExp(`\\b${AUXILIARY}\\s+(?:it|they|them|that|this|those|these)\\b`),
  new RegExp(`\\b(?:this|that|these|those|the same|the other)\\s+${POINTED_AT}\\b`),
  /\b(?:with|on|for|about|of|in|from|at|to)\s+(?:it|them)\b/,
  /\bit\s+(?:need|needs|use|uses|take|takes|have|has|show|shows|mean|means|weigh|weighs|support|supports|handle|handles)\b/,
  /\bsame (?:thing|one|as)\b/,
  /\bback to (?:mine|ours|my|our)\b/,
];
const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const weakPointer = (sentence: string) => /\b(?:it|them)\s*$/.test(sentence.trim()) || wordCount(sentence) <= 3;

const STOP = new Set(("what which when where whom whose does this that these those with from have been will would should could about there their then than into only also just very much many some "
  + "please tell show give need needs mean means meaning code fault alarm error warning clear reset again same next other still more "
  // Words every maintenance question carries: sharing one is no evidence of one subject (#5720 G1 vs E8).
  + "page pages refs ref motor drive drives unit units power manual machine thread controller panel").split(" "));
const contentWords = (text: string) =>
  (foldForDetection(text).toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w));
/** "the plate reads GS11N-20P2", "label says ...": the technician is standing at a unit. */
const PLATE_STATEMENT = /\b(?:name\s?plate|plate|label|sticker|tag)\b[^.?!]{0,40}\b(?:reads?|says?|shows?|is)\b/i;

/**
 * The route searches the English corpus with a TRANSLATED query but hands retrieval the technician's
 * ORIGINAL message (`rawQuery`), and subject scope reads that original. So a pointer written in another
 * language has to be read as written. Per language: the CLASS of word that points back (a demonstrative,
 * a possessive, a pronoun as subject or object, "the same / the other", a leading connective) — never a
 * list of sentences. The language is identified from its function words; a text in no listed language
 * FAILS CLOSED (it keeps the earlier subject), because a pointer there cannot be read at all.
 * Stated limit: a clitic or an elided subject that carries no such word ("¿qué tensión necesita el
 * controlador?") is not a pointer here, in any language, English included.
 */
type Lexicon = { function: string; pointers: readonly string[] };
const LANGUAGES: Record<string, Lexicon> = {
  english: {
    function: "the is are was were be been being what which how do does did doing of to for and or with it its that this these those my you your can could should will would have has had when where why who whom whose if then than there their about after before around from into over under while until per much many long far need needs needed want make get set check find show tell please what's it's don't",
    pointers: [],
  },
  spanish: {
    function: "el la los las un una unos unas de del que qué cual cuál cuanto cuánto cuánta como cómo para por con en es son está estoy necesito necesita puedo se lo al y o no mas más pa",
    pointers: [
      "(?:este|esta|esto|estos|estas|ese|esa|eso|esos|esas|aquel|aquella|aquello)",
      "(?:su|sus|suyo|suya|suyos|suyas|mismo|misma|mismos|mismas|anterior)",
      "(?:él|ella|ellos|ellas|ello)",
      "(?:el|la|lo|los|las) otr[oa]s?",
      "[a-záéíóú]+(?:ar|er|ir)(?:lo|la|los|las)",
      "^[¿¡\\s]*(?:y|pero|tambi[eé]n|entonces|adem[aá]s|pues)",
    ],
  },
  french: {
    function: "le la les un une des du de d l et ou que qu quel quelle quels quelles est sont comment pour avec dans sur il faut quoi ne pas je mon ma mes dois",
    pointers: [
      "(?:ce|cet|cette|ces|celui|celle|ceux|celles|celui-ci|celle-ci|celui-là|celle-là)",
      "(?:son|sa|ses|leur|leurs|même|mêmes|précédent|précédente)",
      "(?:il|elle|ils|elles)",
      "(?:l'|le |la )autres?",
      "^[\\s]*(?:et|mais|aussi|alors|donc|puis)",
    ],
  },
  german: {
    function: "der die das den dem des ein eine einen einem einer und oder ist sind was wie welche welcher welches wieviel viel für mit auf in zu ich brauche benötigt nicht",
    pointers: [
      "(?:dies|dieser|diese|dieses|diesen|diesem|jener|jene|jenes)",
      "(?:sein|seine|seiner|seinen|seinem|seines|ihr|ihre|ihrer|ihren|ihrem|ihres)",
      "(?:er|sie|es)",
      "(?:derselbe|dieselbe|dasselbe|selbe|selben|gleiche|gleichen|andere|anderen|anderer|vorherige|vorherigen)",
      "^[\\s]*(?:und|aber|auch|dann|also|noch)",
    ],
  },
  italian: {
    function: "il lo la i gli le un una di del della che quale qual è sono come per con in su non mi devo",
    pointers: [
      "(?:questo|questa|questi|queste|quello|quella|quelli|quelle|stesso|stessa|altro|altra|precedente)",
      "(?:suo|sua|suoi|sue|loro)",
      "(?:lui|lei|essi|esse)",
      "^[\\s]*(?:e|ma|anche|allora|poi)",
    ],
  },
  portuguese: {
    function: "o a os as um uma de do da dos das que qual como para com em é são não preciso eu meu minha",
    pointers: [
      "(?:este|esta|estes|estas|esse|essa|esses|essas|aquele|aquela|isto|isso|deste|desta|desse|dessa|naquele)",
      "(?:seu|sua|seus|suas|mesmo|mesma|outro|outra|anterior)",
      "(?:ele|ela|eles|elas)",
      "^[\\s]*(?:e|mas|também|então|além)",
    ],
  },
};
const stripMarks = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? [];
/** Listed languages ranked by how many of their function words the text uses; best first, ties kept. */
function languagesOf(text: string): string[] {
  const words = wordsOf(text);
  const scored = Object.entries(LANGUAGES).map(([name, lex]) => {
    const set = new Set(lex.function.split(" "));
    return [name, words.filter((w) => set.has(w) || set.has(stripMarks(w))).length] as const;
  });
  const best = Math.max(0, ...scored.map(([, hits]) => hits));
  return best === 0 ? [] : scored.filter(([, hits]) => hits === best).map(([name]) => name);
}
const POINTER_RES: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(LANGUAGES).map(([name, lex]) => [
    name,
    lex.pointers.map((p) => (p.startsWith("^") ? new RegExp(stripMarks(p), "u") : new RegExp(`(?<![\\p{L}])${p}(?![\\p{L}])`, "iu"))),
  ]),
);
// Impersonal "it" is no pointer: "il faut", "faut-il", "il y a", "es gibt", "gibt es".
const IMPERSONAL = /\b(?:faut-il|il faut|il y a|y a-t-il|s'il|il s'agit|es gibt|gibt es)\b/g;
/** A pointer in a language other than English. Text in NO listed language fails closed (true). */
function pointsBackInAnotherLanguage(question: string): boolean {
  const lowered = foldForDetection(question).toLowerCase().replace(IMPERSONAL, " ");
  if (wordsOf(lowered).length === 0) return false;
  const languages = languagesOf(lowered);
  if (languages.length === 0) return true;
  if (languages.length === 1 && languages[0] === "english") return false;
  // On a tie, every tied language is tried: a miss in the wrong one must not hide a pointer in the right one.
  return languages.some((language) => POINTER_RES[language].some((re) => re.test(lowered) || re.test(stripMarks(lowered))));
}

export function leansOnEarlierQuestion(question: string): boolean {
  const text = foldForDetection(question).toLowerCase();
  if (POINTERS.some((re) => re.test(text))) return true;
  if (pointsBackInAnotherLanguage(question)) return true;
  const sentences = text.split(/[.?!]+/).filter((sentence) => wordCount(sentence) > 0);
  if (faultCodeTokens(question).length > 0) {
    // A code with next to nothing around it ("what does fault F0004 mean", "how do I clear F0005")
    // is the display of a unit that was not named: it is about the unit under discussion.
    // A code beside a subject of its own ("F30001 stop response and acknowledgment") is not.
    return contentWords(question.replace(new RegExp(FAULT_WORD.source, "g"), " ")).length <= 1;
  }
  return sentences.length > 0 && sentences.every(weakPointer);
}
const FAULT_WORD = /\b[A-Za-z]{1,4}[-_]?\d{2,8}(?:[-_][A-Za-z0-9]+)?\b/;

/**
 * Does this question carry the subject of the open earlier questions (NEWEST
 * FIRST, as readSubject returns them)? It does when it points back
 * (leansOnEarlierQuestion), when an earlier question was a plate statement (the
 * next question is about the unit the technician is looking at), or when it asks
 * about a topic the earlier questions already asked about (the same attribute
 * of the same unit: "coil voltage" again). Otherwise it has a subject of its
 * own and is judged on its own words, under the project's record.
 */
export function carriesEarlierSubject(question: string, earlier: readonly string[]): boolean {
  if (leansOnEarlierQuestion(question)) return true;
  if (earlier.some((text) => PLATE_STATEMENT.test(foldForDetection(text)))) return true;
  const own = new Set(contentWords(question));
  return earlier.some((text) => contentWords(text).some((w) => own.has(w)));
}

/**
 * The newest standalone LOOK a follow-up should carry (#5764 r3 F5): the first of the recent LOOKs (newest
 * first) that is NOT already the photo of a turn in the window. A newer reading of a photo sent with a
 * question (a correction, a re-read) belongs to that turn, judged by its join rule; it must not hide the
 * standalone LOOK behind it.
 */
export function standaloneLook<L extends { text?: string | null; fileId?: string | null }>(
  looks: readonly L[],
  windowTurnFileIds: ReadonlySet<string>,
): L | undefined {
  return looks.find((l) => l.text && l.fileId && !windowTurnFileIds.has(l.fileId));
}
