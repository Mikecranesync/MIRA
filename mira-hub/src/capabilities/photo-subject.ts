// What a photo's reading tells the model check (#5706).
//
// Seen on the staging tablet 2026-11-21 (revision 7401002fc): a GS20-23P0
// nameplate photo plus "Find me the manual" in a project confirmed as
// GS11N-20P2 was answered from the GS10 manual. The photo had been read; the
// reading never reached the model check.
//
// The photo is now judged EXACTLY as if its public text had been typed with
// the question (Codex r2 on #5764): the same readers, the same ambiguity,
// sibling, unlisted-number and exact-catalog checks. There is no second
// judgment of which model a photo shows. This file only decides WHICH text of
// the reading may be read at all (no serial ever), and the fail-closed gates:
// whether the photo is specific enough to end an earlier open subject, and
// whether the reader can tell which machine it means at all. A photo that
// fails them is asked about — one focused question — never answered.
//
// Pure: a reading in, text out. No model, no network.

import { modelIdentitiesInText, modelMentionsInText, resolveModelFromObservationText } from "./model-token";
import { unlistedModelNumbers } from "./manual-applicability";
import { privateLabelText, publicLabelText, serialCodes } from "./photo-part-lookup";

/** An explicitly labelled model field ("MODEL: GS11N-20P2", "Model No. GS20-23P0").
 *  One token only, so a value can never run on into a serial printed after it. */
const MODEL_FIELD = /\bmodel(?:\s*(?:no\.?|number|#))?\s*[:#=]?\s*((?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{2,})/gi;

/** Does this text name any model the reader knows — one, several, or a family?
 *  The same test the manual check applies to a typed question. */
export function namesAnyModel(text: string): boolean {
  const named = resolveModelFromObservationText(text);
  return Boolean(named.model) || named.ambiguous || modelIdentitiesInText(text).size > 0;
}

const labelKey = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]/g, "");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `values` removed from `text` as whole codes only: a serial "20P2" never
 *  takes the "20P2" out of "GS11N-20P2" (a "-", "." or "/" between two
 *  alphanumerics is inside a code), while "12345678." at a sentence end is
 *  still removed. */
function without(text: string, values: readonly string[]): string {
  return values.reduce(
    (out, value) => out.replace(new RegExp(`(?<![A-Z0-9]|[A-Z0-9][./-])${escape(value)}(?![A-Z0-9]|[./-][A-Z0-9])`, "gi"), " "),
    text,
  );
}

export type PhotoModelRead = {
  /** The text the model check may read, or null when it holds nothing a model check reads. */
  text: string | null;
  /** A model sits among the reading's private fields (after a serial or asset
   *  label) where it cannot be told from a serial or an asset number. Its
   *  machine is unknown: the turn asks, never answers (#5706). */
  unknown: boolean;
};

/**
 * What a photo reading gives the model check.
 *
 * Only PUBLIC text is read (ADR-0036): the reading up to its first serial or
 * asset label (photo-part-lookup.ts publicLabelText), with every value the
 * serial reader finds removed — also one printed BEFORE its label, "GS20-23P0
 * (S/N)" (Codex r2 F4) — plus explicitly labelled MODEL fields. A serial is
 * never read as a model and never reaches any search.
 *
 * Fail closed on the rest (#5706 review of 185f15c): with no labelled MODEL
 * field (which decides), a model the readers find among the private fields —
 * after a serial or asset label ("Serial No 12345678 GS20-23P0", "Machine:
 * GS20-23P0") or as a serial value itself ("GS20-23P0 (S/N)") — is never read,
 * and never ignored either: unless the public text already names it (the
 * plate's own model repeated in a barcode), the photo's machine is `unknown`.
 */
export function readPhotoModel(reading: string | null | undefined): PhotoModelRead {
  const raw = reading?.trim();
  if (!raw) return { text: null, unknown: false };
  const serials = serialCodes(raw);
  const labelled = [...raw.matchAll(MODEL_FIELD)].map((m) => m[1]).filter((value) => !serials.includes(value.toUpperCase()));
  const open = without(publicLabelText(raw), serials).replace(/\s+/g, " ").trim();
  const text = [open, ...labelled].filter(Boolean).join("\n");
  // Private text left once the serial values are out: a model there counts
  // unless the public text names that exact model (or a fuller one of it).
  const named = text ? modelLabels(text).map(labelKey) : [];
  const rest = without(privateLabelText(raw), [...serials, ...labelled]);
  const restNamesNew = namesAnyModel(rest) && modelLabels(rest).some((l) => !named.some((n) => n.startsWith(labelKey(l))));
  // A serial value counts by FAMILY: a maker's serials begin with the family
  // ("GS20-US-0031482" on a GS20-23P0 plate), so only a family the public text
  // does not name ("GS20-23P0 (S/N)" with nothing else readable) is unknown.
  const families = new Set(text ? modelMentionsInText(text).map((m) => labelKey(m.id)) : []);
  const serialNamesNew = serials.some((serial) => modelMentionsInText(serial).some((m) => !families.has(labelKey(m.id))));
  return {
    text: text && (namesAnyModel(text) || unlistedModelNumbers(text).length > 0) ? text : null,
    unknown: labelled.length === 0 && (restNamesNew || serialNamesNew),
  };
}

/** The text a photo reading gives the model check, or null (readPhotoModel). */
export function photoModelText(reading: string | null | undefined): string | null {
  return readPhotoModel(reading).text;
}

/**
 * Is the photo specific enough to END an earlier open subject, the way a typed
 * model does? Only when the reader finds exactly one machine: a family name is
 * folded into a full number it prefixes (GS20 beside GS20-23P0), never one full
 * number into another (GS11N-20P2 beside GS11N-20P2A is two — Codex r2 F2).
 *
 * This gate decides nothing about any manual. A photo naming models that does
 * not pass it, beside an earlier open subject, is asked about (manual-rag.ts),
 * so a miscount can only make the turn stricter than typing the photo's text,
 * never looser.
 */
export function namesOneMachine(text: string): boolean {
  const ids = [...modelIdentitiesInText(text)];
  const machines = ids.filter((id) => !ids.some((other) => other !== id && !id.includes("-") && other.startsWith(id)));
  if (machines.length > 1) return false;
  if (machines.length === 1) return true;
  const read = resolveModelFromObservationText(text);
  return Boolean(read.model) && !read.ambiguous;
}

/** The reader finds models here but cannot tell which one is meant ("GS10 …
 *  Micro820", two TP700 order numbers). Typed, such a question skips the
 *  coverage check; from a photo it is asked about instead (fail closed). */
export function photoIsAmbiguous(text: string): boolean {
  return namesAnyModel(text) && resolveModelFromObservationText(text).ambiguous;
}

/** The models a text names, for a question back to the technician: each
 *  family as written ("Micro820"), or the full numbers the identity reader
 *  found under it ("GS20-23P0", "GS20-21P0"). Model labels only (never a serial). */
export function modelLabels(text: string): string[] {
  const ids = [...modelIdentitiesInText(text)];
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  for (const m of modelMentionsInText(text)) {
    const full = ids.filter((id) => id.startsWith(`${m.id}-`));
    if (full.length > 0) full.forEach(add);
    else add(text.slice(m.start, m.end));
  }
  return out;
}

