/**
 * Deterministic preview parser for a technician's observation text.
 * Zero tokens: a regex vocabulary and a time parser, nothing inferred.
 * It proposes a fact the technician must confirm; it never infers a root
 * cause, health, or whether a machine is safe to run.
 */

/** Explicit, small vocabulary. Adding a key is a schema change (migration 113). */
export const FACT_KEYS = ["seal_leak", "abnormal_noise", "vibration", "overheating"] as const;
export type FactKey = (typeof FACT_KEYS)[number];
export const FACT_VALUES = ["present", "absent", "repaired"] as const;
export type FactValue = (typeof FACT_VALUES)[number];

export type ObservationPreview = {
  rawReport: string;
  factKey: FactKey | null;
  factValue: FactValue | null;
  /** ISO instant, or null when the report carries no time. */
  observedAt: string | null;
  needs: Array<"fact_key" | "observed_at">;
};

export type PreviewOptions = {
  /** Reference instant: its calendar date in `timeZone` anchors a bare time. */
  now: Date;
  /** IANA zone the technician's clock is in (the plant's zone). */
  timeZone: string;
};

const FACT_PATTERNS: Record<FactKey, RegExp> = {
  seal_leak: /\bseals?\b|\b(leak|drip|weep)\w*/i,
  abnormal_noise: /\b(noise|noisy|grind\w*|squeal\w*|knock\w*|rattl\w*)\b/i,
  vibration: /\bvibrat\w*|\bshak\w*|\bshudder\w*/i,
  overheating: /\boverheat\w*|\brunning hot\b|\btoo hot\b/i,
};

const REPAIR = /\b(replaced|replacing|repaired|repairing|fixed|rebuilt)\b/i;
const NEGATED = /\b(no|not|none|without|never|dry|isn't|wasn't|aren't)\b/i;

function factValueOf(text: string): FactValue {
  if (REPAIR.test(text)) return "repaired";
  if (NEGATED.test(text)) return "absent";
  return "present";
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Wall-clock time in `timeZone` → UTC instant. The offset is taken at the
 * TARGET wall-clock time (not at `now`), refined once, so a time on a DST
 * boundary day resolves with the offset that applies to that time.
 */
function zonedWallClockToIso(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): string {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString();
}

function calendarDateIn(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * "09:10", "9:10am", "9:10 PM". A bare time is 24-hour; am/pm is 12-hour.
 * Returns null for anything out of range rather than guessing.
 */
function timeOf(text: string): { hh: number; mm: number } | null {
  const match = /\b(\d{1,2}):(\d{2})\s*(am|pm)?(?![\d:])/i.exec(text);
  if (!match) return null;
  let hh = Number(match[1]);
  const mm = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (mm > 59) return null;
  if (meridiem) {
    if (hh < 1 || hh > 12) return null;
    if (meridiem === "am") hh = hh === 12 ? 0 : hh;
    else hh = hh === 12 ? 12 : hh + 12;
  } else if (hh > 23) {
    return null;
  }
  return { hh, mm };
}

/** Pure and deterministic: same text, same `now`, same zone → same preview. */
export function previewObservation(text: string, opts: PreviewOptions): ObservationPreview {
  const rawReport = text.trim();
  const factKey = (FACT_KEYS.find((k) => FACT_PATTERNS[k].test(rawReport)) ?? null) as FactKey | null;
  const factValue = factKey ? factValueOf(rawReport) : null;

  const time = timeOf(rawReport);
  let observedAt: string | null = null;
  if (time) {
    const { y, m, d } = calendarDateIn(opts.now, opts.timeZone);
    observedAt = zonedWallClockToIso(y, m, d, time.hh, time.mm, opts.timeZone);
  }

  const needs: ObservationPreview["needs"] = [];
  if (!factKey) needs.push("fact_key");
  if (!observedAt) needs.push("observed_at");
  return { rawReport, factKey, factValue, observedAt, needs };
}
