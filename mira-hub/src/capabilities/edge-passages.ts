/**
 * #5265 edge profile — the passage answer capability. Selection and wording of
 * the on-device notebook answer, kept out of the route and out of src/lib.
 */
import type { TurnUsage } from "@/lib/inference/canonical-cascade";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { isNavigationChunk } from "@/lib/notebook-query";
import { relevantQuoteWindow } from "@/lib/quote-window";
/**
 * "AI finds, manual speaks." On the tablet the notebook answer IS the matching
 * manual passages, word for word with page — no model-written text. Measured
 * 2026-11-07 (W0 tablet spike): the full grounded prompt (3,438 tokens) took
 * 53 s on the 1.5B model and came back with no [n] markers, so every answer was
 * labelled ungrounded; on a short prompt it still wrote no markers and got the
 * how-to wrong. Retrieval already ran in Postgres, so the passages cost nothing.
 */
export const EDGE_PASSAGE_LIMIT = 3;
export const EDGE_PASSAGE_CHARS = 600;
export const EDGE_PASSAGES_LEAD = "Matching passages from this notebook's manuals, word for word. Open the page and read it in full before acting.";
// Opens with the Gate-G abstain sentence so the answer gate reads it as a refusal.
export const EDGE_NO_PASSAGE_TEXT =
  "I couldn't find support for that in this notebook's manuals. Try the manual's own wording, or refer it to a qualified person.";

export type EdgePassage = {
  citation: EvidenceCitation;
  text: string;
  /** The parameter this passage DEFINES, as printed on its code line (see parameterDefinition). */
  definition?: { code: string; name: string } | null;
  /** The manual's printed page label for the cited page ("4-69"), when ingest kept one. */
  pageLabel?: string | null;
  /** Edition/revision as printed in the cited chunk ("1st Ed., Rev C"). Never guessed. */
  revision?: string | null;
  /** Consequence sentences the definition's page prints about the parameter (definitionCautions). */
  cautions?: string[];
};

type EdgeChunk = { content: string; sourceUrl: string; sourcePage: number | null; pageLabel?: string | null };

/** A parameter code as manuals print it: P01.12, Pr.01-12, 01.12, F1-04 style rows start a line. */
const PARAM_LINE_RE = /(?:^|\n)[ \t]*((?:P|Pr\.?\s?)?\d{1,2}[.-]\d{2})[ \t]+([A-Za-z][^\n]{2,80})/g;
// Where a printed name ends: the access marker, a value with units ("10 (sec.)"), or a register column.
const NAME_END_RE = /\s*(?:♦|R\/W|\s\d+(?:\.\d+)?\s*\(|\s[0-9A-F]{4}\s+\d{5}).*$/;
function printedName(raw: string): string {
  return raw.replace(NAME_END_RE, "").trim();
}
const EXPLICIT_CODE_RE = /\b(P\d{1,2}\.\d{2})\b/i;
// Words that say nothing about WHICH parameter: the question's frame, not its subject.
const FRAME_WORDS = new Set([
  "which", "what", "parameter", "parameters", "controls", "control", "explain", "cite", "exact", "manual",
  "page", "drive", "this", "that", "project", "does", "recommend", "setting", "settings", "assume", "present",
  "current", "about", "from", "with", "into", "should", "would", "could", "there", "their", "where", "when",
  "have", "show", "tell", "find", "value", "values", "change", "adjust", "number",
]);
const DEFINING_VERB_RE = /\b(?:determines?|sets?|specif(?:y|ies)|defines?|is used to|controls?|selects?)\b/i;

function stem(w: string): string {
  return w.slice(0, 6);
}

function subjectTerms(question: string): Set<string> {
  const out = new Set<string>();
  for (const w of question.toLowerCase().split(/[^a-z]+/)) {
    if (w.length >= 4 && !FRAME_WORDS.has(w)) out.add(stem(w));
  }
  return out;
}

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
}

/**
 * The parameter the question is about, read from the retrieved text only.
 * A code typed in the question wins. Otherwise a printed code line whose name
 * the question's subject words cover ("acceleration time" → "P01.12
 * Acceleration Time 1"): at least two name words matched and at least 60% of
 * them. Ties go to the code printed most often across the retrieved chunks,
 * then to the one retrieved first. Null when nothing qualifies, so a vague
 * question never gets a parameter pinned on it.
 */
export function identifyParameter(chunks: EdgeChunk[], question: string): { code: string; name: string } | null {
  const lines: { code: string; name: string; rank: number }[] = [];
  chunks.forEach((c, rank) => {
    for (const m of c.content.matchAll(PARAM_LINE_RE)) lines.push({ code: m[1].toUpperCase(), name: printedName(m[2]), rank });
  });
  const explicit = EXPLICIT_CODE_RE.exec(question)?.[1]?.toUpperCase();
  if (explicit) {
    const hit = lines.find((l) => l.code === explicit);
    return hit ? { code: hit.code, name: hit.name } : null;
  }
  const terms = subjectTerms(question);
  const freq = new Map<string, number>();
  for (const l of lines) freq.set(l.code, (freq.get(l.code) ?? 0) + 1);
  let best: { code: string; name: string; rank: number; matched: number; cover: number } | null = null;
  for (const l of lines) {
    const words = nameWords(l.name);
    if (words.length === 0) continue;
    const matched = words.filter((w) => terms.has(stem(w))).length;
    const cover = matched / words.length;
    if (matched < 2 || cover < 0.6) continue;
    const better =
      !best ||
      cover > best.cover ||
      (cover === best.cover && matched > best.matched) ||
      (cover === best.cover && matched === best.matched && (freq.get(l.code) ?? 0) > (freq.get(best.code) ?? 0)) ||
      (cover === best.cover && matched === best.matched && (freq.get(l.code) ?? 0) === (freq.get(best.code) ?? 0) && l.rank < best.rank);
    if (better) best = { ...l, matched, cover };
  }
  return best ? { code: best.code, name: best.name } : null;
}

const SENTENCE_RE = /[A-Z](?:[^.]|\.(?=\d|\w))*\./g;

/**
 * Where a chunk DEFINES the parameter: its code line, followed in the same chunk
 * by a sentence that names the parameter and says what it does ("The
 * acceleration time determines the time required …"). A summary table row
 * ("P01.12 Acceleration time 1 10 (sec.)") has no such sentence and is not a
 * definition. Returns the verbatim span from the code line through that
 * sentence, or null.
 */
export function definitionSpan(content: string, param: { code: string; name: string }, maxChars: number): string | null {
  const clean = content.trim();
  const codeAt = clean.search(new RegExp(`(?:^|\\n)[ \\t]*${param.code.replace(/\./g, "\\.")}[ \\t]`, "i"));
  if (codeAt < 0) return null;
  const start = clean[codeAt] === "\n" ? codeAt + 1 : codeAt;
  const phrase = nameWords(param.name).join(" ");
  if (!phrase) return null;
  const rest = clean.slice(start);
  for (const m of rest.replace(/\s+/g, " ").matchAll(SENTENCE_RE)) {
    const sentence = m[0];
    if (!sentence.toLowerCase().includes(phrase) || !DEFINING_VERB_RE.test(sentence)) continue;
    // Map the end of the whitespace-normalised sentence back onto the raw text.
    const tail = sentence.slice(-24);
    const rawEnd = findNormalised(rest, tail);
    if (rawEnd < 0) return null;
    const span = rest.slice(0, rawEnd).trim();
    return span.length <= maxChars ? span : null;
  }
  return null;
}

/** End offset in `raw` of `needle` compared with whitespace runs collapsed, or -1. */
function findNormalised(raw: string, needle: string): number {
  const re = new RegExp(needle.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const m = re.exec(raw);
  return m ? m.index + m[0].length : -1;
}

const REVISION_RE = /\b(?:(\d+(?:st|nd|rd|th)\s+Ed\.?,?\s+))?Rev(?:ision)?\.?\s+([A-Z0-9]{1,3})\b/;

/** "1st Ed., Rev C" exactly as the cited chunk prints it, or null. */
export function printedRevision(content: string): string | null {
  const m = REVISION_RE.exec(content);
  if (!m) return null;
  return m[0].replace(/\s+/g, " ").trim();
}

export const EDGE_DEFINITION_CHARS = 900;

/**
 * Pair each retrieved chunk with the citation buildCitations gave it (same
 * per-page dedupe key, same order), drop navigation chunks, keep the first
 * EDGE_PASSAGE_LIMIT. The text is a verbatim window of the chunk.
 *
 * When the question names a parameter (identifyParameter) and a retrieved
 * chunk DEFINES it (definitionSpan), that page goes first and its passage is
 * the code line through the defining sentence — the field run of 2026-11-08
 * cut exactly this page (pdf p.139, P01.12) because it was retrieved fourth.
 * The other passages prefer chunks that print the code, then retrieval order,
 * and their windows are anchored on the code. Selection only: every passage
 * is still a verbatim substring of a retrieved chunk.
 */
export function selectEdgePassages(
  chunks: EdgeChunk[],
  citations: EvidenceCitation[],
  question: string,
): EdgePassage[] {
  const byKey = new Map<string, EvidenceCitation>();
  const order: string[] = [];
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (!order.includes(key)) order.push(key);
  }
  order.forEach((key, i) => {
    if (citations[i]) byKey.set(key, citations[i]);
  });
  const usable = chunks.filter((c) => !isNavigationChunk(c.content));
  const param = identifyParameter(usable, question);
  const anchor = param ? `${question} parameter ${param.code}` : question;
  const out: EdgePassage[] = [];
  const used = new Set<string>();
  const take = (c: EdgeChunk, text: string, definition: EdgePassage["definition"]) => {
    const citation = byKey.get(`${c.sourceUrl}::${c.sourcePage ?? ""}`);
    if (!citation || used.has(citation.citationId)) return;
    used.add(citation.citationId);
    out.push({ citation, text, definition, pageLabel: c.pageLabel ?? null, revision: printedRevision(c.content) });
  };
  if (param) {
    for (const c of usable) {
      const span = definitionSpan(c.content, param, EDGE_DEFINITION_CHARS);
      if (span) {
        // Label it with the name as THIS page prints it, not a summary table's.
        const printed = [...span.matchAll(PARAM_LINE_RE)][0];
        take(c, span, { code: param.code, name: printed ? printedName(printed[2]) : param.name });
        break;
      }
    }
  }
  const codeRe = param ? new RegExp(`(?<![A-Za-z0-9.])${param.code.replace(/\./g, "\\.")}(?![0-9])`, "i") : null;
  const ranked = codeRe ? [...usable.filter((c) => codeRe.test(c.content)), ...usable.filter((c) => !codeRe.test(c.content))] : usable;
  for (const c of ranked) {
    if (out.length >= EDGE_PASSAGE_LIMIT) break;
    take(c, relevantQuoteWindow(c.content, anchor, EDGE_PASSAGE_CHARS), null);
  }
  return out;
}

export const EDGE_CAUTION_CHARS = 800;
export const EDGE_CAUTION_LIMIT = 4;
/**
 * A sentence that states what goes wrong or stops applying: "may cause motor
 * damage", "may trigger the drive's protection", "too short", "invalid when".
 * "Longer than the setting" is a description, not a caution, and is left out.
 */
const CONSEQUENCE_RE = /\b(?:may|can|could|might|will)\s+(?:cause|trigger|damage|result|lead)\b|\binvalid\b|\btoo\s+(?:short|long|high|low|fast|slow)\b/i;
// A sentence ends at a period followed by whitespace or the end ("P01.00)." yes, "P06.03" no).
const SENTENCE_END_RE = /\.(?=\s|$)/;

/**
 * The cautions the definition's own page prints about the parameter, word for
 * word, in page order (#5265: the Samsung run of 2026-11-08 quoted P01.12's
 * definition and dropped "setting the acceleration time too short may cause
 * motor damage …", printed a few lines below it). A sentence qualifies when it
 * names every word of the parameter's printed name as a whole word (so a
 * deceleration-only caution is not pinned on acceleration time) and states a
 * consequence (CONSEQUENCE_RE). Chunks overlap, so a chunk's leading partial
 * sentence is dropped and a sentence contained in another, or in the quoted
 * definition, is dropped. Capped at EDGE_CAUTION_LIMIT sentences and
 * EDGE_CAUTION_CHARS characters; a sentence that would pass the cap is skipped.
 */
export function definitionCautions(
  pageTexts: readonly string[],
  param: { code: string; name: string },
  definitionText = "",
): string[] {
  const words = nameWords(param.name);
  if (words.length === 0) return [];
  const wordRes = words.map((w) => new RegExp(`\\b${w}\\b`, "i"));
  const found: string[] = [];
  for (const raw of pageTexts) {
    let text = raw.replace(/\s+/g, " ").trim();
    // Starts mid-sentence (an overlap with the previous chunk): skip to the next sentence.
    if (text && !/^[A-Z•]/.test(text)) {
      const end = SENTENCE_END_RE.exec(text);
      text = end ? text.slice(end.index + 1) : "";
    }
    for (const segment of text.split("•")) {
      for (const m of segment.matchAll(SENTENCE_RE)) {
        const s = m[0].trim();
        if (CONSEQUENCE_RE.test(s) && wordRes.every((re) => re.test(s)) && !found.includes(s)) found.push(s);
      }
    }
  }
  const definition = definitionText.replace(/\s+/g, " ");
  const out: string[] = [];
  let chars = 0;
  for (const s of found) {
    if (definition.includes(s) || found.some((o) => o !== s && o.includes(s))) continue;
    if (out.length >= EDGE_CAUTION_LIMIT) break;
    if (chars + s.length > EDGE_CAUTION_CHARS) continue;
    out.push(s);
    chars += s.length;
  }
  return out;
}

/**
 * The definition passage with its page's cautions attached (definitionCautions),
 * read from `pageTexts` — the definition page's chunks in page order. Other
 * passages are returned unchanged.
 */
export function withDefinitionCautions(passages: EdgePassage[], pageTexts: readonly string[]): EdgePassage[] {
  return passages.map((p) => {
    if (!p.definition) return p;
    const cautions = definitionCautions(pageTexts, p.definition, p.text);
    return cautions.length > 0 ? { ...p, cautions } : p;
  });
}

/** The manual's own safety statement on a cited page (manual-safety-statement.ts). */
export type EdgeWarning = { marker: string; statement: string; page: number | null };

/**
 * The answer text: a fixed lead, then the manual's own safety statement for a
 * cited page (when there is one — it may sit outside every quoted window, or in
 * a sibling chunk of the page), then each passage quoted with its [n] marker
 * and page.
 */
export function renderEdgePassages(passages: EdgePassage[], warning: EdgeWarning | null = null): string {
  if (passages.length === 0) return EDGE_NO_PASSAGE_TEXT;
  const blocks = passages.map(({ citation, text, definition, pageLabel, revision, cautions }) => {
    const where = [citation.sourceTitle];
    if (revision && !citation.sourceTitle.toLowerCase().includes(revision.toLowerCase())) where.push(revision);
    if (citation.page != null) {
      const label = pageLabel ? pageLabel.replace(/–/g, "-") : null;
      where.push(label && label !== String(citation.page) ? `page ${label} (PDF page ${citation.page})` : `page ${citation.page}`);
    }
    const quoted = `"${text}" [${citation.citationId}]\n— ${where.join(", ")}`;
    if (!definition) return quoted;
    const block = `Definition of ${definition.code} (${definition.name}), as printed:\n${quoted}`;
    if (!cautions || cautions.length === 0) return block;
    const lines = cautions.map((s) => `- "${s}" [${citation.citationId}]`);
    return `${block}\n\nAlso printed on that page about ${definition.code}:\n${lines.join("\n")}`;
  });
  const head = warning
    ? [EDGE_PASSAGES_LEAD, `${warning.marker}${warning.page != null ? ` (page ${warning.page})` : ""}: "${warning.statement}"`]
    : [EDGE_PASSAGES_LEAD];
  return [...head, ...blocks].join("\n\n");
}

/** Route reason recorded for a turn served from verbatim passages. */
export const EDGE_PASSAGES_ROUTE_REASON = "edge_verbatim_passages";

/**
 * Usage for a passage-served turn: no provider was called, so provider, model,
 * tokens and cost are null and the call status is "empty" (the stop path's
 * precedent) — never the "error / no_provider_configured" of an exhausted
 * cascade, and the same record whether the canonical seam is on or off.
 */
export function edgePassagesUsage(): TurnUsage {
  return {
    provider: null,
    model: null,
    routeReason: EDGE_PASSAGES_ROUTE_REASON,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costUsdEstimate: null,
    status: "empty",
    attempted: [],
  };
}
