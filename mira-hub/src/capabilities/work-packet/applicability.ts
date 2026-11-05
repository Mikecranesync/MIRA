/**
 * Work Packet V2 — does a manual line apply to THIS pump? Pure (no I/O).
 *
 * A service manual covers several models and prints notes, steps and photos that apply to some of
 * them only. V1 showed every one as Verified (a 3520 packet carried 3545/3541 and 3560 notes).
 * This module answers, for one line of manual text and one model:
 *   applies       — names no model, or only groups that include this pump
 *   other_models  — names only other models (or excludes this one)
 *   mixed         — one line covering this pump AND other models ("Models a, b use X. Models c, d use Y.")
 *   unresolved    — a date, serial, revision, style or application restriction the documents cannot
 *                   settle, or a model the manual's cover does not list. Never guessed.
 *
 * Model mentions are matched only against the manual's own `modelsCovered` list, exact after
 * case/space/dash folding — never by prefix, so "8520C" is not "8520". (ES2017 target: no regex
 * lookbehind, so mentions are tokenized by hand.)
 */

import type { ModelScope } from "./types";

export type Applicability =
  | { kind: "applies"; reason: string }
  | { kind: "other_models"; reason: string }
  | { kind: "mixed"; reason: string }
  | { kind: "unresolved"; reason: string; phrase: string };

/** Case/space/dash-insensitive exact match — no prefix matching (mirrors `sheetModelFor`). */
export function normalizeModel(s: string): string {
  return s.toUpperCase().replace(/[\s-]+/g, "");
}

export function modelsMatch(a: string, b: string): boolean {
  return normalizeModel(a) === normalizeModel(b);
}

export function modelScopeAdmits(scope: ModelScope, model: string): boolean {
  if (scope.unresolved) return false;
  if (!model) return scope.include.length === 0;
  if (scope.exclude.some((m) => modelsMatch(m, model))) return false;
  if (scope.include.length > 0) return scope.include.some((m) => modelsMatch(m, model));
  return true;
}

// A year that is a year, not a pressure/speed/size ("from 2000 PSI").
const YEAR = "(?:19|20)\\d{2}(?![\\d.]|\\s*(?:psi|rpm|gpm|bar|lpm|l/m|in\\b|ft\\b|nm\\b|mm\\b|°|%|hrs?\\b|hours))";
const REV = "rev(?:ision)?\\.?\\s*[A-Z0-9]{1,3}\\b";

/** Restrictions a manual states but the packet cannot settle from the documents. Order = report order. */
const RESTRICTIONS: { re: RegExp; reason: string }[] = [
  { re: /\b(?:early|old|new|late|older|newer|earlier|later|previous|current)[\s-]+styles?\b/i, reason: "limited to a pump style the documents do not identify" },
  { re: /\bfor (?:certain|some|specific|special) (?:applications|installations|uses|models|pumps)\b/i, reason: "limited to some applications the documents do not identify" },
  { re: /\b(?:to identify (?:the|your|which) (?:model|pump)|for model identification)\b/i, reason: "needs a bulletin to identify which model this is" },
  { re: new RegExp(`\\b(?:prior to|before|after|since|until)\\s+${YEAR}`, "i"), reason: "limited by a date" },
  { re: new RegExp(`\\b(?:pre|post)-?\\s?${YEAR}`, "i"), reason: "limited by a date" },
  { re: new RegExp(`\\b${YEAR}\\s+(?:and|or)\\s+(?:later|earlier|newer|older|after|before)\\b`, "i"), reason: "limited by a date" },
  { re: /\b(?:built|manufactured|made|produced|shipped)\s+(?:before|after|prior to|since|from|in|until)\b/i, reason: "limited by build date" },
  { re: /\bserial\s+(?:numbers?|no\.?|#)?\s*[A-Z0-9-]+\s+(?:and|or)\s+(?:later|earlier|after|before|above|below|higher|lower|up|down)\b/i, reason: "limited by serial number" },
  { re: /\b(?:before|after|prior to|from|since|until)\s+serial\b/i, reason: "limited by serial number" },
  { re: new RegExp(`\\b${REV}\\s+(?:and|or)\\s+(?:later|earlier|after|before|newer|older)\\b`, "i"), reason: "limited by revision" },
  { re: new RegExp(`\\b(?:before|after|prior to|since|from|until)\\s+${REV}`, "i"), reason: "limited by revision" },
];

function restriction(text: string): { reason: string; phrase: string } | null {
  for (const r of RESTRICTIONS) {
    const m = r.re.exec(text);
    if (m) return { reason: r.reason, phrase: m[0] };
  }
  return null;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Digit/letter pattern of a model: "7ZQ10" → "9AA99". */
const shapeOf = (n: string) => n.replace(/\d/g, "9").replace(/[A-Z]/g, "A");

/**
 * Alphanumeric tokens, with a model split by dashes or spaces ("7-ZQ10", "7 ZQ10") joined back into
 * one token when the joined form is a covered model, or when it is dash-joined and has the shape of
 * a covered model (an unlisted "7-ZQ50" → one token, judged unknown later) (Codex #5173 F6).
 */
function tokens(text: string, covered: readonly string[] = []): Token[] {
  const raw: Token[] = [];
  const re = /[0-9A-Za-z]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) raw.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  const cov = new Set(covered.map(normalizeModel));
  const shapes = new Set(Array.from(cov).filter((c) => /\d/.test(c) && /[A-Z]/.test(c)).map(shapeOf));
  const out: Token[] = [];
  for (let k = 0; k < raw.length; k++) {
    let best = k;
    let joined = normalizeModel(raw[k].text);
    let dashOnly = true;
    for (let j = k + 1; j < raw.length && j <= k + 3; j++) {
      const sep = text.slice(raw[j - 1].end, raw[j].start);
      if (!/^[\s-]+$/.test(sep)) break;
      dashOnly = dashOnly && sep === "-";
      joined += normalizeModel(raw[j].text);
      if (cov.has(joined) || (dashOnly && /\d/.test(joined) && /[A-Z]/.test(joined) && shapes.has(shapeOf(joined)))) best = j;
    }
    out.push({ text: text.slice(raw[k].start, raw[best].end), start: raw[k].start, end: raw[best].end });
    k = best;
  }
  return out;
}

const LIST_GAP_RE = /^[\s,()&/]*(?:(?:and|or)[\s,()&/]*)?$/i;
const EXCEPT_BEFORE_RE = /\bexcept\s*(?:for\s*)?(?:the\s*)?(?:models?\s*)?$/i;

interface Group {
  models: string[];
  except: boolean;
}

/**
 * Model mentions grouped into lists ("8520, 8521 and 8527" is one group). A digit token that starts
 * with a covered model but is not itself covered ("8520X") is an unknown variant → returned as `variant`.
 */
function modelGroups(text: string, covered: readonly string[]): { groups: Group[]; variant: string | null } {
  const cov = new Set(covered.map(normalizeModel));
  const groups: Group[] = [];
  let current: { models: string[]; first: Token; last: Token } | null = null;
  const close = () => {
    if (!current) return;
    groups.push({ models: current.models, except: EXCEPT_BEFORE_RE.test(text.slice(0, current.first.start)) });
    current = null;
  };
  const toks = tokens(text, covered);
  const covAt = (k: number) => k >= 0 && k < toks.length && cov.has(normalizeModel(toks[k].text));
  const gap = (a: Token, b: Token) => LIST_GAP_RE.test(text.slice(a.end, b.start));
  // A model-shaped token (the digit/letter pattern of a covered model, with a digit) the cover does
  // not list, in a model list or right after "Model(s)": unknown, never silently skipped (Codex EGM
  // F14; letters added for "7-ZQ50" next to a covered "7ZQ10", Codex #5173 F6).
  const modelShaped = (n: string) => /\d/.test(n) && covered.some((c) => shapeOf(normalizeModel(c)) === shapeOf(n));
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const n = normalizeModel(t.text);
    if (!cov.has(n)) {
      if (/^\d/.test(n) && /[A-Z]$/.test(n) && covered.some((c) => n.startsWith(normalizeModel(c)))) return { groups, variant: t.text };
      if (modelShaped(n) && ((covAt(k - 1) && gap(toks[k - 1], t)) || (covAt(k + 1) && gap(t, toks[k + 1])) || /\bmodels?\s*$/i.test(text.slice(0, t.start)))) {
        return { groups, variant: t.text };
      }
      continue;
    }
    if (current && LIST_GAP_RE.test(text.slice(current.last.end, t.start))) {
      current.models.push(n);
      current.last = t;
    } else {
      close();
      current = { models: [n], first: t, last: t };
    }
  }
  close();
  return { groups, variant: null };
}

function fromGroups(groups: Group[], model: string): Applicability {
  const me = normalizeModel(model);
  if (groups.length === 0) return { kind: "applies", reason: "names no model" };
  if (groups.some((g) => g.except && g.models.includes(me))) return { kind: "other_models", reason: `excludes ${model}` };
  const includes = groups.filter((g) => !g.except);
  if (includes.length === 0) return { kind: "applies", reason: `excludes only other models` };
  const mine = includes.filter((g) => g.models.includes(me));
  if (mine.length === 0) {
    const named = Array.from(new Set(includes.flatMap((g) => g.models))).join(", ");
    return { kind: "other_models", reason: `names only ${named}` };
  }
  if (mine.length < includes.length) {
    const others = Array.from(new Set(includes.filter((g) => !g.models.includes(me)).flatMap((g) => g.models))).join(", ");
    return { kind: "mixed", reason: `covers ${model} and also ${others} — use the part for ${model}` };
  }
  return { kind: "applies", reason: `names ${model}` };
}

/** Applicability of one line of manual text on its own words. */
export function textApplicability(text: string, model: string, covered: readonly string[]): Applicability {
  const r = restriction(text);
  if (r) return { kind: "unresolved", reason: r.reason, phrase: r.phrase };
  const { groups, variant } = modelGroups(text, covered);
  if (variant) return { kind: "unresolved", reason: `names model ${variant}, which the manual's cover does not list`, phrase: variant };
  return fromGroups(groups, model);
}

/** Applicability of a line printed inside a model-scoped block: the block's scope decides first. */
export function scopedApplicability(text: string, scope: ModelScope | null, model: string, covered: readonly string[]): Applicability {
  if (scope) {
    if (scope.unresolved) return { kind: "unresolved", reason: "printed in a block for models the manual does not name", phrase: "" };
    if (!modelScopeAdmits(scope, model)) return { kind: "other_models", reason: "printed in a block for other models" };
  }
  return textApplicability(text, model, covered);
}

const CAPTION_LIST_WORD_RE = /^(?:all|models?|except|and|or|only)$/i;

/** Applicability of a figure from its caption lines. A caption model the cover does not list is unresolved. */
export function captionApplicability(caption: readonly string[], model: string, covered: readonly string[]): Applicability {
  const cov = new Set(covered.map(normalizeModel));
  for (const line of caption) {
    const toks = tokens(line, covered);
    const modelToks = toks.filter((t) => /\d/.test(t.text));
    const isList = modelToks.length > 0 && toks.every((t) => /\d/.test(t.text) || CAPTION_LIST_WORD_RE.test(t.text));
    if (!isList) continue;
    const unknown = modelToks.find((t) => !cov.has(normalizeModel(t.text)));
    if (unknown) return { kind: "unresolved", reason: `caption names model ${unknown.text}, which the manual's cover does not list`, phrase: line };
    const models = modelToks.map((t) => normalizeModel(t.text));
    return fromGroups([{ models, except: /\bexcept\b/i.test(line) }], model);
  }
  return textApplicability(caption.join(" "), model, covered);
}
