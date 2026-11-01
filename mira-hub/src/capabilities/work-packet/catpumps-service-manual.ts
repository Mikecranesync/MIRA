/**
 * CAT Pumps service-manual parser (#4982, agent B).
 *
 * Turns the plain-text pages of a CAT Pumps service manual (unpdf page text, or the notebook's
 * stored chunks stitched back into pages — see `document-text.ts`) into the structured
 * `ServiceManual` the work-packet draft builder reads. Pure function, no I/O, no model calls:
 * every section/step/torque-row/caution is read verbatim off a cited line, or the manual's own
 * problem is recorded in `problems` and the content is left out — never guessed, never mixed
 * across columns.
 *
 * Two real layouts this was built and checked against:
 *  - `CPSvc5` (3CP/5CP/7CP family): "SERVICING THE X" headings, "Disassembly"/"Reassembly"
 *    subheadings with NO model restriction, and nested "<Label> Models:" / bare model-list
 *    sub-blocks inside Reassembly (e.g. "Hi-Pressure Seal Models:", "V-Packing Models:").
 *    Torque rows carry `[part no]` inline, in the same bracket as the tool column.
 *  - `35FR2Svc` (35-frame family): "Disassembly (All models except 3560)" / "Reassembly (Model
 *    3560)" parenthetical model scopes, and nested bare "Models 3535, 3531, 3537" headers.
 *    Torque rows carry `[part no]` on the FOLLOWING physical line (sometimes glued to a
 *    continuation of the item name that wrapped — "Rear Cover/" + "Bearing Cover Screws
 *    [25324]" is one row, one item name, one part number).
 */

import type { DocText, ModelScope, PageText, ServiceManual, SmCaution, SmOmittedCaution, SmOmittedSection, SmSection, SmStep, SmTorque, SourceRef, Topic } from "./types";

// ─────────────────────────────────────────────── recognition + model-list helpers

const SERVICE_MANUAL_TITLE = /SERVICE MANUAL/i;
const CAT_PUMPS = /CAT\s*PUMPS/i;

/** A bare token that could be a CAT Pumps model: digit-first, 2-8 alphanumerics
 *  ("3520", "3520C", "5CP6120", "5CP2140WCS", "3CP1120", "3560"). */
// Up to 12 chars: CAT suffixes run long ("5CP2140WCS", "5CP6120CSSG1").
const MODEL_TOKEN_RE = /^\d[\dA-Za-z]{1,11}$/;

function isModelToken(s: string): boolean {
  return MODEL_TOKEN_RE.test(s.trim());
}

/** Splits "3520, 3521 and 3527" / "3535, 3531, 3537" / "3560" into model tokens. */
function splitModelList(s: string): string[] {
  return s
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((t) => t.trim().replace(/[.:]+$/, ""))
    .filter(Boolean);
}

/** True when every comma/"and"-separated piece of `s` looks like a model token — i.e. the whole
 *  line IS a model list and nothing else (used both for the cover-page model roster and to
 *  recognize + skip figure-caption model/description pairs during step parsing). */
function isModelListLine(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^all\s+models(\s+except\s+[\dA-Za-z, ]+)?$/i.test(t)) return true;
  const parts = splitModelList(t);
  return parts.length > 0 && parts.every(isModelToken);
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/** True when `next` must NOT be joined onto a caution/step whose text so far is `soFar`, because it
 *  is page furniture the extractor interleaved rather than the sentence wrapping: a tightening-
 *  sequence diagram ("1 3 5 7 8 6 4 2"), a trademark footnote, a model-list caption line, or a
 *  Title Case figure title with no sentence punctuation that follows a finished sentence
 *  ("Removal of Discharge Valve Plug"). A mid-sentence wrap never ends the previous line with a full stop, so it still joins. */
function isInterleavedFurniture(soFar: string, next: string): boolean {
  if (/^[\d\s]+$/.test(next)) return true;
  if (/registered trademarks?/i.test(next)) return true;
  if (isModelListLine(next)) return true;
  const sentenceDone = /[.!?)]$/.test(soFar.trim());
  return sentenceDone && looksLikeFigureTitle(next);
}

/** A figure title, recognised by an allow-list rather than by what it lacks (Codex #5062 F15,
 *  rounds 6–8): every word is a Title Case word ("Removal", "Lo-Pressure", "O-Rings",
 *  "V-Packing-Spacer"), a model number ("3531,"), or one of a few small joining words — real titles
 *  carry "of", "and", "from" ("Removal of V-Packing Spacer from Inlet Manifold", 35FR2Svc p.3) and
 *  "with" ("V-Packing Spacer and Spacer with Coil Springs", p.4). A word may end in a comma and
 *  Title Case words may be joined by "/" ("Valve Plug, O-Ring and Back-up Ring", CPSvc5 p.2;
 *  "Stacked Inlet/Discharge Valve Design", 35FR2Svc p.2). Anything else — an all-caps
 *  warning ("DO NOT RUN PUMP WITHOUT OIL IN"), a unit ("(0 psi)"), a lowercase word, punctuation —
 *  makes the line content, never a title. */
const TITLE_SMALL_WORDS = new Set(["of", "and", "the", "to", "for", "in", "on", "a", "an", "or", "from", "with"]);
const TITLE_WORD_RE = /^(?:[A-Z][a-z]+|[A-Z])(?:-(?:[A-Z][a-z]*|[a-z]+))*$/;
function looksLikeFigureTitle(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  let titleWords = 0;
  for (const raw of words) {
    const w = raw.replace(/,$/, "");
    if (TITLE_SMALL_WORDS.has(w)) continue;
    if (isModelToken(w)) continue;
    if (w.length < 2 || !w.split("/").every((part) => TITLE_WORD_RE.test(part))) return false;
    titleWords++;
  }
  return titleWords > 0;
}

// ─────────────────────────────────────────────── cover page → modelsCovered

/** Extracts the cover block's model roster: lines of the shape "<LABEL>: <list>" (CPSvc5's
 *  "3CP MODELS: 3CP1120, 3CP1130, 3CP1140") or "<LABEL ...>: <list>" whose list wraps onto bare
 *  continuation lines (35FR2Svc's "35 FRAME SPLIT MANIFOLD: 3520, 3521 and 3527" / "3535, 3531
 *  and 3537" / …), scanned only up to the first "SPECIFICATIONS:" marker so later torque/part
 *  numbers in the body are never mistaken for the model roster. */
function extractModelsCovered(coverText: string): string[] {
  const lines = coverText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const specIdx = lines.findIndex((l) => /^SPECIFICATIONS:/i.test(l));
  const scan = specIdx === -1 ? lines : lines.slice(0, specIdx);
  const models: string[] = [];
  let inListBlock = false;
  for (const line of scan) {
    const colon = line.indexOf(":");
    if (colon !== -1 && colon <= 40) {
      const label = line.slice(0, colon);
      const after = line.slice(colon + 1).trim();
      // Only a short label counts (excludes "SPECIFICATIONS: Maximum specifications refer…"
      // style sentences that happen to contain a colon deeper in).
      if (label.length <= 40 && isModelListLine(after)) {
        models.push(...splitModelList(after));
        inListBlock = true;
        continue;
      }
    }
    if (inListBlock && isModelListLine(line)) {
      models.push(...splitModelList(line));
      continue;
    }
    inListBlock = false;
  }
  return dedupe(models);
}

// ─────────────────────────────────────────────── model scope parsing

const EMPTY_SCOPE: ModelScope = Object.freeze({ include: [], exclude: [] }) as ModelScope;

function scopeAll(): ModelScope {
  return { include: [], exclude: [] };
}

function scopeUnresolved(): ModelScope {
  return { include: [], exclude: [], unresolved: true };
}

/** A nested model list ("Models 3535, 3531") inside "Disassembly (All models except 3560)" keeps
 *  the outer restriction: excludes add up, includes narrow, unresolved is sticky. */
function intersectScopes(outer: ModelScope, inner: ModelScope): ModelScope {
  const include =
    outer.include.length === 0 ? inner.include : inner.include.length === 0 ? outer.include : inner.include.filter((m) => outer.include.includes(m));
  const scope: ModelScope = { include, exclude: dedupe([...outer.exclude, ...inner.exclude]) };
  // Both sides named models but none in common: nothing is admitted rather than everything.
  if (outer.include.length > 0 && inner.include.length > 0 && include.length === 0) scope.unresolved = true;
  if (outer.unresolved || inner.unresolved) scope.unresolved = true;
  return scope;
}

/** Parses the parenthetical / bare model-restriction phrases this manual uses:
 *    "All models except 3560"  -> exclude ["3560"]
 *    "Model 3560" / "Models 3535, 3531, 3537" / "3535, 3531, 3537 Only" -> include [...]
 *  Returns null when the text isn't a recognizable model-scope phrase at all. */
function parseModelScopePhrase(text: string): ModelScope | null {
  const t = text.trim();
  const except = t.match(/^all\s+models\s+except\s+(.+)$/i);
  if (except) return { include: [], exclude: splitModelList(except[1]) };
  if (/^all\s+models$/i.test(t)) return scopeAll();
  const modelsOnly = t.match(/^models?\s+(.+?)\s+only$/i);
  if (modelsOnly) return { include: splitModelList(modelsOnly[1]), exclude: [] };
  // "8520 Only" / "3535, 3531, 3537 Only" — the bare-number restriction form.
  const bareOnly = t.match(/^(.+?)\s+only$/i);
  if (bareOnly && isModelListLine(bareOnly[1])) return { include: splitModelList(bareOnly[1]), exclude: [] };
  const models = t.match(/^models?\s+(.+)$/i);
  if (models && isModelListLine(models[1])) return { include: splitModelList(models[1]), exclude: [] };
  return null;
}

// ─────────────────────────────────────────────── section headings + subheadings

const SECTION_HEADING_RE = /^(SERVICING THE [A-Z][A-Z \-]*|REMOVING THE [A-Z][A-Z \-]*)$/;
/** Headings that close out the procedure body of a page — everything after one of these on a
 *  page is reference material (inlet checklist, PM schedule, tech-bulletin index), never steps. */
const BODY_END_HEADING_RE = /^(INLET CONDITION CHECK-LIST|PREVENTATIVE MAINTENANCE CHECK-LIST|TECHNICAL BULLETIN REFERENCE CHART)$/;
const TORQUE_HEADING_RE = /^TORQUE CHART$/;

function isAllCapsHeading(line: string): boolean {
  return line.length > 0 && line === line.toUpperCase() && /[A-Z]/.test(line);
}

function topicFor(heading: string): Topic | "other" {
  const h = heading.toUpperCase();
  if (h.includes("VALVE")) return "valves";
  if (h.includes("SEAL") || h.includes("PACKING")) return "seals";
  if (h.includes("PLUNGER")) return "plungers";
  if (h.includes("CRANKCASE")) return "crankcase";
  return "other";
}

/** Subheading patterns recognized inside a section, in priority order:
 *   1. "Disassembly (All models except 3560)" / "Reassembly (Model 3560)"   — 35FR2Svc
 *   2. "Disassembly" / "Reassembly" / "Disassembly of the V-Packings" (bare, no scope)
 *   3. "Models 3535, 3531, 3537" (bare numeric model-list header, nested one level deeper)
 *   4. "<Label> Models:" (e.g. "Hi-Pressure Seal Models:", "Lo-Pressure Seal-All Models:") —
 *      CPSvc5's nested procedural headers. These name a hardware variant, not a pump-model
 *      restriction the manual restates locally; scope defaults to "all" and that gap is
 *      recorded in `problems` rather than guessed.
 */
interface SubheadingMatch {
  text: string;
  scope: ModelScope;
  /** true for a model-list or hardware-variant header nested under a Disassembly/Reassembly phase. */
  nested?: boolean;
  /** false for case 4 — the scope could not be resolved locally; caller records a `problems` note. */
  scopeKnown: boolean;
}

function matchSubheading(line: string): SubheadingMatch | null {
  const paren = line.match(/^(Disassembly|Reassembly)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const parsed = parseModelScopePhrase(paren[2]);
    // An unrecognized restriction is never widened to "all models".
    return { text: line, scope: parsed ?? scopeUnresolved(), scopeKnown: parsed !== null };
  }
  if (/^(Disassembly|Reassembly)(\s+of\s+the\s+[A-Za-z][A-Za-z \-]*)?\s*$/.test(line)) {
    return { text: line, scope: scopeAll(), scopeKnown: true };
  }
  const bareModels = line.match(/^Models?\s+([\dA-Za-z, ]+?)\s*:?\s*$/);
  if (bareModels && isModelListLine(bareModels[1])) {
    return { text: line, scope: { include: splitModelList(bareModels[1]), exclude: [] }, scopeKnown: true, nested: true };
  }
  const labelModels = line.match(/^([A-Za-z][A-Za-z \-]+Models):\s*$/);
  if (labelModels) {
    // "Lo-Pressure Seal-All Models:" applies to every model; "Hi-Pressure Seal Models:" /
    // "V-Packing Models:" are alternative hardware variants — which one this pump has is not
    // stated, so that block is unresolved, not "all".
    // Both sit inside the current Disassembly/Reassembly phase, so they keep its model restriction
    // (Codex #5062 F9).
    if (/all\s+models$/i.test(labelModels[1])) return { text: line, scope: scopeAll(), scopeKnown: true, nested: true };
    return { text: line, scope: scopeUnresolved(), scopeKnown: false, nested: true };
  }
  return null;
}

// ─────────────────────────────────────────────── cautions

const CAUTION_MARKER_RE = /^(CAUTION|WARNING|NOTE|IMPORTANT):\s*(.*)$/;

function isAnyMarkerStart(line: string): boolean {
  return CAUTION_MARKER_RE.test(line);
}

// ─────────────────────────────────────────────── torque chart

// Groups: 1=pre (item name or model-list prefix), 2=thread, 3=tool (may still carry an inline
// "[part no]" bracket), 4=in-lbs, 5=ft-lbs, 6=Nm. (Plain numbered groups — named capture groups
// need an ES2018+ target, and this repo's tsconfig targets ES2017.)
const TORQUE_ROW_RE = /^(.+?)\s+(M\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;
const BRACKET_RE = /\[([^\]}]+)[\]}]/;
/** A continuation line carrying only "[part no]", or the tail of a wrapped item name glued to
 *  "[part no]" ("Bearing Cover Screws [25324]"). Groups: 1=rest of the item name, 2=part number. */
const TORQUE_CONT_RE = /^(.*?)\s*\[([^\]}]+)[\]}]\s*$/;

function stripBracket(s: string): { text: string; part: string | null } {
  const m = s.match(BRACKET_RE);
  if (!m) return { text: s.trim(), part: null };
  return { text: s.replace(BRACKET_RE, "").replace(/\s{2,}/g, " ").trim(), part: m[1].trim() };
}

function torqueConsistent(inLbs: string, ftLbs: string, nm: string): boolean {
  const i = Number(inLbs);
  const f = Number(ftLbs);
  const n = Number(nm);
  if (!Number.isFinite(i) || !Number.isFinite(f) || !Number.isFinite(n) || f === 0) return false;
  const inOk = Math.abs(i - f * 12) / (f * 12) <= 0.02;
  const nmOk = Math.abs(n - f * 1.356) / (f * 1.356) <= 0.02;
  return inOk && nmOk;
}

function parseTorqueChart(
  lines: string[],
  startIdx: number,
  page: number,
  src: Omit<SourceRef, "line" | "page">,
): { rows: SmTorque[]; nextIdx: number } {
  const rows: SmTorque[] = [];
  let lastItem: string | null = null;
  let i = startIdx;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (BODY_END_HEADING_RE.test(line) || SECTION_HEADING_RE.test(line) || TORQUE_HEADING_RE.test(line)) break;
    if (/^Pump Item/i.test(line) || /^\[Part No\.?\]/i.test(line)) continue; // table header rows
    const m = line.match(TORQUE_ROW_RE);
    if (!m) {
      // A bare line with no thread/torque numbers at all (CPSvc5's "Valve Plugs" / "Bearing
      // Cover Screws" group headers) names the item for the per-model rows that follow it.
      // A line already carrying "[part no]" is a continuation the previous row's lookahead
      // should have consumed, not a new header — never let it overwrite lastItem.
      if (!BRACKET_RE.test(line)) lastItem = line;
      continue;
    }
    const [, preRaw, thread, toolRaw, inLbs, ftLbs, nm] = m;
    const pre = preRaw.trim();
    let item: string;
    let scope: ModelScope;
    const phraseScope = parseModelScopePhrase(pre);
    if (phraseScope && lastItem) {
      item = lastItem;
      scope = phraseScope;
    } else if (isModelListLine(pre) && lastItem) {
      item = lastItem;
      scope = { include: splitModelList(pre), exclude: [] };
    } else {
      item = pre;
      lastItem = item;
      scope = scopeAll();
    }
    const { text: toolText, part: inlinePart } = stripBracket(toolRaw);
    let partNumber = inlinePart;
    // Look at the next physical line: either a bare "[pn]" continuation, or a wrapped tail of
    // the item name glued to "[pn]" — never consumed if it's itself a full torque row.
    const next = lines[i + 1];
    if (partNumber === null && next !== undefined && !TORQUE_ROW_RE.test(next)) {
      const cont = next.match(TORQUE_CONT_RE);
      if (cont) {
        const rest = cont[1].trim();
        if (rest) item = `${item} ${rest}`.trim();
        partNumber = cont[2].trim();
        i++;
      }
    }
    rows.push({
      item,
      partNumber,
      thread,
      tool: toolText || null,
      inLbs,
      ftLbs,
      nm,
      models: scope,
      consistent: torqueConsistent(inLbs, ftLbs, nm),
      source: { ...src, page, line },
    });
  }
  return { rows, nextIdx: i };
}

// ─────────────────────────────────────────────── main walk: sections, steps, cautions

const STEP_RE = /^(\d{1,2})\.\s+(.*)$/;

interface OpenSection {
  heading: string;
  subheading: string | null;
  topic: Topic | "other";
  models: ModelScope;
  page: number;
  steps: SmStep[];
  firstLines: string[]; // first line of each step, parallel to steps, for order-jump detection
  /** Set when text after one of its steps could not be placed — it may be the rest of that step
   *  (Codex #5062 F15). The section is then omitted and becomes a cited gap. */
  incomplete: string | null;
}

/** The last step or caution emitted, for orphan-text accounting (Codex #5062 F15). Every
 *  non-furniture line inside a procedure must be consumed as a step, caution, heading, torque row
 *  or caption; a line that is not ("orphan text") may be the rest of this block — a page-cut
 *  continuation, or text after a diagram — so the block is never shown as verified. Text is not
 *  joined across pages (each citation is one page); the block fails closed to a gap instead. */
type LastBlock = { kind: "step"; n: number; page: number; text: string } | { kind: "caution"; caution: SmCaution; text: string };

/** One orphan line and what it tainted — reported to the optional `onOrphan` hook (real-manual checks). */
export interface OrphanLine {
  page: number;
  line: string;
  tainted: string | null;
}

/** Page header/footer lines the extractor interleaves into the body. Only shapes that occur verbatim
 *  in real CAT manuals: the part-number/revision line ("PN 30009 Rev J 8405", "PN 33009 Rev J 7709")
 *  and the headquarters address line ("1681 - 94th Lane N.E. Minneapolis, MN 55449 - 4324"). A
 *  "repeats on several pages" rule is deliberately absent: in real manuals the repeated lines are
 *  content ("needed.", "hand.", a NOTE), so it would hide exactly the continuations this guards. */
/** Lines that can never carry an instruction: page header/footer furniture, a trademark footnote,
 *  a bare digit sequence (a tightening-sequence diagram). Skipped wherever they fall. */
function isHardFurniture(line: string): boolean {
  return isPageFurniture(line) || /^[\d\s]+$/.test(line) || /registered trademarks?/i.test(line);
}

function isPageFurniture(line: string): boolean {
  if (/^PN\s+\d{4,6}\s+Rev\s+[A-Z]\b/.test(line)) return true;
  if (/Minneapolis,\s*MN\b/.test(line)) return true;
  return false;
}

function flushSection(open: OpenSection | null, sections: SmSection[], problems: string[], omitted: SmOmittedSection[]): void {
  if (!open || open.steps.length === 0) return;
  const nums = open.steps.map((s) => s.n).filter((n): n is number => n !== null);
  let outOfOrder = false;
  for (let k = 1; k < nums.length; k++) {
    if (nums[k] !== nums[k - 1] + 1) {
      outOfOrder = true;
      break;
    }
  }
  if (open.incomplete) {
    const where = `${open.heading}${open.subheading ? " — " + open.subheading : ""}`;
    problems.push(`page ${open.page}: "${where}": ${open.incomplete}`);
    omitted.push({ heading: open.heading, subheading: open.subheading, topic: open.topic, models: open.models, page: open.page, source: open.steps[0].source, reason: open.incomplete });
    return;
  }
  if (outOfOrder) {
    const reason = `step numbers out of order (saw ${nums.join(",")}) — likely a two-column extraction garble; steps omitted rather than mixed`;
    const where = `${open.heading}${open.subheading ? " — " + open.subheading : ""}`;
    problems.push(`page ${open.page}: step numbers out of order in "${where}" (saw ${nums.join(",")}) — likely a two-column extraction garble; steps omitted rather than mixed`);
    omitted.push({
      heading: open.heading,
      subheading: open.subheading,
      topic: open.topic,
      models: open.models,
      page: open.page,
      source: open.steps[0].source,
      reason,
    });
    return;
  }
  sections.push({
    heading: open.heading,
    subheading: open.subheading,
    topic: open.topic,
    models: open.models,
    steps: open.steps,
    page: open.page,
  });
}

export function parseCatPumpsServiceManual(doc: DocText, onOrphan?: (o: OrphanLine) => void): ServiceManual | null {
  const page1 = doc.pages.find((p) => p.page === 1) ?? doc.pages[0];
  if (!page1) return null;
  if (!SERVICE_MANUAL_TITLE.test(page1.text) || !CAT_PUMPS.test(page1.text)) return null;
  const modelsCovered = extractModelsCovered(page1.text);
  if (modelsCovered.length === 0) return null;

  const src: Omit<SourceRef, "line" | "page"> = { docId: doc.docId, fileId: doc.fileId, filename: doc.filename };
  const sections: SmSection[] = [];
  const torque: SmTorque[] = [];
  const cautions: SmCaution[] = [];
  const problems: string[] = [];
  const omitted: SmOmittedSection[] = [];
  const omittedCautions: SmOmittedCaution[] = [];

  let open: OpenSection | null = null;
  // Scope of the last Disassembly/Reassembly subheading in the open section; a nested model-list
  // header narrows it instead of replacing it.
  let phaseScope: ModelScope = scopeAll();
  // Persists across pages like `open`; cleared at every section/subheading/torque/body-end boundary.
  let lastBlock: LastBlock | null = null;

  const sorted: PageText[] = [...doc.pages].sort((a, b) => a.page - b.page);

  for (const pg of sorted) {
    const lines = pg.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // Lines the PDF layout places in a figure (caption) band — known only when the original PDF was
    // read (`document-text.ts`); absent for chunk text, where every unplaced line counts.
    const figure = new Set(pg.figureLines ?? []);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (TORQUE_HEADING_RE.test(line)) {
        flushSection(open, sections, problems, omitted);
        open = null;
        lastBlock = null;
        const { rows, nextIdx } = parseTorqueChart(lines, i + 1, pg.page, src);
        torque.push(...rows);
        i = nextIdx - 1;
        continue;
      }

      if (BODY_END_HEADING_RE.test(line)) {
        flushSection(open, sections, problems, omitted);
        open = null;
        lastBlock = null;
        break; // rest of this page is reference material (checklists, PM schedule, bulletin index)
      }

      const marker = line.match(CAUTION_MARKER_RE);
      if (marker) {
        const kind = marker[1] as SmCaution["kind"];
        const textParts = [marker[2]];
        let j = i + 1;
        while (
          j < lines.length &&
          lines[j].length > 0 &&
          !isAnyMarkerStart(lines[j]) &&
          !STEP_RE.test(lines[j]) &&
          !SECTION_HEADING_RE.test(lines[j]) &&
          !BODY_END_HEADING_RE.test(lines[j]) &&
          !TORQUE_HEADING_RE.test(lines[j]) &&
          !matchSubheading(lines[j]) &&
          !figure.has(lines[j]) &&
          !isInterleavedFurniture(textParts.join(" "), lines[j])
        ) {
          textParts.push(lines[j]);
          j++;
        }
        // The source is the exact run of physical lines the text was joined from, so a number that
        // wrapped onto a continuation line is still checkable word-for-word against its source.
        const cautionText = textParts.join(" ").replace(/\s{2,}/g, " ").trim();
        const cautionSource = { ...src, page: pg.page, line: lines.slice(i, j).join(" ") };
        const caution: SmCaution = { kind, text: cautionText, source: cautionSource };
        cautions.push(caution);
        lastBlock = { kind: "caution", caution, text: cautionText };
        i = j - 1;
        continue;
      }

      if (SECTION_HEADING_RE.test(line) && isAllCapsHeading(line)) {
        flushSection(open, sections, problems, omitted);
        open = { heading: line, subheading: null, topic: topicFor(line), models: scopeAll(), page: pg.page, steps: [], firstLines: [], incomplete: null };
        phaseScope = scopeAll();
        lastBlock = null;
        continue;
      }

      const sub: SubheadingMatch | null = open ? matchSubheading(line) : null;
      if (sub) {
        flushSection(open, sections, problems, omitted);
        if (!sub.scopeKnown) {
          problems.push(
            `page ${pg.page}: subheading "${sub.text}" has a model or hardware-variant restriction that could not be resolved — its steps are left out of packets rather than guessed`,
          );
        }
        const sectionModels: ModelScope = sub.nested ? intersectScopes(phaseScope, sub.scope) : sub.scope;
        if (!sub.nested) phaseScope = sub.scope;
        open = { heading: open!.heading, subheading: sub.text, topic: open!.topic, models: sectionModels, page: pg.page, steps: [], firstLines: [], incomplete: null };
        lastBlock = null;
        continue;
      }

      const step = line.match(STEP_RE);
      if (step && open) {
        const n = Number(step[1]);
        const textParts = [step[2]];
        let j = i + 1;
        while (
          j < lines.length &&
          lines[j].length > 0 &&
          !STEP_RE.test(lines[j]) &&
          !isAnyMarkerStart(lines[j]) &&
          !SECTION_HEADING_RE.test(lines[j]) &&
          !BODY_END_HEADING_RE.test(lines[j]) &&
          !TORQUE_HEADING_RE.test(lines[j]) &&
          !matchSubheading(lines[j]) &&
          !figure.has(lines[j]) &&
          !isInterleavedFurniture(textParts.join(" "), lines[j])
        ) {
          textParts.push(lines[j]);
          j++;
        }
        const stepText = textParts.join(" ").replace(/\s{2,}/g, " ").trim();
        lastBlock = { kind: "step", n, page: pg.page, text: stepText };
        open.steps.push({
          n,
          text: stepText,
          // Same as cautions: the source spans every physical line the step text was joined from.
          source: { ...src, page: pg.page, line: lines.slice(i, j).join(" ") },
        });
        open.firstLines.push(line);
        i = j - 1;
        continue;
      }

      // Orphan text: not consumed above. Only hard furniture and layout-confirmed figure lines are
      // skipped; a line that merely looks like a caption may be the rest of the block before it —
      // the words alone cannot tell (Codex #5062 F15, rounds 6–9) — so it fails closed. Intro prose
      // before a section's first step or caution has no `lastBlock` and stays dropped.
      if (isHardFurniture(line) || figure.has(line)) continue;
      let tainted: string | null = null;
      if (lastBlock?.kind === "step" && open) {
        tainted = `step ${lastBlock.n} (p.${lastBlock.page})`;
        if (!open.incomplete) {
          open.incomplete = `text after step ${lastBlock.n} (p.${lastBlock.page}) could not be placed — it may be the rest of that step, e.g. "${line.slice(0, 60)}"; steps omitted rather than shown in part`;
        }
      } else if (lastBlock?.kind === "caution") {
        const c = lastBlock.caution;
        tainted = `${c.kind} (p.${c.source.page})`;
        const idx = cautions.indexOf(c);
        if (idx !== -1) {
          cautions.splice(idx, 1);
          const reason = `text after it could not be placed — it may be the rest of this ${c.kind}, e.g. "${line.slice(0, 60)}"`;
          problems.push(`page ${c.source.page}: a ${c.kind} is followed by text that could not be placed — not shown as verified`);
          omittedCautions.push({ kind: c.kind, source: c.source, reason });
        }
        lastBlock = null;
      }
      onOrphan?.({ page: pg.page, line, tainted });
    }
  }
  flushSection(open, sections, problems, omitted);

  return { kind: "catpumps_service_manual", modelsCovered, sections, torque, cautions, problems, omitted, omittedCautions };
}
