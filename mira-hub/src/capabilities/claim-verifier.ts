/**
 * Typed claim → source verifier (evidence-verification runoff, candidate V1; #4496 successor track).
 *
 * #4488 asked "does each value string appear on the cited page?" and was closed: that is not the
 * same question as "does the page SUPPORT the claim", and it refused correct prose answers. This
 * module is deliberately narrower and adds the one thing #4488 lacked — BINDING:
 *
 *   1. It judges only TYPED claims: a bit number, a PLC data address (S:3/10), a parameter or
 *      fault code (P06.03, F004), a pin number, a hex identifier (0x700, 700h), and a quantity the
 *      existing closed-unit extractor fully parses (`findValues(...).usable`, #4315). Prose,
 *      yes/no answers and anything it cannot parse get `no_opinion` — never a refusal.
 *   2. A typed value counts as supported only when the cited page states it NEAR the identifiers
 *      the question is about. TQ-06 is the motivating case: "bit 11" really is on p.240 — as the
 *      error bit of a different instruction. Presence alone passes that wrong answer; binding to
 *      the question's `.DLEN/.RLEN` does not.
 *   3. A value the question itself named is the subject, not a claim ("what does P09.03 do?").
 *
 * Pure, deterministic, zero-token. Not wired into any route: the runoff harness calls it on frozen
 * evidence, and a shadow flag would call it after the safety gate (never replacing a safety stop).
 */

import { findValues, normalize } from "./supporting-quote";

export type ClaimKind = "bit" | "address" | "code" | "pin" | "hex" | "quantity";

export type TypedClaim = {
  kind: ClaimKind;
  /** Canonical comparison key, e.g. `bit:12`, `addr:s:3/10`, `code:p0603`, `qty:24|VDC`. */
  key: string;
  raw: string;
};

export type ClaimStatus = "supported" | "unbound" | "absent";

export type ClaimResult = TypedClaim & { status: ClaimStatus; page: number | null };

export type Evidence = { page: number; text: string };

export type Verdict = {
  verdict: "supported" | "unsupported" | "no_opinion";
  reason: "no_typed_claim" | "all_bound" | "uncited" | "absent" | "unbound";
  claims: ClaimResult[];
  subjects: { strong: string[]; weak: string[] };
};

/** How far (chars, normalised text) a value may sit from a question identifier and still bind. */
export const BIND_WINDOW = 400;

// Words that look like identifiers (ALLCAPS) but name nothing specific in a manual.
const GENERIC = new Set([
  "plc", "vfd", "hmi", "io", "ac", "dc", "led", "usb", "the", "and", "what", "which", "does",
  "set", "bit", "pin", "mode", "manual", "drive", "fault", "error", "code",
]);

/** Lowercase, collapse whitespace, turn brackets into spaces (extraction often loses them). */
function flat(s: string): string {
  return normalize(s).toLowerCase().replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ");
}

/** Separator-insensitive code key: P06.03 / P06-03 / p 06.03 → p0603. */
function codeKey(s: string): string {
  return s.toLowerCase().replace(/[\s.\-_]/g, "");
}

const BIT_RE = /\bbit\s*#?\s*(\d{1,2})\b/gi;
const PIN_RE = /\bpin\s*#?\s*(\d{1,2})\b/gi;
const ADDR_RE = /\b([a-z]{1,3}\d{0,3}:\d{1,4}(?:\/\d{1,2})?|[a-z]\d{1,3}\/\d{1,2})\b/gi;
const CODE_RE = /\b([a-z]{1,2}\d{1,3}[.-]\d{1,3}|[fea]\d{2,4})\b/gi;
const HEX_RE = /\b(0x[0-9a-f]{2,4}|[0-9a-f]{2,4}h)\b/gi;

/**
 * Identifiers the QUESTION is about. `strong` = what the question asks about: dotted or ALLCAPS
 * mnemonics (.DLEN, RLEN, IGBT) and code-shaped tokens (P6.35, S:3/10, F004). `weak` = other
 * digit-bearing tokens, usually the product (GS4, PLC-5) — pages rarely repeat those, so they bind
 * when present but are never required.
 */
export function questionSubjects(question: string): { strong: string[]; weak: string[] } {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const m of question.matchAll(/\.?[A-Za-z][A-Za-z0-9]*(?:[.:/-][A-Za-z0-9]+)*/g)) {
    const tok = m[0];
    const bare = tok.replace(/^\./, "").toLowerCase();
    if (bare.length < 2 || GENERIC.has(bare)) continue;
    const mnemonic = tok.startsWith(".") || /^[A-Z]{3,}$/.test(tok);
    const codeShaped = /^[a-z]{1,3}\d{0,3}:\d/.test(bare) || /^[a-z]{1,2}\d{1,3}[.]\d{1,3}$/.test(bare) || /^[fea]\d{2,4}$/.test(bare);
    if (mnemonic || codeShaped) strong.add(bare);
    else if (/\d/.test(tok)) weak.add(bare);
  }
  return { strong: [...strong], weak: [...weak] };
}

/** Typed claims stated by the answer (values the question itself named are excluded). */
export function extractTypedClaims(answer: string, question: string): TypedClaim[] {
  const q = flat(question);
  const qCodes = new Set([...q.matchAll(/[a-z0-9.:/-]+/g)].map((m) => codeKey(m[0])));
  const seen = new Map<string, TypedClaim>();
  const add = (kind: ClaimKind, key: string, raw: string) => {
    if (!seen.has(key)) seen.set(key, { kind, key, raw });
  };
  const a = answer.replace(/\*\*|__|`/g, "");
  for (const m of a.matchAll(BIT_RE)) if (!new RegExp(`\\bbit\\s*${m[1]}\\b`).test(q)) add("bit", `bit:${Number(m[1])}`, m[0]);
  for (const m of a.matchAll(PIN_RE)) if (!new RegExp(`\\bpin\\s*${m[1]}\\b`).test(q)) add("pin", `pin:${Number(m[1])}`, m[0]);
  for (const m of a.matchAll(ADDR_RE)) {
    if (/^\d/.test(m[1]) || qCodes.has(codeKey(m[1]))) continue;
    add("address", `addr:${m[1].toLowerCase()}`, m[0]);
  }
  for (const m of a.matchAll(CODE_RE)) {
    if (qCodes.has(codeKey(m[1]))) continue;
    add("code", `code:${codeKey(m[1])}`, m[0]);
  }
  for (const m of a.matchAll(HEX_RE)) {
    if (!/\d/.test(m[1]) || qCodes.has(codeKey(m[1]))) continue;
    const v = parseInt(m[1].replace(/^0x|h$/i, ""), 16);
    add("hex", `hex:${v}`, m[0]);
  }
  const qValues = new Set(findValues(question, "answer").filter((v) => v.usable).map(qtyKey));
  for (const v of findValues(a, "answer")) {
    if (!v.usable || qValues.has(qtyKey(v))) continue;
    add("quantity", qtyKey(v), v.text);
  }
  return [...seen.values()];
}

function qtyKey(v: { nums: number[]; unit: string | null }): string {
  return `qty:${v.nums.join("~")}|${v.unit}`;
}

/** Every offset in `text` (already `flat`) where the claim's value is stated. */
function valueOffsets(claim: TypedClaim, text: string, raw: string): number[] {
  const hits: number[] = [];
  const push = (re: RegExp, ok: (m: RegExpMatchArray) => boolean) => {
    for (const m of text.matchAll(re)) if (ok(m)) hits.push(m.index ?? 0);
  };
  const [, val] = claim.key.split(/:(.*)/s);
  switch (claim.kind) {
    case "bit":
      push(/\bbit\s*#?\s*(\d{1,2})\b/g, (m) => Number(m[1]) === Number(val));
      break;
    case "pin":
      push(/\bpin\s*#?\s*(\d{1,2})\b/g, (m) => Number(m[1]) === Number(val));
      break;
    case "address":
      push(new RegExp(`(?<![a-z0-9])${val.replace(/[/]/g, "\\/")}(?![0-9])`, "g"), () => true);
      break;
    case "code":
      push(/[a-z]{1,2}\s*\d{1,3}\s*[.-]?\s*\d{0,3}/g, (m) => codeKey(m[0]) === val);
      break;
    case "hex":
      push(/\b(0x[0-9a-f]{2,4}|[0-9a-f]{2,4}\s?h)\b/g, (m) => parseInt(m[1].replace(/^0x|\s?h$/g, ""), 16) === Number(val));
      break;
    case "quantity":
      for (const v of findValues(raw, "source")) if (v.usable && qtyKey(v) === claim.key) hits.push(-1);
      break;
  }
  return hits;
}

function subjectOffsets(subjects: string[], text: string): number[] {
  const hits: number[] = [];
  for (const s of subjects) {
    const re = new RegExp(`(?<![a-z0-9])\\.?${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![a-z0-9])`, "g");
    for (const m of text.matchAll(re)) hits.push(m.index ?? 0);
  }
  return hits;
}

/**
 * Judge one answer against the pages it cites. `evidence` empty ⇒ the answer cited nothing.
 * A claim is `supported` when a cited page states the value within BIND_WINDOW of one of the
 * question's strong identifiers (when it has any), or of a weak one present on the page (else
 * anywhere on the page); `unbound` when stated only away from them; `absent` when no cited page
 * states it.
 */
export function verifyAnswer(
  input: { question: string; answer: string; evidence: Evidence[] },
  opts: { joinWrappedLines?: boolean } = {},
): Verdict {
  const subjects = questionSubjects(input.question);
  const claims = extractTypedClaims(input.answer, input.question);
  if (claims.length === 0) return { verdict: "no_opinion", reason: "no_typed_claim", claims: [], subjects };
  if (input.evidence.length === 0) {
    return {
      verdict: "unsupported", reason: "uncited", subjects,
      claims: claims.map((c) => ({ ...c, status: "absent", page: null })),
    };
  }
  const results: ClaimResult[] = claims.map((c) => {
    let best: ClaimResult = { ...c, status: "absent", page: null };
    for (const ev of input.evidence) {
      // V1b (post-hoc, runoff 2026-10-20): PDF extraction wraps "10\nminutes"; the reused quantity
      // extractor keeps a value and its unit on one line, so a wrapped value never matches its page.
      const text = opts.joinWrappedLines ? ev.text.replace(/(?<=\S)[ \t]*\n[ \t]*(?=\S)/g, " ") : ev.text;
      const t = flat(text);
      const vals = valueOffsets(c, t, text);
      if (vals.length === 0) continue;
      // Strong subjects are required when the question has any: a page that never mentions
      // .DLEN cannot support "bit N is set when .DLEN ≠ .RLEN". Weak ones bind only if present.
      const required = subjects.strong.length > 0 ? subjects.strong : subjects.weak;
      const subs = subjectOffsets(required, t);
      const optional = subjects.strong.length === 0 && subs.length === 0;
      // Quantities are matched through findValues (offsets unknown): bind on page co-occurrence.
      const bound =
        optional ||
        (subs.length > 0 && vals.some((v) => v < 0 || subs.some((s) => Math.abs(s - v) <= BIND_WINDOW)));
      if (bound) return { ...c, status: "supported", page: ev.page };
      best = { ...c, status: "unbound", page: ev.page };
    }
    return best;
  });
  const worst = results.find((r) => r.status === "absent") ?? results.find((r) => r.status === "unbound");
  if (worst) return { verdict: "unsupported", reason: worst.status === "absent" ? "absent" : "unbound", claims: results, subjects };
  return { verdict: "supported", reason: "all_bound", claims: results, subjects };
}
