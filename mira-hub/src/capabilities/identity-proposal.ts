/**
 * identity-proposal — "propose, then confirm" for a blank chat (#4095, owner
 * decision 2026-09-28).
 *
 * A technician types into an empty notebook: "Find the manual for this
 * Allen-Bradley SLC 5/03 …". MIRA may PROPOSE that machine; it never binds it,
 * never scopes retrieval to it on this turn, and never answers as if it were
 * confirmed. The client offers "Use its manuals" / "Not this"; confirming binds
 * the notebook through the existing PATCH, and the existing identity-bound path
 * (and #4075's manual acquisition) takes over from there.
 *
 * Rules (owner decisions 2026-09-28 and 2026-09-29):
 *  - The manufacturer must be one the shared library holds (corpus list), named
 *    as a whole word in ANY spelling of its vendor group — the corpus list is
 *    canonicalized ("Allen-Bradley" is listed as "Rockwell Automation"), so a
 *    plain name match would miss the most common vendor. The proposal keeps the
 *    spelling the technician used. A manufacturer-only proposal is never made
 *    (#3970).
 *  - The model comes from the existing parser first. When it recognizes nothing,
 *    it is the short token span right after the manufacturer whose first token
 *    carries a digit or is an all-caps code ("SLC 5/03", "SPC-100-P-F", "FX5U").
 *    A fault-code-shaped token (F004) is never a model, and an ambiguous model
 *    (two different ones named) yields no proposal.
 */
import { resolveModelFromObservationText } from "@/lib/manual-rag";
import { manufacturerSearchNames } from "@/lib/manufacturerNormalize";

export interface IdentityProposal {
  manufacturer: string;
  model: string;
}

/** The SSE frame the notebook chat emits next to the normal answer. */
export type NotebookIdentityProposalFrame = { kind: "identity_proposal" } & IdentityProposal;

/** A single letter + 2–4 digits: a fault code, never a model (mirrors extractFaultCodes). */
const FAULT_CODE_RE = /^[A-Za-z]\d{2,4}$/;
const ALLCAPS_CODE_RE = /^[A-Z]{2,6}$/;
const MODEL_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./+]*$/;
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
/** Tokens that carry digits but are not models (Codex #4120 F5). */
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAC_RE = /^[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}$/;
const SERIAL_RE = /^(?:s\/?n|serial)/i;
const MAX_MODEL_CHARS = 32;
/** A run of 7+ digits is a serial/order/phone number, never a model (Codex #4120 r2 F5). */
const LONG_DIGIT_RUN = /\d{7,}/;
const HAS_UPPER = /[A-Z]/;
/** Dotted word or e-mail shape ("john.smith123", "a@b") — a username, not a model. */
const USERNAME_SHAPE = /[A-Za-z]{2,}\.[A-Za-z]|@/;
/** Generic device words that precede a model but are not part of it ("PLC S7-1200"). */
const GENERIC_DEVICE_WORDS = new Set(["PLC", "VFD", "HMI", "CPU", "DRIVE", "PANEL", "MOTOR", "VALVE", "SENSOR", "GATEWAY", "CONTROLLER", "UNIT"]);
/**
 * Interface, protocol, rating and standard tokens that look model-shaped but
 * name no machine ("RS-485", "DH-485", "IP65", "24VDC", "M12", "IEC61131").
 */
const NON_MACHINE_TOKEN_RE =
  /^(?:RS-?\d{3}|DH-?\d{3}|DH\+|IEC-?\d+|ISO-?\d+|EN-?\d+|IP\d{2}|NEMA-?\d+[A-Z]?|UL-?\d+|CAT-?\d[A-Z]?|M\d{1,2}|\d+(?:\.\d+)?(?:V|VAC|VDC|A|MA|HZ|KHZ|KW|W|HP|MM|BAR|PSI|RPM|MS|S)|\d+(?:ST|ND|RD|TH))$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip trailing sentence punctuation that is not part of a model ("5/03," → "5/03"). */
function cleanToken(t: string): string {
  return t.replace(/[,;:!?)\]"'’]+$/u, "").replace(/\.+$/, "");
}

/** A single token that can stand alone as a model: letters AND digits, not a code/IP/MAC/serial. */
function isModelToken(t: string): boolean {
  return (
    MODEL_TOKEN_RE.test(t) &&
    HAS_DIGIT.test(t) &&
    HAS_LETTER.test(t) &&
    HAS_UPPER.test(t) &&
    !FAULT_CODE_RE.test(t) &&
    !IPV4_RE.test(t) &&
    !MAC_RE.test(t) &&
    !SERIAL_RE.test(t) &&
    !LONG_DIGIT_RUN.test(t) &&
    !USERNAME_SHAPE.test(t) &&
    !NON_MACHINE_TOKEN_RE.test(t) &&
    t.length <= MAX_MODEL_CHARS
  );
}

/** The digit-bearing token of a family code span ("5/03", "01.2"): digits required, never an IP. */
function isFamilyNumber(t: string): boolean {
  return (
    MODEL_TOKEN_RE.test(t) &&
    HAS_DIGIT.test(t) &&
    !FAULT_CODE_RE.test(t) &&
    !IPV4_RE.test(t) &&
    !SERIAL_RE.test(t) &&
    !LONG_DIGIT_RUN.test(t) &&
    !USERNAME_SHAPE.test(t) &&
    t.length <= 12
  );
}

/** The model span starting at `tokens[0]`, or null. */
function modelSpanAt(tokens: string[]): string | null {
  // "Siemens PLC S7-1200": skip one generic device word before the model.
  if (tokens[0] && GENERIC_DEVICE_WORDS.has(tokens[0].toUpperCase())) tokens = tokens.slice(1);
  const [t1, t2] = tokens;
  if (!t1) return null;
  if (GENERIC_DEVICE_WORDS.has(t1.toUpperCase())) return null;
  if (isModelToken(t1)) return t1;
  // An all-caps family code followed by a digit-bearing token: "SLC 5/03", "AC 01.2".
  if (ALLCAPS_CODE_RE.test(t1) && t2 && isFamilyNumber(t2)) return `${t1} ${t2}`;
  return null;
}

/**
 * The model-like span right after ONE manufacturer mention, or null. Pure;
 * exported for tests.
 */
export function modelAfterManufacturer(message: string, manufacturer: string): string | null {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(manufacturer)}(?![A-Za-z0-9])`, "ig");
  for (const m of message.matchAll(re)) {
    const rest = message.slice((m.index ?? 0) + m[0].length);
    const tokens = rest.trim().split(/\s+/).slice(0, 3).map(cleanToken);
    // The existing parser first, scoped to THIS mention's window, so a model is
    // always bound to the manufacturer named before it (Codex #4120 F1).
    const parsed = resolveModelFromObservationText(tokens.join(" "));
    if (parsed.ambiguous) continue;
    const span = parsed.model ?? modelSpanAt(tokens);
    if (span) return span;
  }
  return null;
}

/**
 * Every manufacturer mention in the message (any vendor-group spelling of a
 * library manufacturer), as written, with its position. Pure; exported for tests.
 */
export function manufacturerMentions(message: string, corpus: readonly string[]): { text: string; index: number }[] {
  const out: { text: string; index: number; end: number }[] = [];
  for (const name of corpus) {
    const spellings = new Set([name.toLowerCase(), ...manufacturerSearchNames(name)]);
    for (const sp of spellings) {
      if (sp.length < 2) continue;
      for (const m of message.matchAll(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(sp)}(?![A-Za-z0-9])`, "ig"))) {
        const index = m.index ?? 0;
        const end = index + m[0].length;
        // Keep the longest match at an overlapping position ("Allen-Bradley" vs "Allen").
        const clash = out.findIndex((o) => index < o.end && o.index < end);
        if (clash === -1) out.push({ text: m[0], index, end });
        else if (end - index > out[clash].end - out[clash].index) out[clash] = { text: m[0], index, end };
      }
    }
  }
  return out.sort((a, b) => a.index - b.index).map(({ text, index }) => ({ text, index }));
}

/** The first corpus manufacturer mentioned, as written (kept for callers/tests). */
export function manufacturerMentionInText(message: string, corpus: readonly string[]): string | null {
  return manufacturerMentions(message, corpus)[0]?.text ?? null;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Another model of the SAME family named elsewhere without repeating the
 * manufacturer ("SLC 5/03 and SLC 5/04", "FX5U or FX3U") — Codex #4120 F2.
 */
/** CamelCase product-family word ("MicroLogix", "PowerFlex", "CompactLogix"). */
const CAMEL_FAMILY_RE = /^[A-Z][a-z]+[A-Z][A-Za-z]*$/;

/**
 * Does the text OUTSIDE the chosen machine's own mention windows name another
 * machine? Any standalone model-shaped token, a CamelCase family word followed
 * by a number ("MicroLogix 1400"), or another number of the chosen family
 * ("SLC 5/04") counts (Codex #4120 r2 F2, r3 F2). The chosen mention's window
 * is removed first, so an alias of the chosen model ("PF525" → 525) never
 * counts against itself (r3 F8).
 */
function namesAnotherMachine(rest: string, model: string): boolean {
  const tokens = rest.split(/\s+/).map(cleanToken).filter(Boolean);
  const family = model.includes(" ") ? model.split(" ")[0] : (model.match(/^[A-Za-z]{2,}/)?.[0] ?? null);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (isModelToken(t)) return true;
    if (CAMEL_FAMILY_RE.test(t) && next && isFamilyNumber(next)) return true;
    if (family && t.toUpperCase() === family.toUpperCase() && next && isFamilyNumber(next)) return true;
  }
  return false;
}

/** Blank the chosen machine's mention windows (mention + next 3 tokens). */
function outsideWindows(message: string, windows: { start: number; end: number }[]): string {
  let out = message;
  for (const w of windows) out = out.slice(0, w.start) + " ".repeat(w.end - w.start) + out.slice(w.end);
  return out;
}

/**
 * Propose a machine from the technician's free text, or null. Never throws.
 * `knownManufacturers` is the shared library's manufacturer list. Proposes ONLY
 * when exactly one distinct (manufacturer, model) pair is named and no other
 * model of that family appears — anything ambiguous yields nothing.
 */
export function proposeIdentityFromText(
  message: string,
  knownManufacturers: readonly string[],
): IdentityProposal | null {
  try {
    if (resolveModelFromObservationText(message).ambiguous) return null;
    const candidates = new Map<string, IdentityProposal>();
    const windows: { start: number; end: number }[] = [];
    for (const mention of manufacturerMentions(message, knownManufacturers)) {
      const model = modelAfterManufacturer(message.slice(mention.index), mention.text);
      // The mention plus EXACTLY the tokens the model was read from (through the
      // model's last part — "525" inside "PF525", "5/03" of "SLC 5/03").
      const mentionEnd = mention.index + mention.text.length;
      let end = mentionEnd;
      if (model) {
        const near = message.slice(mentionEnd).match(/^(?:\s+\S+){0,3}/)?.[0] ?? "";
        const last = model.split(" ").at(-1)!;
        const at = near.toUpperCase().indexOf(last.toUpperCase());
        if (at >= 0) {
          const tokenEnd = near.slice(at + last.length).match(/^\S*/)?.[0].length ?? 0;
          end = mentionEnd + at + last.length + tokenEnd;
        }
      }
      windows.push({ start: mention.index, end });
      if (model) candidates.set(`${norm(mention.text)}|${norm(model)}`, { manufacturer: mention.text, model });
    }
    if (candidates.size !== 1) return null;
    const only = [...candidates.values()][0];
    return namesAnotherMachine(outsideWindows(message, windows), only.model) ? null : only;
  } catch (err) {
    console.error("[identity-proposal] failed (no proposal):", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Appended to the GENERAL system prompt only when a proposal is made, so an
 * unconfirmed machine is never answered as if its manual were loaded.
 */
export function unconfirmedMachineDirective(p: IdentityProposal): string {
  const name = `${p.manufacturer} ${p.model}`;
  return (
    `\n\nUNCONFIRMED MACHINE — the technician named the ${name}, but it is NOT confirmed and none of its manuals are loaded. ` +
    `Do NOT state its ratings, specifications, settings, part numbers, wiring, fault meanings, or any reset, firmware or ` +
    `service procedure as fact. Answer only what is true in general, and say that once they confirm the ${name} you ` +
    `will look up its manual and show them the page.`
  );
}
