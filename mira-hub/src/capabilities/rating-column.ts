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
 *   LOAD rule — the question names a load current (a figure it calls inrush
 *   or surge is not one: that is judged against the make figure, which this
 *   rule cannot pick out), and a ratings table the
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
 *   - which column a figure belongs to is NOT worked out: the flattened page
 *     text does not keep columns in order, and a guess would be worse than
 *     none. So an answer that shows the lower figure and approves the load
 *     in the middle of a sentence ("… 2 A continuous, so it can be switched")
 *     passes the LOAD rule, and "the contact runs continuously at 15 A" passes
 *     the COLUMN rule;
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

/** A passage the answer was given. `cited`: the answer carries its [n]. */
export type RatingPassage = { content: string; title: string; page: number | string | null; cited: boolean };

/** What was found, and the table it is from. */
export type RatingColumnFinding = { title: string; page: number | string | null } & (
  /** `row` and `lower` are set only when exactly one row is the asked voltage's. */
  | { rule: "load"; load: string; row: string | null; lower: string[] }
  | { rule: "column"; figure: string }
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
// A current the question itself calls a closing surge: "10 A inrush", "inrush of 10 A".
const INRUSH_RE = /\b(?:inrush|in-rush|surge|pull-in|pick-?up)\b/i;
// The LOAD rule reads an UNCITED table only for a question about what the table rates.
const CONTACT_QUESTION_RE = /\b(?:relay|contacts?|outputs?|switch(?:es|ed|ing)?)\b/i;

type Figure = { value: number; written: string };
const amperesIn = (text: string): Figure[] => [...text.matchAll(AMPERE_RE)].map((m) => ({ value: Number(m[1]), written: m[0] }));
/** The currents a question asks to have carried or switched off: its ampere
 *  figures, less any that its own clause calls inrush ("10 A inrush and 1 A
 *  holding" asks about 1 A here). */
const loadsIn = (question: string): Figure[] =>
  question.split(/[,;()]|\b(?:and|with|but)\b/i).flatMap((clause) => (INRUSH_RE.test(clause) ? [] : amperesIn(clause)));
const voltagesIn = (text: string): number[] => [...text.matchAll(VOLTAGE_RE)].map((m) => Number(m[1]));

type RatingRow = { volts: number | null; label: string | null; figures: Figure[] };

/** The rating rows of a contact-ratings table, or none when the passage is not one. */
function ratingRows(content: string): RatingRow[] {
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
  const tables = passages.map((passage) => ({ passage, rows: ratingRows(passage.content) })).filter((t) => t.rows.length > 0);
  if (tables.length === 0) return null;
  const quoted = amperesIn(answer);
  const where = (t: (typeof tables)[number]) => ({ title: t.passage.title, page: t.passage.page });

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
  return `I'm withholding my draft answer: it quoted one figure from a contact ratings table without saying which. The table in ${table} lists separate make, break and continuous figures. The row for your voltage and current type (AC or DC) is the one that applies. ${columns}`;
}
