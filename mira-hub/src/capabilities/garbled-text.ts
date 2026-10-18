/**
 * Garbled-extraction repair (2026-10-17 prod-test TQ-05 / TQ-06, the PLC-5 manual).
 *
 * Some OEM PDFs (the Allen-Bradley PLC-5 manuals among them) embed a font
 * whose glyph codes sit a FIXED 29 code points below ASCII, so pdf.js text
 * extraction hands back every letter shifted: `,QDGGLWLRQ` is `Inaddition`,
 * `WKH` is `the`. The page is "text" to the parser, so it is never treated as
 * scanned, the chunks land in `knowledge_entries` as noise, and BM25 can never
 * match a technician's words against them — two prod-test questions missed on
 * exactly this.
 *
 * Zero-token and reversible: a page is only rewritten when the +29 decode
 * reads MUCH more like English than the original (common-word density), so a
 * normal page, a parts table or a short header is never touched. The decode
 * is one arithmetic map, so a wrong call is auditable from the row's
 * `metadata.text_repair` marker and reversible with `encodeShift29`.
 *
 * Known limitation: the original space (0x20) lands at 0x03 under the shift.
 * pdf.js keeps it as a control char in most builds (we map it back), but if a
 * build drops it, decoded words run together ("Inaddition") — still far more
 * searchable than the cipher, not perfect. OCR is the full repair; see the
 * `NOTEBOOK_GARBLE_OCR_FALLBACK` seam in node-knowledge-ingest.ts.
 */

export const GARBLE_SHIFT = 29;

/** Common English + manual vocabulary, matched as substrings (the shift
 *  often eats the spaces, so word boundaries cannot be relied on). */
const COMMON_WORDS = [
  "the", "and", "for", "with", "that", "this", "from", "not", "are", "you",
  "can", "will", "when", "use", "all", "input", "output", "power", "module",
  "processor", "program", "data", "set", "fault", "error", "table", "bit",
  "word", "file", "address", "install", "connect", "wire", "remove", "replace",
  "battery", "memory", "status", "mode", "voltage", "current", "terminal",
];
const COMMON_WORDS_RE = new RegExp(COMMON_WORDS.join("|"), "gi");

/** Common-word hits per 100 letters. ~0 for cipher text, typically 8–20 for
 *  English prose, 2–6 for dense tables. */
export function englishDensity(text: string): number {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 40) return 0;
  const hits = (text.match(COMMON_WORDS_RE) ?? []).length;
  return (hits * 100) / letters;
}

/** Apply the +29 map. Only codes that land in printable ASCII move; anything
 *  already past the window (lowercase b–z, `{|}~`, non-ASCII) is left alone so
 *  a mixed page cannot be double-shifted. Under the shift the original
 *  space/punctuation/digits (0x20–0x3C) sit in the C0 control range
 *  (0x03–0x1F) — those are mapped back too. Layout whitespace the parser
 *  itself inserts (space, \n, \r, \t) is kept as whitespace: it is not cipher. */
export function decodeShift29(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === "\n" || ch === "\r" || ch === "\t" || c === 0x20) {
      out += ch;
    } else if (c < 0x20 || (c > 0x20 && c + GARBLE_SHIFT <= 0x7e)) {
      out += String.fromCharCode(c + GARBLE_SHIFT);
    } else {
      out += ch;
    }
  }
  return out;
}

/** The inverse map — used by tests to build fixtures from real sentences and
 *  by an operator to reverse a repair that turns out wrong. Whitespace is kept
 *  as whitespace (never encoded into the control range the decoder reads
 *  back), and `=` (whose cipher IS a space) is left alone — so a round trip
 *  is exact for every character except `=`. */
export function encodeShift29(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch === "\n" || ch === "\r" || ch === "\t" || c === 0x20 || c === 0x3d) out += ch;
    else if (c > 0x20 && c <= 0x7e) out += String.fromCharCode(c - GARBLE_SHIFT);
    else out += ch;
  }
  return out;
}

export type GarbleVerdict =
  | { garbled: false; density: number }
  | { garbled: true; method: "shift29"; density: number; decodedDensity: number; decoded: string }
  | { garbled: true; method: "unknown"; density: number; decodedDensity: number };

/** A page is garbled when it reads like nothing (density < 1) — and it is the
 *  fixed shift when the decode reads like English (≥ 3) and at least 4× better. */
const RAW_CEILING = 1.0;
const DECODED_FLOOR = 3.0;
const IMPROVEMENT = 4;

export function detectGarble(text: string): GarbleVerdict {
  const density = englishDensity(text);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 80 || density >= RAW_CEILING) return { garbled: false, density };
  const decoded = decodeShift29(text);
  const decodedDensity = englishDensity(decoded);
  if (decodedDensity >= DECODED_FLOOR && decodedDensity >= density * IMPROVEMENT) {
    return { garbled: true, method: "shift29", density, decodedDensity, decoded };
  }
  // Reads like nothing both ways: not the fixed shift — a different font map
  // or a genuinely image-only page the parser still returned glyphs for.
  // Only flagged when the page is clearly letter-bearing yet wordless.
  if (letters >= 200 && density < 0.3) {
    return { garbled: true, method: "unknown", density, decodedDensity };
  }
  return { garbled: false, density };
}

/**
 * The re-extract plan for rows ALREADY in `knowledge_entries` (the PLC-5
 * manual ingested before this repair existed). Pure: returns only the rows
 * the decoder would rewrite, with their new content. The script that applies
 * it (`scripts/repair-garbled-chunks.ts`) runs only behind
 * NOTEBOOK_GARBLE_REEXTRACT=1 and `--apply`; everything else is a dry run.
 */
export function planChunkRepairs(
  rows: ReadonlyArray<{ id: string; content: string }>,
): Array<{ id: string; content: string; repair: "shift29" | "shift29_partial" }> {
  const out: Array<{ id: string; content: string; repair: "shift29" | "shift29_partial" }> = [];
  for (const row of rows) {
    const verdict = repairExtractedPage(row.content);
    if (verdict.repair !== "shift29") continue;
    // Codex r2 F3: a row the decoder only PARTLY repaired is marked as such, so
    // the backfill can revisit it instead of treating the marker as "done".
    out.push({ id: row.id, content: verdict.text, repair: verdict.unrepaired ? "shift29_partial" : "shift29" });
  }
  return out;
}

export type PageRepair = { text: string; repair: "shift29" | null; unrepaired: boolean };

/**
 * Is this ONE block cipher that decodes to English? Deliberately stricter than
 * the page-level gate: a block is short, so the density signal is noisier, and
 * rewriting a block that was already fine is the one outcome worth preventing.
 *
 * Why these thresholds (measured 2026-10-18 on the test fixtures, which are
 * the real TQ-05/06 PLC-5 page shapes; round-2 review corrected the first):
 *
 * - **Zero lowercase letters — the structural test.** The +29 map sends every
 *   original lowercase letter (0x61–0x7A) to 0x44–0x5D, i.e. uppercase and
 *   `[\]`, and every original uppercase letter into punctuation. A shifted
 *   block therefore contains NO ASCII lowercase at all (the PLC-5 fixture:
 *   81 letters, 0 lowercase), while English prose is ~97% lowercase. This is
 *   the guard that round 2 showed was missing: "Do not connect a power cable
 *   longer than 10 m (32.8 ft)" (36 letters, 35 lowercase) was being
 *   rewritten to "ao not connect ~ power c~ble …", and an English heading
 *   sharing a line with cipher ("Using Relay-Type Instructions ,QDGG…") was
 *   mangled along with it. A few stray lowercase letters are tolerated
 *   (LOWERCASE_CEILING); a block over that is English-bearing and is never
 *   handed to the decoder. Round 3 (Codex round 1): the measurement now runs
 *   on the block MINUS its lowercase-bearing tokens, and the decode itself is
 *   token-by-token (`decodeCipherTokens`), so a mixed heading+cipher LINE is
 *   repaired with the heading byte-identical instead of being left garbled.
 * - **40 letters**, because `englishDensity` returns 0 under 40. The +29 map
 *   preserves letter count for genuine cipher, so a block under 40 letters can
 *   never reach DECODED_FLOOR *as cipher* — the only way a short block ever
 *   decoded was real English whose digits/punctuation became uppercase letters
 *   and lifted the decoded side past 40 (the M172 line: raw 0 → decoded 7.3).
 *   The earlier 24-letter minimum therefore admitted only false positives, and
 *   the comment claiming 24–39-letter blocks "can never be repaired" had it
 *   backwards (round-2 review). Short cipher lines are handled by the
 *   whole-page fallback, which carries the same lowercase guard.
 * - **0.15 digit ratio.** Prose is almost digit-free (the PLC-5 page: 291
 *   letters, 3 digits, ratio 0.01). A parts-table line is the opposite
 *   ("1771-P7 120/220V AC 16A …": 37 letters, 31 digits, ratio 0.456) — and its
 *   decode lands at density 3.0, exactly on DECODED_FLOOR, so the density
 *   gates alone would have rewritten it. 0.15 sits an order of magnitude above
 *   prose and a factor of three below the table; nothing measured is near it.
 * - **3 distinct common words.** A decode that coins one common-word substring
 *   by accident, even repeated, is a coincidence; real prose decodes into
 *   several different ones. Two is not enough — see the boundary test in
 *   `__tests__/garbled-text.test.ts`, which pins that a block decoding to only
 *   `the`/`and` (density 33, every other gate passed) is left alone.
 */
/** Lowercase share above which a block is English-bearing, not cipher. */
const LOWERCASE_CEILING = 0.05;

/** The +29 cipher has no ASCII lowercase (see the threshold notes above). */
function hasEnglishLowercase(text: string, letters: number): boolean {
  const lower = (text.match(/[a-z]/g) ?? []).length;
  return lower / Math.max(letters, 1) > LOWERCASE_CEILING;
}

function blockIsShift29(rawBlock: string): boolean {
  // Judge only the tokens that COULD be cipher. Any token carrying ASCII
  // lowercase is English and is removed before measuring, so an English
  // heading sharing the line ("Using Relay-Type Instructions ,QDGG…") no
  // longer vetoes the cipher beside it — the token-level decoder
  // (`decodeCipherTokens`) is what keeps that heading byte-identical.
  const block = rawBlock.replace(/\S*[a-z]\S*/g, "");
  const letters = (block.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 40) return false;
  if (hasEnglishLowercase(block, letters)) return false;
  // A code/parts table is number-heavy and is NOT prose in any cipher. Deciding
  // per block made this necessary: at page scale the table's own density kept
  // it safe, but one table line in isolation is short enough that a decode can
  // coin a common-word substring by accident. Measured: without this guard the
  // "1771-P7 120/220V AC 16A …" fixture was rewritten.
  const digits = (block.match(/\d/g) ?? []).length;
  if (digits / Math.max(letters + digits, 1) > 0.15) return false;
  const raw = englishDensity(block);
  // "Already reads as English" — but at PROSE density, not the page ceiling.
  // The lowercase guard above is what actually keeps English out of the
  // decoder; this check only backstops it. At the page ceiling (1.0) a single
  // coincidental substring in a genuine cipher block ("closed" → "FORVHG"
  // contains FOR: 82 letters, density 1.22) rejected real cipher — one of the
  // reasons so many PLC-5 chunks stayed garbled (round-2 review).
  if (raw >= DECODED_FLOOR) return false;
  const decodedText = decodeShift29(block);
  const decoded = englishDensity(decodedText);
  if (decoded < DECODED_FLOOR || decoded < raw * IMPROVEMENT) return false;
  // Real prose decodes into SEVERAL different common words, not one repeated
  // coincidence. Three distinct hits is the floor.
  const distinct = new Set((decodedText.toLowerCase().match(COMMON_WORDS_RE) ?? []).map((w) => w.toLowerCase()));
  return distinct.size >= 3;
}

/**
 * Decode ONE block that has already been judged cipher — token by token, so an
 * English token sharing the line is kept byte-identical (Codex round 1 on
 * #4486: "WARNING 120V " + cipher came back as "t^okfkd NOMs …", "Note " as
 * "kote", "Caution " as "`~ution"). A space-delimited token is decoded only
 * when it is structurally cipher and NOT structurally English:
 *
 * - a token with any ASCII lowercase is English (the shift leaves no lowercase);
 * - a token with a C0 control character is cipher (original space / digit /
 *   punctuation — a text extractor never emits one for English);
 * - a token whose decode contains ``^_`{|}~[]\`` was English caps containing
 *   A/B/C or punctuation (`WARNING` → `t^okfkd`, `CAUTION` → `` `^rqflk``), and
 *   a token whose decoded letters have no word shape was English carrying
 *   digits (`120V` → `NOMs`, `1771-P7` → `NTTNJmT`); a cipher token whose
 *   original was capitalised decodes to a clean shape (`3URJUDP` → `Program`);
 * - otherwise it is decoded when it carries a cipher-only character (a C0
 *   control = original space/digit/punctuation, or shifted-uppercase punctuation
 *   like the `,` in `,Q` = `In`), or its decode is a common word (`WKH` = `the`);
 * - any remaining caps-only token is left exactly as extracted and reported as
 *   unresolved. No neighbour rule survives (Codex r2 and r3 on #4486 each broke
 *   one: "RESET SYSTEM" → "obpbq SYSTEM", then "HIGH" → "efde"), so an English
 *   acronym before, after or BETWEEN cipher spans is never mangled; a cipher
 *   word the vocabulary misses is a false negative that marks the page partial.
 *
 * Measured on the probe set: `NOTE`→`klqb` (no vowel), `LED`→`iba`/`VFD`→`sca`
 * (3 letters) and `OK`/`ON`/`NO` are all kept; every token of the PLC-5 fixture
 * decodes.
 */
const DECODE_TELL_RE = /[\^_`{|}~[\]\\]/;
// Codex r4 on #4486: ordinary printable punctuation is NOT encoding evidence —
// "0.5" became "MKR", "-" became "J", "(1)" became "ENF". Only characters that
// English tokens essentially never carry count: the shifted uppercase A–H and
// W–Z ($%&'*+ ;<=) and the shifted x/y/z ([\]), plus any C0 control. Commas,
// periods, hyphens, slashes, colons and parentheses are reached only through
// the vocabulary (",Q" is "In" because "in" is a word, not because of the comma).
const CIPHER_CHAR_RE = /[\x01-\x08\x0b\x0c\x0e-\x1f$%&*+;<=>@[\\\]]/;
const STOPWORDS = new Set([
  "a", "i", "an", "as", "at", "be", "by", "do", "if", "in", "is", "it", "of", "on", "or", "to", "up",
  "we", "no", "so", "its", "has", "was", "may", "off",
]);
/** Token-level vocabulary evidence — SEPARATE from COMMON_WORDS, which also
 *  drives the density thresholds and must not drift. Manual vocabulary a
 *  decoded token is checked against as a whole word. */
// Since Codex r3 on #4486 this list is the ONLY way a caps-only token with no
// cipher character gets decoded (no neighbour rule survives — see
// classifyTokens), so it is deliberately broad: common English plus the
// vocabulary of controller / drive / panel manuals. A word missing here is a
// false negative (left garbled, page marked partial), never a corruption.
const TOKEN_VOCAB = new Set([
  ...COMMON_WORDS,
  ...STOPWORDS,
  // common English
  "about", "above", "across", "add", "added", "again", "against", "allow", "allows", "also", "always", "am",
  "among", "any", "apply", "applied", "around", "available", "back", "because", "become", "been", "begin",
  "being", "below", "between", "both", "but", "cannot", "case", "cause", "causes", "change", "changed", "changes",
  "clear", "cleared", "close", "closed", "come", "complete", "completed", "contains", "could", "defined", "describe",
  "described", "detail", "details", "did", "different", "does", "done", "down", "during", "each", "either",
  "else", "end", "ends", "enter", "entered", "even", "every", "example", "except", "exit", "first", "follow",
  "following", "follows", "found", "function", "functions", "further", "general", "give", "given", "go", "goes",
  "had", "have", "having", "he", "her", "here", "high", "higher", "him", "his", "hold", "how", "however", "if",
  "include", "included", "includes", "into", "its", "just", "keep", "last", "least", "left", "less", "level",
  "like", "limit", "limits", "line", "lines", "low", "lower", "made", "make", "makes", "many", "match", "me",
  "means", "might", "more", "most", "move", "much", "must", "my", "near", "need", "needed", "needs", "never",
  "new", "next", "normal", "normally", "now", "number", "numbers", "occur", "occurs", "once", "one", "only",
  "onto", "open", "opened", "operate", "operates", "operating", "operation", "option", "options", "other",
  "others", "our", "out", "over", "own", "part", "parts", "per", "place", "point", "possible", "present", "press",
  "pressed", "proper", "provide", "provided", "provides", "range", "rate", "read", "reads", "refer", "related",
  "required", "requires", "result", "results", "return", "returns", "right", "run", "running", "runs", "same",
  "see", "select", "selected", "send", "sent", "several", "shall", "should", "show", "shown", "shows", "shut",
  "since", "slow", "some", "specific", "specified", "step", "steps", "still", "stop", "stopped", "stops", "such",
  "sure", "system", "systems", "take", "than", "their", "them", "then", "there", "these", "they", "those",
  "three", "through", "time", "times", "trip", "true", "turn", "turned", "turns", "two", "under", "unit", "units",
  "until", "upper", "used", "user", "using", "usually", "value", "values", "verify", "very", "via", "want", "well",
  "were", "what", "where", "whether", "which", "while", "who", "why", "within", "without", "work", "works",
  "would", "yes", "yet", "your", "zero", "false", "flow", "high", "before", "after", "lists", "list", "listed",
  "inside", "outside", "behind", "beside", "prior", "whenever", "cannot", "already", "another", "away", "toward",
  // controller / drive / panel manuals
  "accessory", "actuator", "adapter", "alarm", "alarms", "analog", "backplane", "baud", "binary", "block", "blocks",
  "board", "bolt", "bolts", "breaker", "bus", "button", "cabinet", "cable", "cables", "card", "cards", "chassis",
  "check", "checks", "circuit", "circuits", "clockwise", "code", "codes", "coil", "coils", "command", "commands",
  "communication", "communications", "component", "components", "condition", "conditions", "configuration",
  "configure", "configured", "connection", "connections", "connector", "contact", "contacts", "contactor",
  "control", "controller", "controllers", "controls", "counter", "counterclockwise", "cover", "cycle", "danger",
  "default", "device", "devices", "diagnostic", "diagnostics", "digital", "disable", "disabled", "disconnect",
  "display", "drive", "drives", "earth", "electrical", "enable", "enabled", "enclosure", "encoder", "energize",
  "energized", "energizes", "ethernet", "fan", "feedback", "field", "figure", "filter", "firmware", "first",
  "frequency", "fuse", "fuses", "gateway", "ground", "grounding", "hardware", "heat", "hertz", "hmi", "indicator",
  "indicators", "inductive", "input", "inputs", "inspect", "inspection", "install", "installation", "installed",
  "instruction", "instructions", "interface", "jumper", "jumpers", "key", "keypad", "ladder", "lamp", "led", "light",
  "lights", "load", "loads", "lockout", "logic", "loop", "machine", "maintenance", "major", "manual", "manuals",
  "menu", "message", "messages", "minor", "module", "modules", "motor", "motors", "mount", "mounted", "mounting",
  "network", "node", "nodes", "note", "notes", "off", "on", "operator", "output", "outputs", "overload", "page",
  "pages", "panel", "panels", "parameter", "parameters", "phase", "plug", "port", "ports", "position", "power",
  "powered", "pressure", "procedure", "procedures", "processor", "program", "programming", "programs", "protocol",
  "pump", "rack", "rail", "register", "registers", "relay", "relays", "remove", "removed", "repair", "replace",
  "replaced", "replacement", "reset", "resistor", "routine", "rung", "rungs", "safety", "scan", "scanned", "scanner",
  "screen", "screw", "screws", "section", "sections", "sensor", "sensors", "serial", "service", "setting",
  "settings", "shield", "shielded", "short", "signal", "signals", "slot", "slots", "software", "speed", "start",
  "started", "starter", "starts", "state", "states", "station", "status", "stores", "stored", "supply", "switch",
  "switches", "table", "tables", "tag", "tags", "temperature", "terminal", "terminals", "test", "tests", "timer",
  "timers", "torque", "transducer", "transformer", "transmitter", "valve", "valves", "variable", "voltage", "warning",
  "wire", "wired", "wires", "wiring", "word", "words",
]);

const C0_RE = /[\x01-\x08\x0b\x0c\x0e-\x1f]/;
/** The letters of a decoded token must have a word shape — ALLCAPS, Capitalised
 *  or lowercase. English carrying digits decodes to a mixed-case non-shape
 *  (`120V` → `NOMs`, `1771-P7` → `NTTNJmT`), while cipher whose original was a
 *  capitalised word decodes cleanly (`3URJUDP` → `Program`, `%$77` → `BATT`). */
const WORD_SHAPE_RE = /^(?:[A-Z]+|[A-Z]?[a-z]+)$/;

function tokenIsEnglish(raw: string): boolean {
  if (/[a-z]/.test(raw)) return true;
  // A plain number or punctuation mark is neutral text, not an unresolved token.
  if (!/[A-Za-z]/.test(raw)) return !letterlessIsCipher(raw);
  if (C0_RE.test(raw)) return false; // a C0 control is never emitted for English
  const decoded = decodeShift29(raw);
  if (DECODE_TELL_RE.test(decoded)) return true;
  return !WORD_SHAPE_RE.test(decoded.replace(/[^A-Za-z]/g, ""));
}

/** A token with no letters: "0.5", "-", "(1)", "P2.04"-less numerics — OR the
 *  cipher of an all-caps word, which shifts entirely into digits/punctuation
 *  ("3/&\x10\x18" is PLC-5, "%$77" is BATT). The two are told apart by what
 *  English never carries: a C0 control, or two of the strong shifted characters.
 *  A lone "$5" stays what it is. */
const STRONG_CIPHER_CHAR_G = /[$%&*+;<=>@[\\\]]/g;
function letterlessIsCipher(raw: string): boolean {
  return C0_RE.test(raw) || (raw.match(STRONG_CIPHER_CHAR_G) ?? []).length >= 2;
}

function tokenIsCipher(raw: string): boolean {
  if (!/[A-Za-z]/.test(raw)) return letterlessIsCipher(raw);
  if (CIPHER_CHAR_RE.test(raw)) return true;
  return TOKEN_VOCAB.has(decodeShift29(raw).toLowerCase().replace(/[^a-z]/g, ""));
}

type TokenVerdict = "english" | "cipher" | "unknown" | "space";

/** Decide every space-delimited token of a block. Exported for the page-level
 *  classifiers; `decodeCipherTokens` is the rewrite built on it. */
export function classifyTokens(block: string): { parts: string[]; verdict: TokenVerdict[] } {
  const parts = block.split(/( +)/);
  // Pass 1: each token on its own evidence.
  const verdict: TokenVerdict[] = parts.map((p, i) => {
    if (i % 2 === 1 || p === "") return "space";
    if (tokenIsEnglish(p)) return "english";
    return tokenIsCipher(p) ? "cipher" : "unknown";
  });
  // There is NO second pass. Codex r2 and r3 on #4486 each showed that any
  // rule promoting an undecided token on its neighbours' evidence — plain
  // adjacency in r2 ("RESET SYSTEM" → "obpbq SYSTEM"), adjacency plus a
  // pronounceability heuristic in r3 ("HIGH" → "efde", LEFT/RIGHT/SHUT/SLOW/
  // FLOW/HOLD/TRIP/LOWER likewise) — corrupts clean uppercase text that sits
  // between cipher spans. A token is decoded only on evidence of its own
  // (cipher characters or a vocabulary decode); everything else stays as
  // extracted and is reported through `unresolved`, so the page is marked
  // partial rather than complete.
  return { parts, verdict };
}

/** Cipher tokens decoded; `unresolved` = tokens with no evidence either way
 *  that sat in a block where cipher WAS decoded — the residue the page-level
 *  `unrepaired` cue and the `shift29_partial` marker report (Codex r3 F3:
 *  judging the rewritten line as one block hid "7XUQ the switch FORFNZLVH"
 *  behind its new lowercase). */
export function decodeCipherTokens(block: string): string {
  return decodeBlockTokens(block).text;
}
function decodeBlockTokens(block: string): { text: string; decoded: boolean; unresolved: boolean } {
  const { parts, verdict } = classifyTokens(block);
  const decoded = verdict.includes("cipher");
  return {
    text: parts.map((p, i) => (verdict[i] === "cipher" ? decodeShift29(p) : p)).join(""),
    decoded,
    unresolved: decoded && verdict.includes("unknown"),
  };
}

/** Does a block look like cipher by TOKEN evidence? No ASCII lowercase, at
 *  least four letters, no token that is structurally English, and at least one
 *  token with positive cipher evidence (a C0 control, shifted punctuation, or a
 *  decode in TOKEN_VOCAB). Codex r2 F3 on #4486: the earlier test demanded a C0
 *  control, so a punctuation-free short line (`,QVWDOO WKH EDWWHU\ ILUVW`,
 *  "Install the battery first") was neither decoded nor counted as unrepaired.
 *  A block of English CAPS ("RESET SYSTEM", "LOTO BEFORE SERVICE") has no
 *  positive evidence, or has an English token, and is never cipher. */
function blockLooksCipher(block: string): boolean {
  const letters = (block.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 4 || hasEnglishLowercase(block, letters)) return false;
  const { verdict } = classifyTokens(block);
  return !verdict.includes("english") && verdict.includes("cipher");
}

/** A block too short for the density gate that is nonetheless the cipher by
 *  token evidence. Codex round 1 on #4486: a long cipher block decoded while
 *  the short one beside it stayed garbled and the page was reported fully
 *  repaired. Used only once the page is known to be cipher. */
function blockIsShortCipher(block: string): boolean {
  const letters = (block.match(/[A-Za-z]/g) ?? []).length;
  if (letters >= 40) return false;
  // Codex r4 F3 on #4486: a short block that SHARES its line with an English
  // prefix ("Note 7XUQ WKH VZLWFK FORFNZLVH") was neither decoded nor counted
  // as unrepaired, because blockLooksCipher rejects any English token. On a
  // page already established as cipher, the English tokens are not a veto:
  // every token is judged on its own, the prefix is kept byte-identical by
  // the token decoder, and any leftover shows up as `unresolved`.
  return classifyTokens(block).verdict.includes("cipher");
}

/**
 * Repair one extracted page, BLOCK BY BLOCK.
 *
 * Review A on #4486: a page whose header is English and whose body is cipher —
 * the actual TQ-05/06 shape — was left entirely garbled, because the header's
 * real words lifted whole-page density above the gate. Deciding per block
 * fixes that, and it also makes the false positive the reviewer feared
 * structurally impossible: a block that already reads as English is never
 * handed to the decoder, so a header can no longer be mangled by its
 * neighbours.
 *
 * Blocks are blank-line separated, falling back to single lines when a page
 * has no blank lines (OEM extractions often don't). Separators are preserved
 * exactly, so an untouched page is byte-identical. `unrepaired` = the page
 * reads as garbled but no block was the fixed shift — the OCR fallback's cue.
 */
export function repairExtractedPage(text: string): PageRepair {
  if (!text.trim()) return { text, repair: null, unrepaired: false };

  // Split while KEEPING the separators, so re-joining is lossless.
  const parts = text.split(/(\n\s*\n|\n)/);
  const isShift = parts.map((part, i) => i % 2 === 0 && blockIsShift29(part));
  let decodedAny = isShift.some(Boolean);
  // Once the page is known to be the cipher (a block proved it, or the page-level
  // verdict did), its SHORT cipher blocks are decoded too — individually, never
  // wholesale, so an English heading on the page is never touched.
  const pageIsCipher = decodedAny || (() => {
    const v = detectGarble(text);
    return v.garbled && v.method === "shift29";
  })();
  // `unrepaired` is judged on what is LEFT after decoding (Codex r2 F3): a
  // decoded block can still hold tokens no evidence reached, and a block that
  // was never decoded can still look like cipher.
  let residualCipher = false;
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a captured separator
    if (isShift[i] || (pageIsCipher && blockIsShortCipher(part))) {
      const out = decodeBlockTokens(part);
      if (out.decoded) decodedAny = true;
      // Residue is tracked per TOKEN during classification, never re-read from
      // the rewritten line (whose new lowercase would hide it — Codex r3 F3).
      if (out.unresolved || blockLooksCipher(out.text)) residualCipher = true;
      return out.text;
    }
    if (blockLooksCipher(part)) residualCipher = true;
    return part;
  });
  if (decodedAny) return { text: out.join(""), repair: "shift29", unrepaired: residualCipher };

  // No block decoded. Fall back to the whole-page verdict so a page that is
  // garbled by some OTHER map still raises the OCR cue.
  const verdict = detectGarble(text);
  if (verdict.garbled && verdict.method === "shift29") {
    // The page-level check agrees but no single block did (short cipher
    // lines) — decode wholesale, but ONLY if the page carries no English of
    // its own: a wholesale decode would mangle any real heading on it
    // (round-2 review). Such a page is left garbled and flagged instead.
    const letters = (text.match(/[A-Za-z]/g) ?? []).length;
    if (!hasEnglishLowercase(text, letters)) {
      return { text: verdict.decoded, repair: "shift29", unrepaired: false };
    }
    return { text, repair: null, unrepaired: true };
  }
  return { text, repair: null, unrepaired: verdict.garbled };
}
