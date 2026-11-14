/**
 * rating-column (#5466) — an answer drawn from a contact-ratings table must
 * keep the table's columns apart.
 *
 * A relay contact-ratings table gives several ampere figures for one voltage:
 * what the contact may MAKE (the surge at closing), what it may BREAK, and what
 * it may carry CONTINUOUSLY. On 2026-11-13 a technician asked whether a 5 A
 * coil load could be switched from a Micro820 relay output. The answer said
 * "Yes — rated for 15 A at 120 V AC", cited the right page, and was marked
 * grounded. 15 A is the make figure. The continuous figure on that row is 2 A.
 *
 * Two deterministic rules, text only, no model call:
 *
 *   LOAD rule — the question names a load current (a figure it labels inrush
 *   or surge, word against figure, is not one: that is judged against the make
 *   figure, which this rule cannot pick out), and a ratings table the
 *   answer was given carries an ampere figure BELOW that load on the row for
 *   the asked voltage (on every row, when the question names no voltage the
 *   table lists). Then the load is over at least one of make, break and
 *   continuous, whichever columns those figures are. The answer must show one
 *   of those lower figures, and no sentence of it may open with an approval
 *   ("Yes", and at the very start also "You can"). The figures are compared
 *   as numbers, not read as words. It applies
 *   when the answer cites the table's page, or when it quotes a figure from the
 *   table's rating rows and the question is about a relay, contact, output or
 *   switching.
 *
 *   COLUMN rule — an answer sentence that quotes a rating-row ampere figure
 *   from a CITED ratings table must name a column: in that sentence, or on an
 *   earlier line of the same block that carries no figure (a heading, or the
 *   head row of a table).
 *
 *   WRONG-COLUMN rule (#5474 item 5) — when the page was stored with its
 *   columns read from the printed positions (`contact-ratings-table.ts`), an
 *   answer that ASSIGNS a figure to a column must assign it to the column the
 *   table places it in. An assignment is a column word attached to the figure:
 *   directly before it ("make rating of 1.5 A", "break rating at 120 V AC is
 *   15 A", "continuously at 15 A") or directly after ("2 A make", "15 A is the
 *   break rating"). On staging 2199f449a the answer read the 120 V AC row as
 *   "make rating of 1.5 A and break rating of 2 A"; the page prints 2 A under
 *   Continuous. The rule reads the rows for the voltage the sentence names; the
 *   question's when the sentence names none; every row when neither does. A
 *   passage with no row for that voltage is not read (it may be one chunk of
 *   the page). It only ever withholds; it approves nothing. It does not judge:
 *   a figure the question itself gives (the asked duty); a figure given as a
 *   load ("a 1.5 A steady-state load", "draws 1.5 A"); a figure in a clause
 *   that denies before reaching it ("cannot continuously carry 15 A", "do not
 *   treat 15 A as the continuous rating") or that names another device ("an
 *   interposing relay rated 15 A continuous"); a figure whose value also sits
 *   on those rows with no column read (the page prints 1.0 A across make and
 *   break at 24 V DC, so "break 1 A" there is right); or a figure with a column
 *   word only somewhere near it. So "the make rating is 15 A and 2 A is what
 *   you can use" and "the contacts break 2 A loads" pass.
 *
 * A passage is a ratings table when it writes "Make" beside "Break" and also
 * writes "Continuous". Its rating rows are the lines that carry two or more
 * ampere figures, or that open with a voltage and carry one.
 *
 * Stated limits:
 *   - a question that gives only an inrush figure is not judged by the LOAD
 *     rule at all;
 *   - only ampere figures written with digits are read (not "fifteen amps", not
 *     volt-amperes, not a decimal comma), and only in THIS question: a load
 *     named in an earlier turn is not seen by the LOAD rule;
 *   - which column a figure belongs to is NOT worked out from the flattened
 *     page text: it does not keep columns in order, and a guess would be worse
 *     than none. It is known only for a page stored with its column lines, and
 *     only the WRONG-COLUMN rule uses it. So an answer that shows the lower
 *     figure and approves the load in the middle of a sentence ("… 2 A
 *     continuous, so it can be switched") passes the LOAD rule, and on a page
 *     stored WITHOUT column lines (every manual uploaded before extraction
 *     version 4, until it is reprocessed) "the contact runs continuously at
 *     15 A" still passes;
 *   - the WRONG-COLUMN rule is satisfied by the right word anywhere between
 *     the neighbouring figures, so "continuous 15 A, make 2 A" is caught at its
 *     second figure and not its first, and an answer table with its columns
 *     swapped is not caught at all (only the first figure of a row has the
 *     heads beside it);
 *   - the COLUMN rule's column word only has to be in the sentence or above it
 *     ("make sure … 15 A" passes). The LOAD rule's figure check reads no words;
 *   - a correct refusal that shows no figure ("No, use an interposing relay")
 *     is replaced too: the replacement shows the figures it left out;
 *   - an approval that quotes no figure and cites no page is not seen;
 *   - another value on the cited ratings page that equals a rating-row figure
 *     (a "2 A" fuse) is held to the COLUMN rule.
 *
 * PURE: no I/O.
 */
import { readColumnLines, type ColumnRow, type RatingColumn } from "./contact-ratings-table";

/** A passage the answer was given. `cited`: the answer carries its [n]. */
export type RatingPassage = { content: string; title: string; page: number | string | null; cited: boolean };

/** What was found, and the table it is from. */
export type RatingColumnFinding = { title: string; page: number | string | null } & (
  /** `row` and `lower` are set only when exactly one row is the asked voltage's. */
  | { rule: "load"; load: string; row: string | null; lower: string[] }
  | { rule: "column"; figure: string }
  | { rule: "wrong_column"; figure: string }
);

// Between a number and its unit: a space (also no-break or narrow no-break) or a hyphen.
const GAP = String.raw`[\s  -]{0,2}`;
// "15 A", "1.5A", "15-A", "2 amps", "0.22 AMPERES". A lone "A" is upper case
// only ("5 a day" is not a current). "16 mA" and "120 V AC" do not match.
const AMPERE_RE = new RegExp(String.raw`(?<![\d.])(\d+(?:\.\d+)?)${GAP}(?:A(?![A-Za-z])|[Aa][Mm][Pp][Ss]?\b|[Aa][Mm][Pp][Ee][Rr][Ee][Ss]?\b)`, "g");
const VOLTAGE_RE = new RegExp(String.raw`(?<![\d.])(\d+(?:\.\d+)?)${GAP}(?:V(?:AC|DC)?(?![A-Za-z])|[Vv]olts?\b)`, "g");
const MAKE_BESIDE_BREAK_RE = /\bmake\b[\s/|,&]*(?:and\s+)?\bbreak\b/i;
const CONTINUOUS_RE = /\bcontinuous\b/i;
// "carry" is not one: "the output carries 15 A" names no column.
const COLUMN_WORD_RE = /\b(?:make|making|makes|inrush|break|breaking|breaks|interrupt(?:ing|s)?|continuous|continuously|steady[- ]state)\b/i;
// A sentence that opens by approving. "You can" and "It can" count only at the
// very start of the answer: further down, "You can use an interposing relay" is
// advice. The draft carries no banner at this point.
const SENTENCE_APPROVES_RE = /^[^A-Za-z0-9]*(?:yes|yeah|yep|sure|absolutely|certainly|correct|ok|okay|that is fine|that's fine|no problem)\b/i;
const ANSWER_OPENS_APPROVING_RE = /^[^A-Za-z0-9]*(?:you can|it can)\b/i;
const approves = (answer: string) => ANSWER_OPENS_APPROVING_RE.test(answer) || answer.split(/(?<=[.!?])\s+|\n+/).some((s) => SENTENCE_APPROVES_RE.test(s));
// A current the question itself calls a closing surge. The word must sit ON the
// figure ("10 A inrush", "inrush of 10 A", "inrush current is 10 A"); anywhere
// else in the sentence it says nothing about a figure, and "surge-suppressed"
// or "surge protection" is not a current at all.
const INRUSH = String.raw`(?:inrush|in-rush|pull-in|pick-?up|surge(?![- ]?(?:suppress|protect|arrest)))\b`;
const INRUSH_AFTER_RE = new RegExp(String.raw`^\s*\(?\s*(?:of\s+|peak\s+)?${INRUSH}`, "i");
const INRUSH_BEFORE_RE = new RegExp(String.raw`\b${INRUSH}(?:\s+current)?\s*(?:of|is|=|:|at|about|around|up to)?\s*\(?\s*$`, "i");
// The LOAD rule reads an UNCITED table only for a question about what the table rates.
const CONTACT_QUESTION_RE = /\b(?:relay|contacts?|outputs?|switch(?:es|ed|ing)?)\b/i;

// WRONG-COLUMN rule. A figure is judged only where the answer ASSIGNS it to a column: the column
// word is attached to the figure, directly before ("make rating of 1.5 A", "break rating at
// 120 V AC is 15 A", "continuously at 15 A", "break 7.5 A") or directly after ("2 A make",
// "15 A is the break rating"). A column word that is merely near a figure assigns nothing
// ("a 1.5 A load is below the 2 A continuous rating" assigns only the 2 A).
const COLUMNS: readonly RatingColumn[] = ["make", "break", "continuous"];
const WORD: Record<RatingColumn, string> = {
  make: "make|making|makes|inrush|surge",
  break: String.raw`break|breaking|breaks|interrupt(?:ing|s)?`,
  continuous: "continuous|continuously|steady[- ]state",
};
const NOUN = String.raw`(?:\s+(?:ratings?|rated|figure|current|limit|capacity|value|duty)){0,2}`;
const AT_VOLTS = String.raw`(?:\s+(?:at|for|on)\s+(?:the\s+)?\d+(?:\.\d+)?\s?V(?:\s?(?:AC|DC))?(?:\s+row)?)?`;
const LOAD_NOUN = "loads?|coils?|motors?|lamps?|solenoids?|heaters?|contactors?";
// "the make rating for a 5 A coil load is 1.5 A": the load the rating is quoted for sits between.
const FOR_LOAD = String.raw`(?:\s+(?:for|with)\s+(?:a|an|the|your)\s+[^,;:]{0,30}?(?:${LOAD_NOUN}))?`;
// What may stand between the column word and its figure. A limit put as a denial ("is not more
// than", "cannot exceed") still assigns the figure to the column.
const EXCEEDS = String.raw`(?:cannot|can not|can[’']t|does not|doesn[’']t|do not|don[’']t|never)\s+(?:exceeds?|go above|go over|pass)`;
const LINK = String.raw`\s*(?:\((?:max|maximum|min|minimum|typ|typical|nominal)\.?\)\s*)?(?:of|is|are|=|:|at|to|${EXCEEDS})?\s*(?:only|just|about|around|approximately|roughly|up to|limited to|a maximum of|at most|not more than|no more than|no higher than|not above|not over)?[\s(•–—|-]*$`;
/** Where `column`'s word is attached ahead of the figure (its index in `before`), or -1. */
const assignedBefore = (column: RatingColumn, before: string) => new RegExp(String.raw`\b(?:${WORD[column]})${NOUN}${AT_VOLTS}${FOR_LOAD}${LINK}`, "i").exec(before)?.index ?? -1;
/** The end of `column`'s word attached behind the figure (its index in `after`), or -1. */
const assignedAfter = (column: RatingColumn, after: string) => {
  const m = new RegExp(String.raw`^\s*\(?\s*(?:(?:rating|figure|limit|current|rated)\s+)?(?:(?:is|as)\s+(?:the|its|a)\s+|(?:for|on|under|at)\s+(?:the\s+)?)?(?:${WORD[column]})\b`, "i").exec(after);
  return m ? m[0].length : -1;
};
const ANY_COLUMN_WORD_RE = new RegExp(String.raw`\b(?:${WORD.make}|${WORD.break}|${WORD.continuous})\b`, "i");
// Every column word in a stretch of text, in the order written.
const columnWordsIn = (text: string): RatingColumn[] =>
  [...text.matchAll(new RegExp(String.raw`\b(?:(${WORD.make})|(${WORD.break})|(${WORD.continuous}))\b`, "gi"))].map((m) => (m[1] ? "make" : m[2] ? "break" : "continuous"));
// Between two figures of one list: "15 A / 1.5 A", "15 A, 1.5 A and 2 A", cells of a table row.
const LIST_GAP_RE = /^\s*(?:,|\/|\||&|and|,\s*and)?\s*$/i;
// A head behind its list opens "are the" / "is the".
const TAIL_HEAD_RE = /^\s*(?:are|is)\s+(?:the|its)\s/i;
// The clause a figure stands in: the sentence between the commas, semicolons, "and" or "but" around it.
const CLAUSE_EDGE_RE = /[,;]|\s(?:and|but)\s/gi;
// A clause that denies before it reaches the figure assigns nothing to it ("cannot continuously
// carry 15 A", "do not treat 15 A as the continuous rating"). The denial must be in the figure's
// own stretch of the sentence: a colon or a joining word ends its reach, so "it should not be
// switched because the break rating is 15 A" still assigns.
const DENIES_RE = /\b(?:not|never|cannot|neither|nor)\b|n[’']t\b/i;
const DENIAL_ENDS_RE = /:|\b(?:because|since|as|so|which|when|while|where|though|although|given)\b/gi;
// A figure the sentence gives as a load, not as a rating: "a 1.5 A steady-state load", "draws
// 1.5 A", "a load current of 1.5 A".
const LOAD_AFTER_RE = new RegExp(String.raw`^\s*(?:[A-Za-z-]+\s+){0,2}(?:${LOAD_NOUN}|draw)\b`, "i");
const LOAD_BEFORE_RE = /\b(?:loads?(?:\s+current)?(?:\s+of)?|draws|drawing|pulls|pulling)\s+(?:about\s+|around\s+|up to\s+)?$/i;
// Words that put a figure on some other device than the one the table rates.
const OTHER_DEVICE_RE = /\b(?:interposing|external|separate|another|different|contactor(?:'s|’s)? contacts?|pilot relay|solid[- ]state relay)\b/i;

type Figure = { value: number; written: string };
const amperesIn = (text: string): Figure[] => [...text.matchAll(AMPERE_RE)].map((m) => ({ value: Number(m[1]), written: m[0] }));
/** The currents a question asks to have carried or switched off: its ampere
 *  figures, less each one the question itself labels inrush ("10 A inrush /
 *  5 A holding" asks about 5 A here). */
const loadsIn = (question: string): Figure[] =>
  [...question.matchAll(AMPERE_RE)].flatMap((m) => {
    const at = m.index ?? 0;
    const inrush = INRUSH_AFTER_RE.test(question.slice(at + m[0].length)) || INRUSH_BEFORE_RE.test(question.slice(0, at));
    return inrush ? [] : [{ value: Number(m[1]), written: m[0] }];
  });
const voltagesIn = (text: string): number[] => [...text.matchAll(VOLTAGE_RE)].map((m) => Number(m[1]));

type RatingRow = { volts: number | null; label: string | null; figures: Figure[] };

/** The rating rows of a contact-ratings table, or none when the passage is not one. */
function ratingRows(stored: string): RatingRow[] {
  // The stored column lines repeat the rows; they are read by the WRONG-COLUMN rule only.
  const content = readColumnLines(stored).rest;
  if (!MAKE_BESIDE_BREAK_RE.test(content) || !CONTINUOUS_RE.test(content)) return [];
  const rows: RatingRow[] = [];
  for (const line of content.split("\n")) {
    const figures = amperesIn(line);
    const led = /^\s*(\d+(?:\.\d+)?\s?V(?:\s?(?:AC|DC))?)(?![A-Za-z])/.exec(line);
    if (figures.length >= 2 || (figures.length === 1 && led)) rows.push({ volts: led ? parseFloat(led[1]) : null, label: led ? led[1] : null, figures });
  }
  return rows;
}

/** The ampere figures on the rating rows of a contact-ratings table. */
export function ratingRowAmperes(content: string): number[] {
  return [...new Set(ratingRows(content).flatMap((r) => r.figures.map((f) => f.value)))];
}

/** Answer sentences. Within a block (lines between blank lines), a line that
 *  names a column and carries no figure is a heading for the lines under it:
 *  "Make:" above a bullet, or the head row of a markdown table. */
function sentencesOf(answer: string): string[] {
  const out: string[] = [];
  for (const block of answer.split(/\n\s*\n/)) {
    let heading = "";
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      if (amperesIn(line).length === 0 && COLUMN_WORD_RE.test(line)) {
        heading = line;
        continue;
      }
      for (const sentence of line.split(/(?<=[.!?])\s+/)) if (sentence.trim()) out.push(heading ? `${heading} ${sentence}` : sentence);
    }
  }
  return out;
}

/** The first way the answer fails to keep a ratings table's columns apart, or null. */
export function ratingColumnFinding(question: string, answer: string, passages: RatingPassage[]): RatingColumnFinding | null {
  const read = passages.map((passage) => ({ passage, rows: ratingRows(passage.content), columns: readColumnLines(passage.content).rows }));
  const tables = read.filter((t) => t.rows.length > 0);
  const columned = read.filter((t) => t.columns.length > 0);
  if (tables.length === 0 && columned.length === 0) return null;
  const quoted = amperesIn(answer);
  const where = (t: (typeof read)[number]) => ({ title: t.passage.title, page: t.passage.page });

  // LOAD rule.
  const asked = loadsIn(question);
  if (asked.length > 0) {
    const load = asked.reduce((a, b) => (b.value > a.value ? b : a));
    const askedVolts = voltagesIn(question);
    for (const table of tables) {
      const all = table.rows.flatMap((r) => r.figures);
      const quotesFromIt = CONTACT_QUESTION_RE.test(question) && quoted.some((q) => all.some((f) => f.value === q.value));
      if (!table.passage.cited && !quotesFromIt) continue;
      const matching = table.rows.filter((r) => r.volts !== null && askedVolts.includes(r.volts));
      const lower = (matching.length > 0 ? matching : table.rows).flatMap((r) => r.figures).filter((f) => f.value < load.value);
      if (lower.length === 0) continue;
      if (quoted.some((q) => lower.some((f) => f.value === q.value)) && !approves(answer)) continue;
      // The figures are shown only for the one row the question asked about:
      // figures gathered from every row (AC and DC together) would mislead.
      const one = matching.length === 1 ? matching[0] : null;
      return { rule: "load", ...where(table), load: load.written, row: one ? one.label : null, lower: one ? [...new Set(lower.map((f) => f.written))] : [] };
    }
  }

  // COLUMN rule.
  const cited = tables.filter((t) => t.passage.cited);
  for (const sentence of sentencesOf(answer)) {
    if (COLUMN_WORD_RE.test(sentence)) continue;
    for (const figure of amperesIn(sentence)) {
      const table = cited.find((t) => t.rows.some((r) => r.figures.some((f) => f.value === figure.value)));
      if (table) return { rule: "column", ...where(table), figure: figure.written };
    }
  }

  // WRONG-COLUMN rule. Applies as the LOAD rule does: to a cited table, or to one the answer
  // quotes a placed figure from when the question is about what the table rates.
  const amp = (written: string) => parseFloat(written);
  const placedIn = (rows: ColumnRow[], column: RatingColumn) => rows.flatMap((r) => (r[column] === null ? [] : [amp(r[column] as string)]));
  const rowsAt = (rows: ColumnRow[], volts: number[]) => rows.filter((r) => volts.includes(parseFloat(r.label)));
  const inQuestion = amperesIn(question).map((f) => f.value);
  const askedVolts = voltagesIn(question);
  const judged = columned.filter(
    (t) => t.passage.cited || (CONTACT_QUESTION_RE.test(question) && quoted.some((q) => COLUMNS.some((c) => placedIn(t.columns, c).includes(q.value)))),
  );
  if (judged.length === 0) return null;
  for (const marked of sentencesOf(answer)) {
    // Emphasis marks sit between a column word and its figure ("**Break**: 2 A") and say nothing.
    const sentence = marked.replace(/[*_`]/g, "");
    const figures = [...sentence.matchAll(AMPERE_RE)];
    const edges = [...sentence.matchAll(CLAUSE_EDGE_RE)].map((m) => ({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
    // The sentence's own voltage decides the row; the question's only when the sentence names none.
    const saidVolts = voltagesIn(sentence);
    const volts = saidVolts.length > 0 ? saidVolts : askedVolts;
    const startOf = (k: number) => figures[k].index ?? 0;
    const endOf = (k: number) => startOf(k) + figures[k][0].length;
    const given = (k: number) => inQuestion.includes(Number(figures[k][1]));
    // The column(s) each figure is assigned to, or null when the answer assigns it to none.
    const named: Array<RatingColumn[] | null> = figures.map(() => null);
    const listed = new Set<number>();
    for (let k = 0; k < figures.length; k++) {
      if (listed.has(k)) continue;
      const at = startOf(k);
      const end = endOf(k);
      // A list under a head of several column words: "make and break ratings are 1.5 A and 2 A",
      // "Make / break / continuous: 15 A / 1.5 A / 2 A", a table row under its head row. The
      // figures take the head's columns in the order written.
      const head = columnWordsIn(sentence.slice(k > 0 ? endOf(k - 1) : 0, at));
      const run = [k];
      while (run.length < figures.length - k && LIST_GAP_RE.test(sentence.slice(endOf(run[run.length - 1]), startOf(run[run.length - 1] + 1)))) run.push(run[run.length - 1] + 1);
      // The head may also stand behind the list: "2 A and 15 A are the make and continuous
      // ratings". Then it must name exactly as many columns as the list has figures.
      const last = run[run.length - 1];
      const tail = sentence.slice(endOf(last), last + 1 < figures.length ? startOf(last + 1) : sentence.length);
      const behind = TAIL_HEAD_RE.test(tail) ? columnWordsIn(tail) : [];
      const order = head.length > 1 && run.length <= head.length ? head : behind.length === run.length ? behind : null;
      if (run.length > 1 && order !== null) {
        // The same two excuses a single figure gets: another device's ratings, and a denial ahead
        // of the head ("do not read the make and break ratings as 1.5 A and 2 A").
        const from = k > 0 ? endOf(k - 1) : 0;
        const headAt = order === head ? from + sentence.slice(from, at).search(ANY_COLUMN_WORD_RE) : at;
        const reach = Math.max(from, ...[...sentence.slice(0, headAt).matchAll(DENIAL_ENDS_RE)].map((m) => (m.index ?? 0) + m[0].length));
        const excused = OTHER_DEVICE_RE.test(sentence.slice(from, endOf(last) + tail.length)) || DENIES_RE.test(sentence.slice(reach, headAt));
        run.forEach((f, n) => {
          if (!excused) named[f] = [order[n]];
          listed.add(f);
        });
        continue;
      }
      const clauseFrom = Math.max(0, ...edges.filter((e) => e.end <= at).map((e) => e.end));
      const clauseTo = Math.min(sentence.length, ...edges.filter((e) => e.at >= end).map((e) => e.at));
      // "Before" is the clause up to the figure. The patterns are anchored on the figure and admit
      // another figure only as the load a rating is quoted for ("the make rating for a 5 A coil
      // load is 1.5 A"), so a column word cannot reach across an earlier figure any other way.
      const before = sentence.slice(clauseFrom, at);
      const after = sentence.slice(end, Math.min(clauseTo, k + 1 < figures.length ? startOf(k + 1) : sentence.length));
      const front = COLUMNS.map((c) => ({ c, at: assignedBefore(c, before) })).filter((a) => a.at >= 0);
      const back = COLUMNS.map((c) => ({ c, end: assignedAfter(c, after) })).filter((a) => a.end >= 0);
      if (front.length + back.length === 0) continue;
      if (OTHER_DEVICE_RE.test(sentence.slice(clauseFrom, clauseTo))) continue;
      // A denial reaches the figure only from inside its own clause, and not across a colon or a joining word.
      const denyFrom = Math.max(clauseFrom, ...[...sentence.slice(0, at).matchAll(DENIAL_ENDS_RE)].map((m) => (m.index ?? 0) + m[0].length));
      if (front.length > 0) {
        // Denied only when the denial comes before the column word: "is not rated to break 15 A".
        // After it, the denial is a limit: "the make rating is not more than 1.5 A".
        if (DENIES_RE.test(sentence.slice(denyFrom, clauseFrom + Math.min(...front.map((a) => a.at))))) continue;
      } else {
        // Column word behind the figure: a load ("a 1.5 A steady-state load"), a denial ahead ("do
        // not treat 15 A as the continuous rating") or behind ("a 15 A continuous rating is not available").
        if (LOAD_AFTER_RE.test(sentence.slice(end)) || LOAD_BEFORE_RE.test(sentence.slice(0, at))) continue;
        if (DENIES_RE.test(sentence.slice(denyFrom, at)) || DENIES_RE.test(sentence.slice(end + Math.max(...back.map((a) => a.end)), clauseTo))) continue;
      }
      named[k] = [...new Set([...front.map((a) => a.c), ...back.map((a) => a.c)])];
    }
    for (let k = 0; k < figures.length; k++) {
      const columns = named[k];
      const value = Number(figures[k][1]);
      if (columns === null || given(k)) continue;
      for (const table of judged) {
        // A passage may be one chunk of the page and hold only some rows: with a voltage named,
        // a passage that has no row for it says nothing about the figure.
        const rows = volts.length > 0 ? rowsAt(table.columns, volts) : table.columns;
        if (rows.some((r) => r.unread.some((u) => amp(u) === value))) continue;
        const printed = COLUMNS.filter((c) => placedIn(rows, c).includes(value));
        if (printed.length > 0 && !printed.some((c) => columns.includes(c))) return { rule: "wrong_column", ...where(table), figure: figures[k][0] };
      }
    }
  }
  return null;
}

/** The fixed, server-written text that replaces the draft. Static words, the
 *  file name and page, and (LOAD rule, one matching row) the load as asked and
 *  the lower figures exactly as the row writes them. No column is claimed for
 *  any figure, and nothing is said about what the draft concluded. The wording
 *  gives no hands-on instruction: "open …" reads as one to the
 *  isolation-advisory check, which would put a lockout banner over a pointer
 *  to a table. */
export function ratingColumnText(found: RatingColumnFinding): string {
  const table = found.page === null || found.page === "" ? found.title : `${found.title}, p. ${found.page}`;
  const columns =
    "A load that stays on is judged against the continuous figure, and a load the contact must switch off against the break figure. The make figure is the limit for the surge when the contact closes. For an inductive load such as a coil, the table may also give a volt-ampere (VA) rating, and that applies too.";
  if (found.rule === "load") {
    const below =
      found.row && found.lower.length > 0
        ? `its ${found.row} row carries ${found.lower.length === 1 ? "a figure" : "figures"} below your ${found.load} load: ${found.lower.join(", ")}. The table's column headings say which figure is which`
        : `it carries figures below your ${found.load} load. The row for your voltage and current type (AC or DC) is the one that applies`;
    return `I can't confirm that load is within the contact ratings, so I'm withholding my draft answer. The contact ratings table in ${table} lists separate make, break and continuous figures, and ${below}. ${columns}`;
  }
  if (found.rule === "wrong_column")
    return `I'm withholding my draft answer: it named a column for a figure from a contact ratings table, and the table prints that figure under a different column. The table in ${table} lists separate make, break and continuous figures. The row for your voltage and current type (AC or DC) is the one that applies. ${columns}`;
  return `I'm withholding my draft answer: it quoted one figure from a contact ratings table without saying which. The table in ${table} lists separate make, break and continuous figures. The row for your voltage and current type (AC or DC) is the one that applies. ${columns}`;
}
