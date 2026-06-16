import type { CurrentValueResult, HistoricalValueResult, VQT } from "@/lib/i3x/types";
import { qualityToI3x } from "@/lib/i3x/quality";

/** MIRA value types as carried on tag_events / live_signal_cache. */
export type MiraValueType = "bool" | "int" | "float" | "string" | "enum";

/**
 * A normalized MIRA reading — the projection input. Built from a
 * live_signal_cache row (current value) or a tag_events row (history).
 * `value` is the canonical stored form (string|null); it is coerced by
 * `valueType` on the way out.
 */
export interface MiraReading {
  value: string | number | boolean | null;
  valueType?: MiraValueType;
  quality: string;
  freshness?: string;
  timestamp: string | Date;
}

/** RFC 3339 UTC string (`...Z`). Accepts a Date or an ISO-ish string. */
function toRfc3339Utc(ts: string | Date): string {
  return new Date(ts).toISOString();
}

/** Coerce the canonical stored value into its typed JS form. */
function coerceValue(value: MiraReading["value"], valueType?: MiraValueType): unknown {
  if (value === null || value === undefined) return null;
  switch (valueType) {
    case "bool":
      if (typeof value === "boolean") return value;
      return String(value).trim().toLowerCase() === "true";
    case "int": {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : String(value);
    }
    case "float": {
      const n = Number(value);
      return Number.isFinite(n) ? n : String(value);
    }
    default:
      return typeof value === "string" ? value : String(value);
  }
}

/** Project one MIRA reading to an i3X VQT triple. */
export function toVQT(reading: MiraReading): VQT {
  const hasValue = reading.value !== null && reading.value !== undefined;
  return {
    value: coerceValue(reading.value, reading.valueType),
    quality: qualityToI3x({
      quality: reading.quality,
      freshness: reading.freshness,
      hasValue,
    }),
    timestamp: toRfc3339Utc(reading.timestamp),
  };
}

/** Project a current reading to a (non-composition) CurrentValueResult. */
export function toCurrentValueResult(reading: MiraReading): CurrentValueResult {
  const vqt = toVQT(reading);
  return {
    isComposition: false,
    value: vqt.value,
    quality: vqt.quality,
    timestamp: vqt.timestamp,
  };
}

/** Project a window of readings to a HistoricalValueResult (ascending by time). */
export function toHistoricalValueResult(readings: MiraReading[]): HistoricalValueResult {
  const values = readings
    .map(toVQT)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { isComposition: false, values };
}
