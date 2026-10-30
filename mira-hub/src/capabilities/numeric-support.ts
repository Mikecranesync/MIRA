/**
 * Numeric-claim support primitives (#4870 R4 calibration, T-2).
 *
 * The 40-turn human calibration of R4_NO_INVENTED_VALUES found every deterministic flag on a
 * human-approved answer came from one of three misses: a number that IS on the cited page or
 * in the photo reading was counted as unsupported, or a model / catalog / fault-code token was
 * read as a quantity. These two pure helpers fix the shared part:
 *
 *  - `identifierAt` — is this number part of an identifier (KX450, 3150-QR40-16XYZ, fault
 *    0042, IM 155-6) rather than a quantity? A true quantity with a unit stays a claim.
 *  - `appearsVerbatim` — does this value's literal text appear in a source or observation,
 *    up to spacing, case, dash style and degree-sign spelling? A longer number, a
 *    letter-glued code, a decimal continuation or a negative sign never counts.
 *
 * Deterministic, zero-token, no I/O. The unit table lives here so supporting-quote.ts and the
 * anomaly detector share one definition of "a unit".
 */

// Design rev 5 (#4315 §14): a value is usable only when EVERY part of it is recognized. Its
// unit must be in this closed table. Symbols are matched exactly as written — case carries
// meaning (mW ≠ MW, mΩ ≠ MΩ, N·m ≠ nm) — and only unambiguous case variants are listed. A
// spelled-out name matches in any case. An unknown unit, or no unit, makes a value unusable.
// Maps, not object literals: a lookup must never reach an inherited property ("constructor").
const UNIT_SYMBOLS = new Map<string, string>(Object.entries({
  V: "V", v: "V", mV: "mV", kV: "kV", KV: "kV", MV: "MV", Vrms: "Vrms", VRMS: "Vrms",
  VAC: "VAC", Vac: "VAC", "V AC": "VAC", "V ac": "VAC", VDC: "VDC", Vdc: "VDC", "V DC": "VDC", "V dc": "VDC",
  A: "A", mA: "mA", kA: "kA", W: "W", mW: "mW", kW: "kW", KW: "kW", kw: "kW", MW: "MW",
  VA: "VA", kVA: "kVA", KVA: "kVA", kva: "kVA", Hz: "Hz", hz: "Hz", HZ: "Hz", kHz: "kHz", KHz: "kHz", khz: "kHz", MHz: "MHz",
  rpm: "rpm", RPM: "rpm", "°C": "°C", "ºC": "°C", "℃": "°C", "°F": "°F", "ºF": "°F", "℉": "°F", "%": "%",
  "Ω": "Ω", "kΩ": "kΩ", "MΩ": "MΩ", "mΩ": "mΩ", "N·m": "N·m", "N-m": "N·m", Nm: "N·m", "N m": "N·m",
  "lb·in": "lb·in", "lb-in": "lb·in", "lb·ft": "lb·ft", "lb-ft": "lb·ft",
  mm: "mm", cm: "cm", m: "m", km: "km", in: "in", ft: "ft", mm2: "mm²", m2: "m²", AWG: "AWG", awg: "AWG",
  s: "s", ms: "ms", "µs": "µs", min: "min", h: "h", Pa: "Pa", kPa: "kPa", MPa: "MPa", bar: "bar",
  psi: "psi", PSI: "psi", hp: "hp", HP: "hp",
}));
const UNIT_NAMES = new Map<string, string>(Object.entries({
  volt: "V", volts: "V", amp: "A", amps: "A", ampere: "A", amperes: "A", watt: "W", watts: "W",
  kilowatt: "kW", kilowatts: "kW", hertz: "Hz", second: "s", seconds: "s", sec: "s", secs: "s",
  minute: "min", minutes: "min", mins: "min", hour: "h", hours: "h", hr: "h", hrs: "h", percent: "%",
  ohm: "Ω", ohms: "Ω", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm", inch: "in", inches: "in",
}));
/** The table unit a token names, or null. `N · m` and `lb - in` close up before lookup. */
export function tableUnit(token: string): string | null {
  const k = token.replace(/\s*([·-])\s*/g, "$1").replace(/\s+/g, " ");
  return UNIT_SYMBOLS.get(k) ?? UNIT_NAMES.get(k.toLowerCase()) ?? null;
}

// Hyphens that join the parts of one code (ASCII, U+2010, U+2011). En/em dashes are range marks.
const CODE_HYPHEN = /[-‐‑]/u;
// A word that names what follows it as a code, not a quantity ("fault 31", "parameter 118").
const CODE_WORD =
  /(?:^|[^\p{L}\d])(?:fault|faults|error|errors|err|alarm|alarms|code|codes|warning|parameter|param|catalog|cat\.?|part|model|series|type|no\.|#)\s*$/iu;
// An all-caps family prefix spaced from its number ("IM 155-6", "QM 210").
const CAPS_PREFIX = /(?:^|[^\p{L}\d])(\p{Lu}[\p{Lu}\d]{1,4}) $/u;

/** Is a table unit the next word after `end` (glued "24V", hyphenated "12-volt", or spaced "30 A")? */
function unitFollows(text: string, end: number): boolean {
  const m = /^[ \t]*[-‐‑]?[ \t]*([\p{L}°µΩ%℃℉][\p{L}\d·]*|%)/u.exec(text.slice(end, end + 24));
  if (!m) return false;
  if (tableUnit(m[1])) return true;
  // "24 V DC" / "5 V/12 V": the unit is the first letters of a longer token.
  const head = /^(?:[°µ]?\p{L}{1,3}|%|℃|℉)/u.exec(m[1])?.[0] ?? "";
  for (let n = head.length; n > 0; n--) if (tableUnit(m[1].slice(0, n)) && !/\p{L}/u.test(m[1][n] ?? "")) return true;
  return false;
}

/** A spaced word after a number that is plausibly a unit the closed table lacks: a µ/° symbol, or a
 *  gauge/absolute/energy/reactive variant of a table unit (psig, PSIA, barg, mbar, kvar, kWh). A
 *  plain word ("is", "means", "clears") is not — the stricter test the spaced case needs. */
const SPACED_UNIT_LIKE = /^(?:[µμ°]|(?:psi|bar)[ag]$|[mk]?bar$|k?var$|[kMG]?Wh$|[kM]?VAh$)/iu;

/** Could this letter token be (the start of) a unit? A table unit, case-insensitively, at any of
 *  its first four letters ("PSIG" ⇒ psi, "KVAR" ⇒ kV, "AXB" ⇒ A). Deliberately generous: a token
 *  that might be a unit keeps its number an auditable claim (#4981 Codex r3 F1). */
function unitLike(token: string): boolean {
  for (let n = 1; n <= Math.min(4, token.length); n++) {
    const head = token.slice(0, n);
    if (tableUnit(head) || tableUnit(head.toLowerCase())) return true;
  }
  return false;
}

/**
 * Is the number whose digits span [start, end) of `text` part of an identifier rather than a
 * quantity? Only STRONG identifier forms count (#4981 Codex r3 F1 — an unrecognized glued suffix
 * alone is never enough, so 10µF, 100psig, 5mbar stay auditable claims):
 *  - digits glued to a letter or digit on the left (KX450, LC20, F005);
 *  - joined by a code hyphen to a hyphen chain on the left that holds a letter (QR40-16, tag
 *    ZT88120‑4, QUINT-PS-100-240AC) — and, when a unit follows, that chain must also hold a digit,
 *    so "K-20 A" stays a quantity;
 *  - hyphen-joined to letters on the right (3150-QR40, 1489-M);
 *  - glued on the right to an ALL-CAPS code of 3+ letters that starts no unit (75RQT, 20QWB) —
 *    the conservative rule for an unknown suffix: lowercase, mixed case, µ, two letters, or any
 *    token that could begin a unit (PSIG, KVAR) keeps the number a claim;
 *  - a zero-padded integer (0042, 007), or a number after a code word or an all-caps family prefix
 *    (IM 155-6) with no unit after it; a unit word is never a family prefix (RPM 1750, HP 5).
 * A number with a table unit after it (30 A, 24V, 12-volt) is a quantity unless it is glued into a
 * code on the left.
 */
export function identifierAt(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? "";
  if (/[\p{L}\d]/u.test(before)) return true;
  const unit = unitFollows(text, end);
  if (CODE_HYPHEN.test(before)) {
    // The whole hyphen chain on the left (QUINT-PS-100-240AC: "QUINT-PS-100"), not just its last link.
    const run = /(?:[\p{L}\d]+[-\u2010\u2011])*[\p{L}\d]+$/u.exec(text.slice(Math.max(0, start - 60), start - 1))?.[0] ?? "";
    if (/\p{L}/u.test(run) && (!unit || /\d/.test(run))) return true;
  }
  // 1e-3, 1.5E+03: an exponent is part of a number, never a code suffix.
  if (/^[eE][\s*_]*[-+\u2212]?[\s*_]*\d/u.test(text.slice(end, end + 12))) return false;
  if (unit) return false;
  const glued = /^([-\u2010\u2011]?)(\p{L}[\p{L}\d]*)/u.exec(text.slice(end, end + 40));
  if (glued) {
    if (glued[1]) return true; // 1489-M, 3150-QR40
    const letters = /^\p{L}+/u.exec(glued[2])?.[0] ?? "";
    return /^\p{Lu}{3,}$/u.test(letters) && !unitLike(letters);
  }
  // A spaced token after the number that could be a unit (µF, psig, PSIA…) keeps it a claim before
  // any of the weaker rules below can call it a code (#4981 Codex r3 F1 self-audit).
  const next = /^[ \t]+([\p{L}°µ][\p{L}\d]*)/u.exec(text.slice(end, end + 24))?.[1];
  if (next && SPACED_UNIT_LIKE.test(next)) return false;
  const digits = text.slice(start, end);
  if (/^0\d+$/.test(digits)) return true;
  const lead = text.slice(Math.max(0, start - 24), start);
  if (CODE_WORD.test(lead)) return true;
  const caps = CAPS_PREFIX.exec(lead)?.[1];
  return caps !== undefined && !unitLike(caps);
}

/** Lowercase, one dash, one dot, one degree sign, plain spaces; markdown emphasis is spacing. */
function canon(s: string): string {
  return s
    .replace(/[‐-―−]/gu, "-")
    .replace(/[•⋅∙・‧]/gu, "·")
    .replace(/℃/gu, "°C")
    .replace(/℉/gu, "°F")
    .replace(/º/gu, "°")
    .replace(/[*_`]/g, " ")
    .replace(/[\s\p{Zs}]+/gu, " ")
    .toLowerCase();
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the claimed value's literal text appear in any of `texts`? Tokens (numbers, letter runs,
 * single marks) must appear in order with only spacing between them. The match may not start
 * inside a longer number or code (113, 1.13, P13), may not continue into more digits or a
 * decimal (13.5), may not be a negative when the claim is not ("-25 °C"), and a claim ending
 * in a unit may not run into more letters — except an AC/DC mark, so "36 V" is supported by
 * "36 V DC" (the one-way V ⇐ VAC/VDC compatibility supporting-quote.ts already uses).
 */
export function appearsVerbatim(claim: string, texts: readonly string[]): boolean {
  const tokens = canon(claim).trim().match(/\d+(?:\.\d+)?|\p{L}+|[^\s\p{L}\d]/gu) ?? [];
  if (!tokens.some((t) => /\d/.test(t))) return false;
  const last = tokens[tokens.length - 1];
  const signed = tokens[0] === "-";
  const head = `(?<![\\p{L}\\d.])${signed ? "" : "(?<!(?:^|[\\s(])-)"}`;
  const tail = /\p{L}$/u.test(last) ? "(?:\\s?(?:dc|ac))?(?![\\p{L}\\d])" : "(?![\\p{L}\\d]|[.,]\\d)";
  const re = new RegExp(`${head}${tokens.map(escapeRe).join("\\s*")}${tail}`, "u");
  return texts.some((t) => re.test(canon(t)));
}
