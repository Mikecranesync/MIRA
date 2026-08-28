/**
 * passes.ts — multi-pass nameplate reading with per-field evidence.
 *
 * WHY THIS EXISTS. The shipped single-pass recognizer (`index.ts`) asks one
 * vision model to do two incompatible jobs at once: *transcribe* small,
 * rotated, glare-washed characters AND *interpret* them into semantic fields.
 * Measured on a real field photo, interpretation wins and transcription loses:
 * `1.27A` came back as `12A` (a 10x error a technician would act on), the motor
 * part number was dropped entirely, and a `RoHS` mark that is NOT on the plate
 * was invented.
 *
 * The fix is to separate the jobs and keep the disagreement:
 *   1. a verbatim OCR pass that is forbidden to interpret, then DETERMINISTIC
 *      regex parsing of those lines (numbers never pass through a language
 *      model's "that looks like a typical current rating" prior);
 *   2. a targeted identifier pass, because "find the part number" is a
 *      different retrieval task than "describe this nameplate";
 *   3. the semantic pass, retained for the fields it is genuinely good at.
 *
 * Every field carries how many passes produced it (`agreementCount`) and what
 * text it came from (`rawText`). Disagreement is a signal for the confirmation
 * UI, not something to average away.
 *
 * PURITY: `runMultiPass` returns data. It writes nothing, logs nothing, and
 * throws only if EVERY pass fails.
 */

import { togetherVisionModel } from "./index";

// ── Field vocabulary ─────────────────────────────────────────────────────────

export const IDENTITY_FIELDS = ["manufacturer", "model", "catalogNumber", "equipmentType"] as const;
export const SPEC_FIELDS = [
  "voltage",
  "current",
  "resolution",
  "serialNumber",
  "ambient",
  "insulation",
] as const;
export const ALL_FIELDS = [...IDENTITY_FIELDS, ...SPEC_FIELDS, "marks"] as const;

export type NameplateField = (typeof ALL_FIELDS)[number];

/** Per-field evidence. This is the shape the evidence layer consumes. */
export type FieldEvidence = {
  value: string | null;
  /** The verbatim source text the value was read from, when known. */
  rawText: string | null;
  confidence: number;
  /** How many passes independently produced this same normalized value. */
  agreementCount: number;
  /** How many passes could have produced this field at all. */
  passesSeen: number;
  /** Which passes produced the winning value. */
  sources: string[];
  /** Competing values from other passes — preserved, never averaged away. */
  alternatives: { value: string; sources: string[] }[];
};

export type MultiPassResult = {
  fields: Record<NameplateField, FieldEvidence>;
  /** Verbatim lines from the OCR pass(es), deduped in first-seen order. */
  ocrLines: string[];
  passes: PassRecord[];
  errors: { pass: string; message: string }[];
  /** Per-mark vote counts across OCR passes, and the threshold applied. */
  markVotes: { marks: string[]; votes: Record<string, number>; threshold: number };
};

export type PassRecord = {
  name: string;
  model: string;
  /** Raw provider text, kept so a later run can be diffed against this one. */
  rawResponse: string;
  parsed: Record<string, unknown> | null;
  ms: number;
};

// ── Deterministic number parsing ─────────────────────────────────────────────
//
// The single highest-value piece of code in this file. It exists because a
// language model rendered `1.27A` as `12A`. Two invariants make that class of
// error impossible here:
//   (a) a decimal point is NEVER inserted and NEVER removed — the digit count
//       after the point in the output always equals the input's;
//   (b) a token is either parsed as written (after per-character homoglyph
//       repair) or rejected as null. There is no "nearest plausible value".

const HOMOGLYPH_TO_DIGIT: Record<string, string> = {
  O: "0",
  o: "0",
  I: "1",
  i: "1",
  l: "1",
  "|": "1",
  S: "5",
  s: "5",
  B: "8",
};

const NUMERIC_TOKEN_CHARS = /^[0-9OoIil|SsB.,]+$/;

export type ParsedNumber = {
  value: number;
  /** Canonical digit string, e.g. "1.27". */
  text: string;
  /** Exactly what was matched in the source, before homoglyph repair. */
  raw: string;
  /** True when a letter was read as a digit (0/O, 1/I/l, 5/S, 8/B). */
  repaired: boolean;
  /** Digits after the decimal point. Preserved from the input, never invented. */
  decimals: number;
};

/**
 * Parse one numeric token with OCR-homoglyph tolerance. Returns null rather
 * than guessing — a missing current reading is safe, a wrong one is not.
 */
export function parseNumberToken(raw: string): ParsedNumber | null {
  const t = raw.trim();
  if (!t || !NUMERIC_TOKEN_CHARS.test(t)) return null;

  let repaired = false;
  let s = "";
  for (const ch of t) {
    const sub = HOMOGLYPH_TO_DIGIT[ch];
    if (sub !== undefined) {
      s += sub;
      repaired = true;
    } else {
      s += ch;
    }
  }

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (commas === 1 && dots === 0 && /^\d+,\d{1,3}$/.test(s)) {
    // European decimal comma. Only when it is unambiguously a decimal — a
    // thousands separator would leave us inventing a magnitude.
    s = s.replace(",", ".");
  } else if (commas > 0) {
    return null;
  }
  if (dots > 1) return null;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const dotAt = s.indexOf(".");
  return {
    value,
    text: s,
    raw: t,
    repaired,
    decimals: dotAt === -1 ? 0 : s.length - dotAt - 1,
  };
}

export type Measurement = {
  /** Canonical rendering, e.g. "1.27A" / "3.87VDC" / "0.01°/STEP". */
  text: string;
  value: number;
  unit: string;
  /** The full substring of the source line that produced this. */
  raw: string;
  repaired: boolean;
};

// A numeric token must not be glued to the left of a preceding alphanumeric, or
// we would happily read "911" out of "AZM911AC-D".
const LEFT_GUARD = "(?<![A-Za-z0-9.])";
const NUM = "([0-9OoIil|SsB.,]+)";

function firstMatch(lines: string[], re: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) return m;
  }
  return null;
}

/** `3.87VDC`, `24VDC`, `480VAC`, `208-240VAC`. */
export function parseVoltage(lines: string[]): Measurement | null {
  // Range form first — "208-240VAC" must not be read as a bare "240VAC".
  const range = firstMatch(
    lines,
    new RegExp(`${LEFT_GUARD}${NUM}\\s*[-–]\\s*${NUM}\\s*V\\s*(AC|DC)?(?![A-Za-z])`, "i"),
  );
  if (range) {
    const lo = parseNumberToken(range[1]);
    const hi = parseNumberToken(range[2]);
    if (lo && hi) {
      const unit = `V${(range[3] || "").toUpperCase()}`;
      return {
        text: `${lo.text}-${hi.text}${unit}`,
        value: hi.value,
        unit,
        raw: range[0].trim(),
        repaired: lo.repaired || hi.repaired,
      };
    }
  }
  const m = firstMatch(lines, new RegExp(`${LEFT_GUARD}${NUM}\\s*V\\s*(AC|DC)?(?![A-Za-z])`, "i"));
  if (!m) return null;
  const n = parseNumberToken(m[1]);
  if (!n) return null;
  const unit = `V${(m[2] || "").toUpperCase()}`;
  return { text: `${n.text}${unit}`, value: n.value, unit, raw: m[0].trim(), repaired: n.repaired };
}

/** `1.27A`, `100A`. Rejects the "A" inside a part number. */
export function parseCurrent(lines: string[]): Measurement | null {
  const m = firstMatch(lines, new RegExp(`${LEFT_GUARD}${NUM}\\s*A(?![A-Za-z0-9])`, "i"));
  if (!m) return null;
  const n = parseNumberToken(m[1]);
  if (!n) return null;
  return { text: `${n.text}A`, value: n.value, unit: "A", raw: m[0].trim(), repaired: n.repaired };
}

/** `0.01°/STEP` — and the same line with the degree symbol lost to OCR. */
export function parseResolution(lines: string[]): Measurement | null {
  const m = firstMatch(
    lines,
    new RegExp(`${LEFT_GUARD}${NUM}\\s*(?:°|º|o|deg\\.?)?\\s*/\\s*STEP`, "i"),
  );
  if (!m) return null;
  const n = parseNumberToken(m[1]);
  if (!n) return null;
  return {
    text: `${n.text}°/STEP`,
    value: n.value,
    unit: "°/STEP",
    raw: m[0].trim(),
    repaired: n.repaired,
  };
}

/** `Amb.40°C`, `Amb 40 C`. */
export function parseAmbient(lines: string[]): Measurement | null {
  const m = firstMatch(lines, new RegExp(`Amb[.:]?\\s*${NUM}\\s*(?:°|º|o)?\\s*C(?![A-Za-z])`, "i"));
  if (!m) return null;
  const n = parseNumberToken(m[1]);
  if (!n) return null;
  return {
    text: `Amb.${n.text}°C`,
    value: n.value,
    unit: "°C",
    raw: m[0].trim(),
    repaired: n.repaired,
  };
}

/** A bare `40°C` — accepted only when it is the WHOLE value, as from a model's
 *  `ambient` field, never scavenged out of a line of running text. */
export function coerceAmbient(value: string): Measurement | null {
  const viaLabel = parseAmbient([value]);
  if (viaLabel) return viaLabel;
  const m = value.trim().match(new RegExp(`^${NUM}\\s*(?:°|º|o)?\\s*C$`, "i"));
  if (!m) return null;
  const n = parseNumberToken(m[1]);
  if (!n) return null;
  return { text: `Amb.${n.text}°C`, value: n.value, unit: "°C", raw: value.trim(), repaired: n.repaired };
}

/** A bare `Class A` / `A`, as a model may return it for an `insulation` field. */
export function coerceInsulation(value: string): string | null {
  const viaLabel = parseInsulation([value]);
  if (viaLabel) return viaLabel;
  const m = value.trim().match(/^(?:CLASS\s*)?([A-HN])$/i);
  return m ? `INS.Class ${m[1].toUpperCase()}` : null;
}

/** `INS.Class A`, `Insulation Class F`. */
export function parseInsulation(lines: string[]): string | null {
  const m = firstMatch(lines, /INS(?:ULATION)?[.:]?\s*CLASS\s*([A-HN])\b/i);
  return m ? `INS.Class ${m[1].toUpperCase()}` : null;
}

const ID_TOKEN = "([A-Z0-9][A-Z0-9\\-/.]{2,})";

/**
 * Values that are actually the anchor's OWN trailing words, captured via regex
 * backtracking on keyword-only lines ("CAT. NO.", "SERIAL NUMBER", "MODEL
 * NO."): the optional NO./NUMBER group matches empty and the ID token eats the
 * word instead. Measured on the internet-100 replay (web-009 "NO.", web-099
 * "NUMBER", web-134 "SERIES"). A captured value that IS one of these is not a
 * value at all.
 */
const KEYWORD_NOISE = /^(?:NO\.?|NUMBER|SERIAL|MODEL|TYPE|CAT\.?|CATALOG|PART|SERIES|SPEC\.?|DATE|CODE|REF\.?)$/i;

function idCapture(m: RegExpMatchArray | null): { value: string; raw: string } | null {
  if (!m) return null;
  const value = m[1].trim();
  if (KEYWORD_NOISE.test(value)) return null;
  return { value, raw: m[0].trim() };
}

/** Labelled part / catalog number: `Motor P/N AZM911AC-D`, `Catalog: 2080-LC20-20QWB`,
 * `CAT# 301217`, Siemens article `1P 6SL3040-1MA01-0AA0`. */
export function parseCatalogNumber(lines: string[]): { value: string; raw: string } | null {
  const patterns = [
    new RegExp(`P\\s*/\\s*N[:.#\\s]*${ID_TOKEN}`, "i"),
    new RegExp(`\\bPART\\s*(?:NO\\.?|NUMBER)?[:.#\\s]*${ID_TOKEN}`, "i"),
    new RegExp(`\\bCAT(?:ALOG|\\.)?\\s*(?:NO\\.?|NUMBER)?[:.#\\s]*${ID_TOKEN}`, "i"),
    // Siemens data-matrix labels prefix the orderable article number with `1P`
    // (ISO/IEC 15434 data identifier). Line-anchored so a `1P` inside some
    // other token can't fire.
    new RegExp(`^1P[:.\\s]+${ID_TOKEN}`, "i"),
  ];
  for (const re of patterns) {
    const hit = idCapture(firstMatch(lines, re));
    if (hit) return { ...hit, value: hit.value.toUpperCase() };
  }
  return null;
}

/** Labelled model: `MODEL DGM200R-AZAC`, `Model: Micro820`, `M/N EA7-T8C`,
 * `TYPE 5K444AK456`. TYPE is last AND requires a token of >=4 chars: on real
 * plates TYPE also labels short classifier codes ("TYPE PTC", ABB "T53"
 * fragments) where the model's own fuller assignment was right — measured on
 * the internet-100 replay (web-049, web-109). */
export function parseModel(lines: string[]): { value: string; raw: string } | null {
  const patterns = [
    new RegExp(`\\bMODEL[:.#\\s]*${ID_TOKEN}`, "i"),
    new RegExp(`\\bMOD\\.\\s*${ID_TOKEN}`, "i"),
    new RegExp(`\\bM\\s*/\\s*N[:.#\\s]*${ID_TOKEN}`, "i"),
  ];
  for (const re of patterns) {
    const hit = idCapture(firstMatch(lines, re));
    if (hit) return hit;
  }
  const type = idCapture(firstMatch(lines, new RegExp(`\\bTYPE[:.#\\s]+${ID_TOKEN}`, "i")));
  if (type && type.value.length >= 4) return type;
  return null;
}

/** Labelled serial / lot: `S/N 12345`, `SER.NO. X`, `SERIAL: ABC-9`, `LOT QS8`,
 * `ID# Z 03 7689115`, and the Siemens bare-`S` data-identifier line
 * (`S T-P96166484`). */
export function parseSerial(lines: string[]): { value: string; raw: string } | null {
  const m = idCapture(
    firstMatch(
      lines,
      // Capture floor is 3 chars — real serials can be short ("SER NO J10").
      /\b(?:S\s*\/\s*N|\bSN\b|SER\.?\s*NO\.?|SERIAL(?:\s*NO\.?|\s*NUMBER)?|LOT(?:\s*NO\.?)?|ID#)[:.#\s]*([A-Z0-9][A-Z0-9\-/ ]{2,})/i,
    ),
  );
  if (m) return m;
  // Siemens labels: `S T-P96166484` — the bare `S` data identifier starts the
  // line. Require length >=5 after it so a stray "S 123" can't fire.
  const s = idCapture(firstMatch(lines, /^S[:.\s]+([A-Z0-9][A-Z0-9\-/]{4,})$/i));
  return s;
}

/**
 * The printed-anchor lookup behind the identity promotion gate: which value
 * does the PLATE label as this field? Returns null when no anchored line
 * exists — which is exactly the situation in which a model-assigned identity
 * must not be promoted unconfirmed (the internet-100 benchmark's dominant
 * failure was correctly-read strings slotted into unanchored identity fields:
 * frame sizes as models, bearing numbers as serials).
 */
const KEYWORD_ONLY: Record<"model" | "catalogNumber" | "serialNumber", RegExp> = {
  model: /^(?:MODEL|M\s*\/\s*N)[:.#\s]*$/i,
  catalogNumber: /^(?:P\s*\/\s*N|PART\s*(?:NO\.?|NUMBER)?|CAT(?:ALOG|\.)?\s*(?:NO\.?|NUMBER)?#?|1P)[:.#\s]*$/i,
  serialNumber: /^(?:S\s*\/\s*N|SN|SER\.?\s*NO\.?|SERIAL(?:\s*NO\.?|\s*NUMBER)?|LOT(?:\s*NO\.?)?)[:.#\s]*$/i,
};

/** Does this line look like an identifier value (not prose, not a heading)? */
function looksLikeIdValue(field: "model" | "catalogNumber" | "serialNumber", line: string): boolean {
  if (KEYWORD_ONLY.model.test(line) || KEYWORD_ONLY.catalogNumber.test(line) || KEYWORD_ONLY.serialNumber.test(line)) {
    return false;
  }
  if (field === "serialNumber") {
    // Serials may contain spaces ("QS8 I119701") but always carry a digit —
    // which keeps prose neighbors like "MADE IN JAPAN" out.
    return /^[A-Z0-9][A-Z0-9\-/. ]{3,}$/i.test(line) && /\d/.test(line);
  }
  // Models/catalogs are single tokens — a spaced line is a description.
  return /^[A-Z0-9][A-Z0-9\-/.]{2,}$/i.test(line);
}

/**
 * The printed-anchor lookup behind the identity promotion gate: which value
 * does the PLATE label as this field? Returns null when no anchored line
 * exists — which is exactly the situation in which a model-assigned identity
 * must not be promoted unconfirmed (the internet-100 benchmark's dominant
 * failure was correctly-read strings slotted into unanchored identity fields:
 * frame sizes as models, bearing numbers as serials).
 *
 * Two anchor shapes, because OCR splits them both ways on real plates:
 *  1. same line   — "MODEL DGM200R-AZAC", "1P 6SL3040-1MA01-0AA0"
 *  2. adjacent    — a keyword-only line ("MODEL") with the value on the next
 *                   line, or the previous one (recognizers do not preserve
 *                   print order reliably).
 */
export function anchoredValueFor(
  field: "model" | "catalogNumber" | "serialNumber",
  lines: string[],
): { value: string; raw: string } | null {
  const clean = lines.map((l) => String(l ?? "").trim()).filter(Boolean);
  const sameLine =
    field === "model" ? parseModel(clean) : field === "catalogNumber" ? parseCatalogNumber(clean) : parseSerial(clean);
  if (sameLine) return sameLine;

  const keyword = KEYWORD_ONLY[field];
  for (let i = 0; i < clean.length; i++) {
    if (!keyword.test(clean[i])) continue;
    for (const j of [i + 1, i - 1]) {
      const neighbor = clean[j];
      if (neighbor && looksLikeIdValue(field, neighbor)) {
        return { value: neighbor.trim(), raw: `${clean[i]} ${neighbor.trim()}` };
      }
    }
  }
  return null;
}

/** Manufacturer, when the plate labels it (synthetic/asset-tag style plates). */
export function parseManufacturer(lines: string[]): { value: string; raw: string } | null {
  const m = firstMatch(lines, /\bMANUFACTURER[:.\s]+(.{2,60})$/i);
  if (m) return { value: m[1].trim(), raw: m[0].trim() };
  return null;
}

/**
 * Certification marks. THE ANTI-HALLUCINATION SURFACE: a mark is reported only
 * when its literal letters appear in the verbatim OCR lines. There is no
 * "equipment of this type usually carries…" path into this function.
 */
export const KNOWN_MARKS: { name: string; re: RegExp }[] = [
  { name: "UL", re: /\b(?:c?\s?UL\s?us|UL)\b/ },
  { name: "CE", re: /(?:^|[^A-Za-z])CE(?![A-Za-z])/ },
  { name: "UKCA", re: /\bUK\s*CA\b/i },
  { name: "CSA", re: /\bCSA\b/ },
  { name: "RoHS", re: /\bRoHS\b/i },
  { name: "TUV", re: /\bT[UÜ]V\b/i },
  { name: "CCC", re: /\bCCC\b/ },
  { name: "ATEX", re: /\bATEX\b/i },
];

export function parseMarks(lines: string[]): string[] {
  const found: string[] = [];
  for (const { name, re } of KNOWN_MARKS) {
    if (lines.some((l) => re.test(l))) found.push(name);
  }
  return found;
}

/**
 * Vote a mark set across INDEPENDENT OCR passes.
 *
 * The literal-presence rule in `parseMarks` is necessary but not sufficient:
 * measured on the real photo, the OCR pass itself emitted a `RoHS` line for a
 * plate that has no RoHS mark, so "only report what the transcription contains"
 * faithfully reported a fabricated transcription. What distinguishes the real
 * marks from the invented one is REPETITION — UL/CE/UKCA survive re-reads of
 * the same plate, `RoHS` does not.
 *
 * With a single OCR pass there is nothing to vote on and the threshold is 1;
 * this gate only earns its keep when several passes are available.
 */
export function voteMarks(perPass: string[][]): { marks: string[]; votes: Record<string, number>; threshold: number } {
  const votes: Record<string, number> = {};
  for (const lines of perPass) {
    for (const m of parseMarks(lines)) votes[m] = (votes[m] ?? 0) + 1;
  }
  const threshold = perPass.length >= 2 ? 2 : 1;
  const marks = Object.entries(votes)
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m]) => m);
  return { marks, votes, threshold };
}

/**
 * Re-parse a model-supplied spec value through the deterministic parser and
 * keep it ONLY if it conforms to the field's shape.
 *
 * Measured cause: the semantic pass put a drive's OUTPUT VOLTAGE ("0-240VAC")
 * into the `current` field. A value that cannot be read as amps is not a
 * current reading no matter how confidently a model labelled it.
 */
export function coerceSpecValue(field: NameplateField, value: string): string | null {
  switch (field) {
    case "voltage":
      return parseVoltage([value])?.text ?? null;
    case "current":
      return parseCurrent([value])?.text ?? null;
    case "resolution":
      return parseResolution([value])?.text ?? null;
    case "ambient":
      return coerceAmbient(value)?.text ?? null;
    case "insulation":
      return coerceInsulation(value);
    default:
      return value;
  }
}

export type DeterministicFields = {
  manufacturer: { value: string; raw: string } | null;
  model: { value: string; raw: string } | null;
  catalogNumber: { value: string; raw: string } | null;
  serialNumber: { value: string; raw: string } | null;
  voltage: Measurement | null;
  current: Measurement | null;
  resolution: Measurement | null;
  ambient: Measurement | null;
  insulation: string | null;
  marks: string[];
};

/** Deterministic field extraction from verbatim OCR lines. No model involved. */
export function parseNameplateLines(lines: string[]): DeterministicFields {
  const clean = lines.map((l) => String(l ?? "").trim()).filter(Boolean);
  return {
    manufacturer: parseManufacturer(clean),
    model: parseModel(clean),
    catalogNumber: parseCatalogNumber(clean),
    serialNumber: parseSerial(clean),
    voltage: parseVoltage(clean),
    current: parseCurrent(clean),
    resolution: parseResolution(clean),
    ambient: parseAmbient(clean),
    insulation: parseInsulation(clean),
    marks: parseMarks(clean),
  };
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const ANTI_HALLUCINATION = `Never output a word, number, logo name or certification mark that you cannot actually see in this image. Do not add a mark (UL, CE, UKCA, CSA, RoHS, TUV, CCC) because equipment of this type usually carries it — only if its letters are visibly present. When unsure, use null.`;

export const OCR_PROMPT = `You are a TRANSCRIPTION engine reading a photograph of an industrial equipment nameplate.
Transcribe every line of text you can actually see, VERBATIM. Do not interpret, expand, translate, correct, reorder or reformat anything.
Rules:
- Copy characters exactly as printed, including decimal points, degree symbols, slashes, hyphens and spacing. "1.27A" is NOT "12A". "0.01°/STEP" is NOT "001/STEP". A decimal point is a character: never drop it and never add one.
- The label may be rotated, curved, dusty or lit at an angle. Read it anyway and output the text upright.
- If part of a line is unreadable, transcribe only the part you can read. Never guess a character to complete a word or a number.
- ${ANTI_HALLUCINATION}
Respond ONLY with JSON: {"lines": string[]}`;

export const IDENTIFIER_PROMPT = `Look at this industrial nameplate photograph and find its IDENTIFIER strings only.
An industrial plate usually carries MORE THAN ONE identifier: a MODEL, and separately a part or catalog number (often labelled P/N, PART NO, CAT, CAT NO, MOTOR P/N, TYPE), and sometimes a serial or lot code.
Copy each one VERBATIM, character for character, including hyphens and slashes. Do not merge them, do not normalize them, do not shorten them.
- ${ANTI_HALLUCINATION}
Respond ONLY with JSON:
{"model": string|null, "partNumber": string|null, "partNumberLabel": string|null, "serial": string|null, "identifierLines": string[]}`;

export const SEMANTIC_PROMPT = `You are reading an industrial equipment NAMEPLATE photograph.
Extract ONLY text that is visible in the image.
Rules: do not invent missing serial/model digits; preserve punctuation exactly; copy numbers digit for digit including decimal points; distinguish model vs catalog vs serial numbers when possible; use null for any unreadable field.
- ${ANTI_HALLUCINATION}
Respond ONLY with JSON:
{"manufacturer": string|null, "model": string|null, "catalogNumber": string|null,
 "serialNumber": string|null, "equipmentType": string|null, "voltage": string|null,
 "current": string|null, "resolution": string|null, "ambient": string|null,
 "insulation": string|null, "marks": string[],
 "confidence": number, "rawText": string[]}`;

// ── Provider call ────────────────────────────────────────────────────────────

export type VisionImage = { base64: string; mimeType: string; label?: string };

export type VisionCall = (args: {
  prompt: string;
  images: VisionImage[];
  temperature: number;
  maxTokens: number;
}) => Promise<{ text: string; model: string }>;

/**
 * Together vision call. Deliberately mirrors `index.ts`'s provider contract
 * (same base URL, same JSON mode, model id from `togetherVisionModel()`), but
 * takes prompt/temperature/max_tokens per pass instead of hardcoding one shape.
 */
export const togetherVisionCall: VisionCall = async ({ prompt, images, temperature, maxTokens }) => {
  const key = process.env.TOGETHERAI_API_KEY;
  if (!key) throw new Error("recognizer_not_configured");
  const model = togetherVisionModel();
  const content: unknown[] = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }
  const resp = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) throw new Error(`recognizer_provider_error_${resp.status}`);
  const body = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: body.choices?.[0]?.message?.content ?? "{}", model };
};

export function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    // Some providers wrap JSON in prose even in JSON mode.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const v = JSON.parse(m[0]);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

// ── Candidate collection + agreement merge ───────────────────────────────────

type Candidate = {
  field: NameplateField;
  value: string;
  rawText: string | null;
  source: string;
  /** Prior trust in the producing pass, before agreement is counted. */
  base: number;
  repaired?: boolean;
};

/** Agreement key: case/space/punctuation-insensitive, so `AZM911AC-D` === `azm911ac d`. */
export function agreementKey(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const EMPTY_EVIDENCE = (passesSeen: number): FieldEvidence => ({
  value: null,
  rawText: null,
  confidence: 0,
  agreementCount: 0,
  passesSeen,
  sources: [],
  alternatives: [],
});

/**
 * Merge candidates into one evidence record per field.
 *
 * Selection is by (agreement count, then producing-pass trust). A value that
 * two passes reached independently beats a lone confident assertion — which is
 * exactly the situation that produced `12A` from a single semantic pass.
 */
export function mergeCandidates(
  candidates: Candidate[],
  passesSeenByField: Record<string, number>,
): Record<NameplateField, FieldEvidence> {
  const out = {} as Record<NameplateField, FieldEvidence>;
  for (const field of ALL_FIELDS) {
    const seen = passesSeenByField[field] ?? 0;
    const mine = candidates.filter((c) => c.field === field);
    if (!mine.length) {
      out[field] = EMPTY_EVIDENCE(seen);
      continue;
    }
    const groups = new Map<string, Candidate[]>();
    for (const c of mine) {
      const k = agreementKey(c.value);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(c);
      else groups.set(k, [c]);
    }
    if (!groups.size) {
      out[field] = EMPTY_EVIDENCE(seen);
      continue;
    }
    const ranked = [...groups.values()].sort((a, b) => {
      const byAgreement = b.length - a.length;
      if (byAgreement) return byAgreement;
      return Math.max(...b.map((c) => c.base)) - Math.max(...a.map((c) => c.base));
    });
    const win = ranked[0];
    const best = [...win].sort((a, b) => b.base - a.base)[0];
    const repaired = win.some((c) => c.repaired);
    const confidence = Math.min(
      0.99,
      Math.max(0.05, best.base + 0.12 * (win.length - 1) - (repaired ? 0.1 : 0)),
    );
    out[field] = {
      value: best.value,
      rawText: best.rawText,
      confidence: Math.round(confidence * 100) / 100,
      agreementCount: win.length,
      passesSeen: seen,
      sources: [...new Set(win.map((c) => c.source))],
      alternatives: ranked.slice(1).map((g) => ({
        value: g[0].value,
        sources: [...new Set(g.map((c) => c.source))],
      })),
    };
  }
  return out;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export type PassName = "semantic" | "ocr" | "identifier";

export type MultiPassOptions = {
  call?: VisionCall;
  /** Which passes to run. Order is irrelevant; they run concurrently. */
  passes?: PassName[];
  /** Extra renderings of the same plate (e.g. rotated) fed to the OCR pass. */
  extraOcrImages?: VisionImage[];
  /** Same, for the targeted identifier pass. Part numbers are the field that
   *  suffers most from a rotated label, so it is worth re-asking per rendering. */
  extraIdentifierImages?: VisionImage[];
  temperature?: number;
  /** Prepended to every prompt — e.g. `orientationHint()` from preprocess.ts. */
  hint?: string | null;
};

const BASE_TRUST: Record<string, number> = {
  deterministic: 0.75,
  identifier: 0.7,
  semantic: 0.55,
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(null|none|unknown|n\/a|not visible|unreadable|not specified)$/i.test(t)) return null;
  return t.slice(0, 200);
}

/**
 * Run the configured passes and return per-field evidence.
 *
 * Pure: no I/O beyond the injected `call`, no mutation of inputs, no logging.
 * Individual pass failures are collected into `errors` rather than thrown — a
 * dead identifier pass must not cost the technician the OCR pass's numbers.
 */
export async function runMultiPass(
  image: VisionImage,
  opts: MultiPassOptions = {},
): Promise<MultiPassResult> {
  const call = opts.call ?? togetherVisionCall;
  const wanted: PassName[] = opts.passes ?? ["semantic", "ocr", "identifier"];
  const temperature = opts.temperature ?? 0.1;
  const hint = opts.hint ? `${opts.hint}\n\n` : "";

  const passes: PassRecord[] = [];
  const errors: { pass: string; message: string }[] = [];

  const jobs: Promise<void>[] = [];
  const record = async (name: string, prompt: string, images: VisionImage[], maxTokens: number) => {
    const t0 = Date.now();
    try {
      const { text, model } = await call({ prompt: hint + prompt, images, temperature, maxTokens });
      passes.push({ name, model, rawResponse: text, parsed: safeJson(text), ms: Date.now() - t0 });
    } catch (err) {
      errors.push({ pass: name, message: err instanceof Error ? err.message : "pass_failed" });
    }
  };

  if (wanted.includes("semantic")) {
    jobs.push(record("semantic", SEMANTIC_PROMPT, [image], 700));
  }
  if (wanted.includes("ocr")) {
    jobs.push(record("ocr", OCR_PROMPT, [image], 900));
    for (const [i, extra] of (opts.extraOcrImages ?? []).entries()) {
      jobs.push(record(`ocr:${extra.label ?? i}`, OCR_PROMPT, [extra], 900));
    }
  }
  if (wanted.includes("identifier")) {
    jobs.push(record("identifier", IDENTIFIER_PROMPT, [image], 500));
    for (const [i, extra] of (opts.extraIdentifierImages ?? []).entries()) {
      jobs.push(record(`identifier:${extra.label ?? i}`, IDENTIFIER_PROMPT, [extra], 500));
    }
  }
  await Promise.all(jobs);

  if (!passes.length) {
    throw new Error(errors[0]?.message ?? "recognizer_all_passes_failed");
  }

  // ── Collect OCR lines ──
  const ocrLines: string[] = [];
  const seenLine = new Set<string>();
  const pushLine = (l: unknown) => {
    const s = str(l);
    if (!s) return;
    const k = s.toUpperCase().replace(/\s+/g, " ");
    if (seenLine.has(k)) return;
    seenLine.add(k);
    ocrLines.push(s);
  };
  for (const p of passes) {
    if (!p.parsed) continue;
    if (p.name.startsWith("ocr") && Array.isArray(p.parsed.lines)) {
      for (const l of p.parsed.lines) pushLine(l);
    }
    if (p.name.startsWith("identifier") && Array.isArray(p.parsed.identifierLines)) {
      for (const l of p.parsed.identifierLines) pushLine(l);
    }
    if (p.name === "semantic" && Array.isArray(p.parsed.rawText)) {
      for (const l of p.parsed.rawText) pushLine(l);
    }
  }

  const candidates: Candidate[] = [];
  const passesSeenByField: Record<string, number> = {};
  let markVotes: MultiPassResult["markVotes"] = { marks: [], votes: {}, threshold: 1 };
  const bump = (fields: readonly NameplateField[]) => {
    for (const f of fields) passesSeenByField[f] = (passesSeenByField[f] ?? 0) + 1;
  };

  // ── Deterministic parse — ONE PARSE PER OCR PASS, not one over the pooled
  // lines. Pooling silently destroys the agreement signal: two independent
  // reads of "1.27A" and one hallucinated "P/N 00109758" all collapse into a
  // single line set, and every field then has agreementCount 1 whatever the
  // evidence. Parsing per pass is what lets repetition outvote invention.
  const ocrLineSets: { name: string; lines: string[] }[] = [];
  for (const p of passes) {
    if (!p.name.startsWith("ocr") || !p.parsed || !Array.isArray(p.parsed.lines)) continue;
    const lines = (p.parsed.lines as unknown[]).map((l) => str(l)).filter((l): l is string => !!l);
    if (lines.length) ocrLineSets.push({ name: p.name, lines });
  }

  if (ocrLineSets.length) {
    for (const f of ALL_FIELDS) {
      passesSeenByField[f] = (passesSeenByField[f] ?? 0) + ocrLineSets.length;
    }
    for (const set of ocrLineSets) {
      const det = parseNameplateLines(set.lines);
      const source = `det:${set.name}`;
      const add = (field: NameplateField, value: string | null, raw: string | null, rep = false) => {
        if (value) {
          candidates.push({
            field,
            value,
            rawText: raw,
            source,
            base: BASE_TRUST.deterministic,
            repaired: rep,
          });
        }
      };
      add("manufacturer", det.manufacturer?.value ?? null, det.manufacturer?.raw ?? null);
      add("model", det.model?.value ?? null, det.model?.raw ?? null);
      add("catalogNumber", det.catalogNumber?.value ?? null, det.catalogNumber?.raw ?? null);
      add("serialNumber", det.serialNumber?.value ?? null, det.serialNumber?.raw ?? null);
      add("voltage", det.voltage?.text ?? null, det.voltage?.raw ?? null, det.voltage?.repaired);
      add("current", det.current?.text ?? null, det.current?.raw ?? null, det.current?.repaired);
      add(
        "resolution",
        det.resolution?.text ?? null,
        det.resolution?.raw ?? null,
        det.resolution?.repaired,
      );
      add("ambient", det.ambient?.text ?? null, det.ambient?.raw ?? null, det.ambient?.repaired);
      add("insulation", det.insulation, det.insulation);
    }
    // Marks are voted across passes rather than unioned — see `voteMarks`.
    const voted = voteMarks(ocrLineSets.map((s) => s.lines));
    if (voted.marks.length) {
      const label = voted.marks.join(", ");
      candidates.push({
        field: "marks",
        value: label,
        rawText: label,
        source: "deterministic",
        base: BASE_TRUST.deterministic,
      });
    }
    markVotes = voted;
  }

  // ── Model passes ──
  for (const p of passes) {
    if (!p.parsed) continue;
    if (p.name === "semantic") {
      bump(ALL_FIELDS);
      const o = p.parsed;
      const marks = Array.isArray(o.marks)
        ? (o.marks as unknown[]).map((m) => str(m)).filter(Boolean)
        : [];
      const pairs: [NameplateField, string | null][] = [
        ["manufacturer", str(o.manufacturer)],
        ["model", str(o.model)],
        ["catalogNumber", str(o.catalogNumber ?? o.catalog_number)],
        ["serialNumber", str(o.serialNumber ?? o.serial_number)],
        ["equipmentType", str(o.equipmentType ?? o.equipment_type)],
        ["voltage", str(o.voltage)],
        ["current", str(o.current)],
        ["resolution", str(o.resolution)],
        ["ambient", str(o.ambient)],
        ["insulation", str(o.insulation)],
        ["marks", marks.length ? marks.join(", ") : null],
      ];
      for (const [field, rawValue] of pairs) {
        if (!rawValue) continue;
        // Shape-check every model-supplied spec value; a value that cannot be
        // read as its own field is dropped, not passed through with a label.
        const value = coerceSpecValue(field, rawValue);
        if (!value) continue;
        candidates.push({
          field,
          value,
          rawText: rawValue,
          source: "semantic",
          base: BASE_TRUST.semantic,
        });
      }
    }
    if (p.name.startsWith("identifier")) {
      bump(["model", "catalogNumber", "serialNumber"]);
      const o = p.parsed;
      const model = str(o.model);
      const partNumber = str(o.partNumber ?? o.part_number);
      // A plate with ONE identifier makes the identifier pass report it twice,
      // once as model and once as part number — inventing a catalog number for
      // equipment that has none (measured on the Square D MCC tag).
      const distinctPart =
        partNumber && (!model || agreementKey(partNumber) !== agreementKey(model))
          ? partNumber
          : null;
      const pairs: [NameplateField, string | null][] = [
        ["model", model],
        ["catalogNumber", distinctPart],
        ["serialNumber", str(o.serial)],
      ];
      for (const [field, value] of pairs) {
        if (value) {
          candidates.push({
            field,
            value,
            rawText: str(o.partNumberLabel) ?? value,
            source: p.name,
            base: BASE_TRUST.identifier,
          });
        }
      }
    }
  }

  return {
    fields: mergeCandidates(candidates, passesSeenByField),
    ocrLines,
    passes,
    errors,
    markVotes,
  };
}

/** Flatten evidence to the plain string map the scorer/UI compares against. */
export function evidenceToValues(
  fields: Record<NameplateField, FieldEvidence>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of ALL_FIELDS) out[f] = fields[f]?.value ?? null;
  return out;
}
