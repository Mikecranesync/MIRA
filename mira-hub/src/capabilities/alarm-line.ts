/**
 * Alarm-list reading, deterministic (spec docs/superpowers/specs/2026-10-12-alarm-reasoning-design.md §5).
 * Input: the verbatim visual lines LOOK transcribed from an HMI alarm screen.
 * Output: alarm records (wrapped lines joined, duplicates collapsed) and the parsed
 * fields a pack is keyed on. No model, no network, no I/O. Never "corrects" a misread,
 * never completes a cut-off field.
 */

export type Field = { text: string; truncated: boolean };

export type AlarmRecord = {
  lines: string[];
  number: string | null;
  time: Field | null;
  date: Field | null;
  status: string | null;
  text: string;
  count: number;
};

export type Designation = {
  raw: string;
  track: string;
  func: string;
  location: string | null;
  device: string | null;
};

export type AlarmKind =
  | "measurement_limit" | "switch_trip" | "resistance_test" | "io_diagnostic"
  | "safety_passivation" | "state" | "unknown";

export type AlarmLine = {
  record: AlarmRecord;
  designations: Designation[];
  kind: AlarmKind;
  diagnostic: "wire_break" | "overrange" | "underrange" | null;
  channel: { io: "input" | "output"; number: number } | null;
  fGroup: string | null;
  fAddress: Field | null;
  quantity: "temperature" | "resistance" | "voltage" | "current" | "pressure" | null;
  subject: string | null;
  direction: "high" | "low" | null;
  value:
    | { shown: true; number: number; unit: string | null }
    | { shown: false; reason: "not_displayed" | "zero_and_zero_limit" | "unreadable" | "truncated" | "unrecognized" };
  limit: { number: number; unit: string | null } | null;
};

const CUT = "(?:…|\\.\\.\\.)";
const TRUNCATED = new RegExp(`${CUT}$`);
const STATUS = "IAO|IOA|IA|IO|IQ|KGQ|KQG|KG|KQ|I|O|A|Q|K|G";
const ROW_PREFIX = new RegExp(
  `^(?:(\\d{1,6})\\s+)?(\\d{1,2}:\\d{2}(?::\\d{0,2})?${CUT}?)\\s+` +
    `(?:(\\d{1,4}[./-]\\d{1,2}[./-]\\d{0,4}${CUT}?)\\s+)?` +
    `(?:(${STATUS})\\s+)?(.*)$`,
);
const MESSAGE_START = /^(?:error|warning|fault|alarm|fehler|warnung|störung)\s*:/i;
const FULL_TIME = /^(\d{1,2}):(\d{2}):(\d{2})$/;
const UNIT = "(°C|°F|Ω|ohm|%|mA|V|A|bar)";

const RX = {
  wireBreak: /\bwire[ -]?break\b|drahtbruch/i,
  overrange: /\boverrange\b|\boverflow\b|überlauf/i,
  underrange: /\bunderrange\b|\bunderflow\b|unterlauf/i,
  passivated: /\bpassivat(?:ed|ion)\b|passiviert/i,
  channel: /\b(output|input)\s+channel\s+(\d{1,3})\b/i,
  fGroup: /\bF-runtime group\s+(\d{1,3})\b/i,
  fAddress: /\bstart address of the F-I\/O:\s*(\S+)/i,
  temperature: /\btemperature\b|temperaturmessung|\btemperatur\b/i,
  resistance: /\bresistance measurement\b|widerstandsmessung/i,
  resistanceTest: /\bresistance test\b/i,
  high: /\btoo high\b|\bzu hoch\b/i,
  low: /\btoo low\b|\bzu niedrig\b/i,
  tripped: /\btripped\b|ausgelöst/i,
  subject: /measurement\s+(.+?)\s+(?:too high|too low)/i,
  value: new RegExp(`\\b(?:value|actual|istwert)\\s*[:=]?\\s*(-?[\\d?]+(?:[.,][\\d?]+)?)(…|\\.\\.\\.)?\\s*${UNIT}?(?![A-Za-z])`, "i"),
  limit: new RegExp(`\\b(?:limit|grenzwert|setpoint)\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*${UNIT}?(?![A-Za-z])`, "i"),
};

const DESIGNATION = /(=[0-9A-Za-z?]{1,3}\.)([A-Za-z?][A-Za-z0-9?]*)(\+[A-Za-z0-9?]+)?(-[A-Za-z0-9?]+(?:[.-][A-Za-z0-9?]+)*)?/g;

function field(raw: string): Field {
  const text = raw.trim();
  return { text, truncated: TRUNCATED.test(text) };
}

function clean(raw: string): string {
  return raw.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function timeSeconds(text: string): number | null {
  const m = FULL_TIME.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** `collapse: false` keeps every listed row (the fidelity scorer compares raw record boundaries). */
export function groupAlarmRecords(lines: readonly string[], opts: { collapse?: boolean } = {}): AlarmRecord[] {
  const records: AlarmRecord[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    const row = ROW_PREFIX.exec(line);
    if (row) {
      records.push({
        lines: [line],
        number: row[1] ?? null,
        time: field(row[2]),
        date: row[3] ? field(row[3]) : null,
        status: row[4] ?? null,
        text: row[5].trim(),
        count: 1,
      });
      continue;
    }
    if (MESSAGE_START.test(line)) {
      records.push({ lines: [line], number: null, time: null, date: null, status: null, text: line, count: 1 });
      continue;
    }
    const current = records[records.length - 1];
    if (!current) continue; // column headers and noise before the first record
    current.lines.push(line);
    current.text = current.text ? `${current.text} ${line}` : line;
  }
  return opts.collapse === false ? records : collapseDuplicates(records);
}

function collapseDuplicates(records: AlarmRecord[]): AlarmRecord[] {
  const seen = new Map<string, AlarmRecord>();
  const out: AlarmRecord[] = [];
  for (const r of records) {
    // The date is part of the identity: the same alarm on another day is another event.
    const key = `${r.number ?? ""}\u0000${r.date?.text ?? ""}\u0000${r.text}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, r);
      out.push(r);
      continue;
    }
    first.count += 1;
    // Keep the earliest full time on the same date so first-out can still use it.
    const a = first.time ? timeSeconds(first.time.text) : null;
    const b = r.time ? timeSeconds(r.time.text) : null;
    if (a !== null && b !== null && b < a && first.date?.text === r.date?.text) first.time = r.time;
  }
  return out;
}

export function parseDesignations(text: string): Designation[] {
  const out: Designation[] = [];
  for (const m of text.matchAll(DESIGNATION)) {
    const location = m[3] ?? null;
    const device = m[4] ?? null;
    if (!location && !device) continue;
    out.push({ raw: m[0], track: m[1], func: m[2], location, device });
  }
  return out;
}

function num(s: string): number {
  return Number(s.replace(",", "."));
}

function parseLimit(t: string): AlarmLine["limit"] {
  const m = RX.limit.exec(t);
  return m ? { number: num(m[1]), unit: m[2] ?? null } : null;
}

// A number with a unit (the degree sign may arrive garbled as "Â°"), or a limit word, means a
// reading IS on the line even in a form RX.value does not parse.
const READING_ON_LINE = /-?\d+(?:[.,]\d+)?\s*Â?(?:°C|°F|Ω|ohm)(?![A-Za-z])|\b(?:limit|grenzwert)\b/i;

function parseValue(t: string): AlarmLine["value"] {
  const m = RX.value.exec(t);
  if (!m) return { shown: false, reason: READING_ON_LINE.test(t) ? "unrecognized" : "not_displayed" };
  if (m[2]) return { shown: false, reason: "truncated" };
  if (m[1].includes("?")) return { shown: false, reason: "unreadable" };
  const n = num(m[1]);
  const limit = parseLimit(t);
  if (n === 0 && (limit === null || limit.number === 0)) return { shown: false, reason: "zero_and_zero_limit" };
  return { shown: true, number: n, unit: m[3] ?? null };
}

export function parseAlarmRecord(record: AlarmRecord): AlarmLine | null {
  const t = record.text;
  const designations = parseDesignations(t).sort((a, b) => (b.device?.length ?? 0) - (a.device?.length ?? 0));
  const ch = RX.channel.exec(t);
  const channel = ch
    ? { io: (ch[1].toLowerCase() === "output" ? "output" : "input") as "input" | "output", number: Number(ch[2]) }
    : null;
  const fGroup = RX.fGroup.exec(t)?.[1] ?? null;
  const fa = RX.fAddress.exec(t);
  const fAddress = fa ? field(fa[1]) : null;
  const direction: AlarmLine["direction"] = RX.high.test(t) ? "high" : RX.low.test(t) ? "low" : null;

  let kind: AlarmKind = "unknown";
  let diagnostic: AlarmLine["diagnostic"] = null;
  let quantity: AlarmLine["quantity"] = null;
  if (RX.passivated.test(t)) kind = "safety_passivation";
  else if (RX.wireBreak.test(t)) { kind = "io_diagnostic"; diagnostic = "wire_break"; }
  else if (RX.overrange.test(t)) { kind = "io_diagnostic"; diagnostic = "overrange"; }
  else if (RX.underrange.test(t)) { kind = "io_diagnostic"; diagnostic = "underrange"; }
  else if (direction && RX.temperature.test(t)) { kind = "measurement_limit"; quantity = "temperature"; }
  else if (direction && RX.resistance.test(t)) { kind = "measurement_limit"; quantity = "resistance"; }
  else if (RX.resistanceTest.test(t)) { kind = "resistance_test"; quantity = "resistance"; }
  else if (RX.tripped.test(t)) kind = "switch_trip";
  if (kind === "unknown") return null;

  const identified = designations.length > 0 || (kind === "safety_passivation" && (fGroup !== null || fAddress !== null));
  if (!identified) return null;

  const isMeasurement = kind === "measurement_limit";
  return {
    record,
    designations,
    kind,
    diagnostic,
    channel,
    fGroup,
    fAddress,
    quantity,
    subject: isMeasurement ? RX.subject.exec(t)?.[1]?.trim() ?? null : null,
    direction: isMeasurement ? direction : null,
    value: parseValue(t),
    limit: parseLimit(t),
  };
}
