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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip trailing sentence punctuation that is not part of a model ("5/03," → "5/03"). */
function cleanToken(t: string): string {
  return t.replace(/[,;:!?)\]"'’]+$/u, "").replace(/\.+$/, "");
}

/**
 * The model-like span right after a manufacturer mention, or null. Pure; exported
 * for tests.
 */
export function modelAfterManufacturer(message: string, manufacturer: string): string | null {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(manufacturer)}(?![A-Za-z0-9])`, "ig");
  for (const m of message.matchAll(re)) {
    const rest = message.slice((m.index ?? 0) + m[0].length);
    const tokens = rest.trim().split(/\s+/).slice(0, 3).map(cleanToken);
    const [t1, t2] = tokens;
    if (!t1 || !MODEL_TOKEN_RE.test(t1) || FAULT_CODE_RE.test(t1)) continue;
    if (HAS_DIGIT.test(t1)) return t1;
    // An all-caps family code followed by a digit-bearing token: "SLC 5/03", "AC 01.2".
    if (ALLCAPS_CODE_RE.test(t1) && t2 && MODEL_TOKEN_RE.test(t2) && HAS_DIGIT.test(t2) && !FAULT_CODE_RE.test(t2)) {
      return `${t1} ${t2}`;
    }
  }
  return null;
}

/**
 * The first corpus manufacturer mentioned in the message, matched through every
 * spelling of its vendor group, returned AS WRITTEN in the message. Pure;
 * exported for tests.
 */
export function manufacturerMentionInText(message: string, corpus: readonly string[]): string | null {
  for (const name of corpus) {
    const spellings = new Set([name.toLowerCase(), ...manufacturerSearchNames(name)]);
    for (const sp of spellings) {
      if (sp.length < 2) continue;
      const m = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(sp)}(?![A-Za-z0-9])`, "i").exec(message);
      if (m) return m[0];
    }
  }
  return null;
}

/**
 * Propose a machine from the technician's free text, or null. Never throws.
 * `knownManufacturers` is the shared library's manufacturer list.
 */
export function proposeIdentityFromText(
  message: string,
  knownManufacturers: readonly string[],
): IdentityProposal | null {
  try {
    const manufacturer = manufacturerMentionInText(message, knownManufacturers);
    if (!manufacturer) return null;
    const parsed = resolveModelFromObservationText(message);
    if (parsed.ambiguous) return null;
    const model = parsed.model ?? modelAfterManufacturer(message, manufacturer);
    return model ? { manufacturer, model } : null;
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
