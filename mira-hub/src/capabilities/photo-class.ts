/**
 * Photo class — electrical print vs nameplate vs other (2026-10-17 prod-test
 * item 8).
 *
 * A technician's photo arrives as one of three things, and they want opposite
 * treatments: an **electrical print** (a schematic/ladder sheet) needs
 * cross-sheet reasoning, which is PrintSense's job and nobody else's; a
 * **nameplate** needs the identity readout the Hub already has
 * (`nameplate-identity-adoption.ts`, `photo-part-lookup.ts`); anything else is
 * an ordinary observation. Today every photo takes the same path, so a print
 * gets read as if it were a nameplate and the answer is nonsense.
 *
 * Deterministic and zero-token: this classifies the **INSPECTION readout text
 * the Hub already produced** for the photo (`recordLookObservation`'s
 * `observation`), not the image. No second vision call, no new provider — the
 * expensive perception already happened and is materialized.
 *
 * It is deliberately a *router*, not a reader: it decides which specialist
 * should look, and says `other` whenever the readout does not clearly show one
 * of the two. A wrong `other` costs today's behaviour; a wrong `electrical_print`
 * would route a nameplate to a paid service, so the print bar is the higher one.
 */

export type PhotoClass = "electrical_print" | "nameplate" | "other";

export type PhotoClassVerdict = {
  klass: PhotoClass;
  /** Which signals fired, closed-vocabulary, for logs and the packet. */
  signals: string[];
};

/** Print vocabulary: what a schematic/ladder sheet's readout says. */
const PRINT_SIGNALS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "ladder_rung", re: /\b(?:ladder\s+(?:diagram|logic|rung)|rung\s+\d{1,4}|rungs?\b)/i },
  { id: "schematic_word", re: /\b(?:schematic|wiring\s+diagram|elementary\s+diagram|one[- ]line\s+diagram|single[- ]line\s+diagram|circuit\s+diagram)\b/i },
  { id: "sheet_ref", re: /\b(?:sheet\s+\d{1,3}(?:\s+of\s+\d{1,3})?|dwg\.?\s*(?:no\.?)?\s*[a-z0-9-]{3,}|drawing\s+(?:no\.?|number))\b/i },
  { id: "device_tags", re: /\b(?:CR\d{1,3}|TD\d{1,3}|PB\d{1,3}|LS\d{1,3}|SOL\d{1,3}|MTR\d{1,3})\b/ },
  { id: "contact_coil", re: /\b(?:normally\s+(?:open|closed)|N\.?O\.?\s+contact|N\.?C\.?\s+contact|coil\s+symbol|contact\s+symbol)\b/i },
  { id: "xref", re: /\b(?:cross[- ]reference|continued\s+on\s+sheet|see\s+sheet\s+\d{1,3})\b/i },
  { id: "terminal_strip", re: /\b(?:terminal\s+(?:strip|block)\s+(?:TB|X)\d{0,3}|wire\s+number(?:s)?)\b/i },
];

/** Nameplate vocabulary: what a rating/data plate's readout says. */
const NAMEPLATE_SIGNALS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "nameplate_word", re: /\b(?:nameplate|name\s+plate|data\s+plate|rating\s+plate|id\s+plate|label\s+on\s+the)\b/i },
  { id: "catalog_serial", re: /\b(?:cat(?:alog)?\.?\s*(?:no\.?|number)|model\s+(?:no\.?|number)|part\s+(?:no\.?|number)|serial\s+(?:no\.?|number)|s\/n\b|p\/n\b)/i },
  { id: "electrical_rating", re: /\b\d+(?:\.\d+)?\s*(?:hp|kw|amps?|a\b|volts?|v\b|vac|vdc|hz|rpm)\b/i },
  { id: "phase_duty", re: /\b(?:single[- ]phase|three[- ]phase|3[- ]?ph\b|1[- ]?ph\b|duty\s+cycle|service\s+factor|insulation\s+class|enclosure\s+type|NEMA\s+\d|IP\d{2})\b/i },
  { id: "mfr_block", re: /\b(?:manufactured\s+by|made\s+in|mfg\.?\s+date|date\s+code)\b/i },
];

function fired(text: string, set: ReadonlyArray<{ id: string; re: RegExp }>): string[] {
  return set.filter((s) => s.re.test(text)).map((s) => s.id);
}

/**
 * Classify the photo from its INSPECTION readout.
 *
 * Thresholds, and why they are asymmetric: a print needs **two** independent
 * signals, a nameplate **one**. Routing a nameplate to a paid print service is
 * the expensive mistake; leaving a print on today's path is merely today's
 * behaviour. When both sides fire, the stronger count wins and a tie goes to
 * `nameplate` — the cheap, already-built path.
 */
export function classifyPhoto(observation: string | null | undefined): PhotoClassVerdict {
  const text = (observation ?? "").trim();
  if (!text) return { klass: "other", signals: [] };

  const print = fired(text, PRINT_SIGNALS);
  const plate = fired(text, NAMEPLATE_SIGNALS);

  const printQualifies = print.length >= 2;
  const plateQualifies = plate.length >= 1;

  if (printQualifies && (!plateQualifies || print.length > plate.length)) {
    return { klass: "electrical_print", signals: print };
  }
  if (plateQualifies) return { klass: "nameplate", signals: plate };
  // One print signal alone is not a print — "wire numbers" appears on plenty
  // of equipment photos. Stay on today's path.
  return { klass: "other", signals: print };
}
