// Which ONE machine, if any, does a photo's reading name? (#5706)
//
// Seen on the staging tablet 2026-11-21 (revision 7401002fc): a GS20-23P0
// nameplate photo plus "Find me the manual" in a project confirmed as
// GS11N-20P2 was answered from the GS10 manual. The photo had been read; the
// reading never reached the model check. The photo now names the asked
// machine when the question names none — judged here, by ONE rule, for the
// photo sent with this question (manual-rag.ts) and for a photo an earlier
// open question carried (conversation-subject.ts).
//
// Pure: a reading in, the text to judge (or null) out. No model, no network.

import { modelIdentitiesInText, resolveModelFromObservationText } from "./model-token";
import { publicLabelText } from "./photo-part-lookup";

/** An explicitly labelled model field ("MODEL: GS11N-20P2", "Model No. GS20-23P0").
 *  One token only, so a value can never run on into a serial printed after it. */
const MODEL_FIELD = /\bmodel(?:\s*(?:no\.?|number|#))?\s*[:#=]?\s*((?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{2,})/gi;

/** Does this text name any model — one, several, or a family the reader knows?
 *  The same test the manual check applies to a typed question. */
export function namesAnyModel(text: string): boolean {
  const named = resolveModelFromObservationText(text);
  return Boolean(named.model) || named.ambiguous || modelIdentitiesInText(text).size > 0;
}

/** Exactly one machine: the identity reader's identities after a family root is
 *  folded into the full number it prefixes (GS20 beside GS20-23P0, GS11N beside
 *  GS11N-20P2) — Codex r1 on #5764, F1 + F2. Two distinct numbers of one family
 *  (GS20-23P0 and GS20-21P0) are two machines. A close-name model the single
 *  token cannot carry (PowerFlex 4M, SMC-50) counts as one, exactly as the
 *  typed check scopes it. Every reading the single-token reader calls
 *  ambiguous (GS10 or GS20, Micro820 and Micro850) already names two
 *  identities here, so this count is the one rule. With no identity at all, a
 *  single-token read (a bare "525") is one machine. */
export function namesOneMachine(text: string): boolean {
  const read = resolveModelFromObservationText(text);
  const ids = [...modelIdentitiesInText(text)];
  const machines = ids.filter((id) => !ids.some((other) => other !== id && other.startsWith(id)));
  if (machines.length > 1) return false;
  return machines.length === 1 || Boolean(read.model);
}

/**
 * The part of a photo reading that may name the machine, when it names exactly
 * one; otherwise null (a whole panel, an unreadable plate, two drives).
 *
 * Only PUBLIC text is read (ADR-0036; Codex r1 on #5764, F4): the reading up to
 * its first serial or asset label (photo-part-lookup.ts publicLabelText — the
 * same split the part lookup uses), plus any explicitly labelled MODEL field.
 * Nothing printed after a serial label is ever taken for a model, so
 * "S/N: PF 525" names no machine and cannot refuse the project's manual.
 */
export function photoSubjectText(reading: string | null | undefined): string | null {
  const raw = reading?.trim();
  if (!raw) return null;
  const labelled = [...raw.matchAll(MODEL_FIELD)].map((m) => m[1]);
  const text = [publicLabelText(raw).trim(), ...labelled].filter(Boolean).join("\n");
  return text && namesOneMachine(text) ? text : null;
}
