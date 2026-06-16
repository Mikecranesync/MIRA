/**
 * RFC 5545 ICS generation for PM schedules.
 * No external dependencies — pure string construction.
 */

export interface PMTask {
  id: string;
  title: string;
  asset: string;
  date: string;       // YYYY-MM-DD (all-day event)
  tech: string;
  recur: string;
  durationH: number;
  status: string;
  criticality?: string;
  parts_needed?: string[];
  tools_needed?: string[];
  safety_requirements?: string[];
  source_citation?: string | null;
}

/**
 * Fold long lines to 75 octets per RFC 5545 §3.1.
 * Continuation lines begin with a single space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  // First chunk: 75 chars; continuation chunks: 74 chars (1 leading space)
  chunks.push(line.slice(0, 75));
  let offset = 75;
  while (offset < line.length) {
    chunks.push(" " + line.slice(offset, offset + 74));
    offset += 74;
  }
  return chunks.join("\r\n");
}

/**
 * Escape TEXT-value special characters per RFC 5545 §3.3.11.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Produce a DTSTART/DTEND pair for an all-day event from a YYYY-MM-DD string.
 * All-day events use DATE value type (no time component).
 */
function allDayDate(dateStr: string): { dtstart: string; dtend: string } {
  // Parse the date and build the end date (next day for all-day events)
  const [y, m, d] = dateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d + 1); // next day
  const pad = (n: number) => String(n).padStart(2, "0");
  const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`;
  const startStr = `${y}${pad(m)}${pad(d)}`;
  return {
    dtstart: `DTSTART;VALUE=DATE:${startStr}`,
    dtend: `DTEND;VALUE=DATE:${endStr}`,
  };
}

/**
 * Build a DESCRIPTION string from PM task fields.
 */
function buildDescription(pm: PMTask): string {
  const lines: string[] = [
    `Asset: ${pm.asset}`,
    `Status: ${pm.status}`,
    `Recurrence: ${pm.recur}`,
    `Duration: ${pm.durationH}h`,
    `Technician: ${pm.tech}`,
  ];

  if (pm.criticality) lines.push(`Criticality: ${pm.criticality}`);
  if (pm.parts_needed?.length) lines.push(`Parts needed: ${pm.parts_needed.join(", ")}`);
  if (pm.tools_needed?.length) lines.push(`Tools needed: ${pm.tools_needed.join(", ")}`);
  if (pm.safety_requirements?.length) lines.push(`Safety: ${pm.safety_requirements.join(", ")}`);
  if (pm.source_citation) lines.push(`Manual ref: ${pm.source_citation}`);

  return lines.join("\\n");
}

/**
 * Generate a VEVENT block for a single PM task.
 */
function toVEvent(pm: PMTask, prodId: string): string {
  const { dtstart, dtend } = allDayDate(pm.date);
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const uid = `${pm.id}@${prodId}`;
  const summary = escapeText(pm.title);
  const description = buildDescription(pm);

  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    dtstart,
    dtend,
    foldLine(`SUMMARY:${summary}`),
    foldLine(`DESCRIPTION:${description}`),
    "END:VEVENT",
  ];

  return lines.join("\r\n");
}

/**
 * Convert an array of PM tasks to a complete RFC 5545 VCALENDAR string.
 *
 * @param tasks  Array of PM task objects
 * @param calName  Optional calendar display name (X-WR-CALNAME)
 * @returns  Complete .ics file content as a string
 */
export function buildICS(tasks: PMTask[], calName = "PM Schedule"): string {
  const prodId = "factorylm.com";

  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//FactoryLM//MIRA PM Schedule//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    "X-WR-TIMEZONE:UTC",
  ];

  const events = tasks.map((t) => toVEvent(t, prodId));

  const footer = ["END:VCALENDAR"];

  return [...header, ...events, ...footer].join("\r\n") + "\r\n";
}
