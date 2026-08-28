// The ONE prompt-injection scrub for machine-memory fields that are
// interpolated into an LLM prompt. Moved verbatim out of
// app/api/assets/[id]/chat/route.ts so the notebook chat route (Sensor S4,
// contract §4.4) renders machine evidence through the SAME sanitizer instead of
// a second copy. Every field is DB-sourced from untrusted ingest (tag names,
// next_check text, window states) — neutralize [Source:]-style forgery and cap
// length so a chatty tag cannot blow the prompt budget.

import { neutralizeReferenceText } from "@/lib/manual-rag";

export const MACHINE_MEMORY_FIELD_MAX_CHARS = 120;

export function sanitizeMachineMemoryField(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const str = typeof value === "string" ? value : String(value);
  return neutralizeReferenceText(str.slice(0, MACHINE_MEMORY_FIELD_MAX_CHARS));
}
