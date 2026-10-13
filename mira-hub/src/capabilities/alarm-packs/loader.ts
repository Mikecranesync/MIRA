/**
 * Alarm family packs (spec 2026-10-12-alarm-reasoning-design.md §6). Versioned data,
 * imported at build time (same stance as src/lib/drive-packs/loader.ts) and validated
 * at import: a pack whose text instructs a bypass, reset, reintegration, disabled
 * diagnostic, download, or load resistor never loads. The ban list is the safety
 * boundary — read-only troubleshooting intelligence, no control actions.
 */
import rtdJson from "./rtd.v2.json";
import failSafeOutputJson from "./fail-safe-output.v1.json";

export type PackEntry = {
  key: string;
  means: string;
  hypotheses: [string, string];
  checks: [string, string, string];
  does_not_prove: string[];
};

export type AlarmPack = {
  pack_id: string;
  version: number;
  title: string;
  source: "MIRA engineering reference";
  invalidated_by: string;
  site_procedure_line: string;
  entries: PackEntry[];
  rules?: { shared_cause?: string; consequence?: string };
};

export const SITE_PROCEDURE_LINE =
  "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.";

export const BANNED_PATTERNS: readonly { id: string; rx: RegExp }[] = [
  { id: "bypass", rx: /\bbypass/i },
  { id: "jumper", rx: /\bjumper/i },
  { id: "bridge-out", rx: /\bbridge (?:it )?out\b|\bbridging\b/i },
  { id: "force", rx: /\bforc(?:e|ed|ing)\b/i },
  { id: "override", rx: /\boverrid(?:e|ing)\b/i },
  { id: "substitute", rx: /\bsubstitut/i },
  { id: "simulate", rx: /\bsimulat/i },
  { id: "reset", rx: /\breset/i },
  { id: "clear-alarm", rx: /\bclear (?:the |this )?(?:alarm|fault|error)/i },
  { id: "acknowledge", rx: /\backnowledg/i },
  { id: "reintegrate", rx: /\breintegrat/i },
  { id: "depassivate", rx: /\bde-?passivat/i },
  { id: "ack-rei", rx: /ACK_REI/i },
  { id: "disable-diagnostic", rx: /\b(?:deactivat|disabl|turn(?:ing)? off|switch(?:ing)? off)\w*\s+(?:the\s+)?(?:wire[ -]?break|diagnos)/i },
  { id: "parameterize-off", rx: /\bparameteri[sz]\w*\s+(?:it\s+)?off\b/i },
  { id: "change-config", rx: /\bchang\w*\s+(?:the\s+)?(?:hardware configuration|F-parameter)/i },
  { id: "download", rx: /\bdownload/i },
  { id: "load-resistor", rx: /\b(?:load|dummy|pull-?down)\s+(?:resistor|load)\b|\badd(?:ing)?\s+(?:a\s+)?resistor/i },
  // Safety review 2026-10-12: a test is hands-on work on the circuit (insulation, resistance),
  // and nothing in a pack may describe bringing a passivated or tripped channel back.
  { id: "run-test", rx: /\b(?:perform|run|execute|carry out)\w*\s+(?:an?\s+|the\s+)?(?:\w+\s+)?(?:diagnostics?|tests?)\b/i },
  { id: "restore", rx: /\b(?:restor|reactivat|re-?enabl|enabl|bring(?:ing)?\s+(?:it\s+|them\s+)?back)\w*/i },
];

function fail(code: string, packId: string): never {
  throw new Error(`alarm_pack_invalid:${code}:${packId}`);
}

function packTexts(p: AlarmPack): string[] {
  return [
    p.title,
    ...Object.values(p.rules ?? {}),
    ...p.entries.flatMap((e) => [e.means, ...e.hypotheses, ...e.checks, ...e.does_not_prove]),
  ];
}

export function validatePack(raw: unknown): AlarmPack {
  const p = raw as AlarmPack;
  const id = typeof p?.pack_id === "string" ? p.pack_id : "?";
  if (!p || typeof p.pack_id !== "string" || typeof p.version !== "number") fail("header", id);
  if (p.source !== "MIRA engineering reference") fail("source", id);
  if (p.site_procedure_line !== SITE_PROCEDURE_LINE) fail("site_procedure_line", id);
  if (!Array.isArray(p.entries) || p.entries.length === 0) fail("entries", id);
  const keys = new Set<string>();
  for (const e of p.entries) {
    if (typeof e.key !== "string" || !e.key) fail("key", id);
    if (keys.has(e.key)) fail("duplicate_key", id);
    keys.add(e.key);
    if (typeof e.means !== "string" || !e.means.trim()) fail("means", id);
    if (!Array.isArray(e.hypotheses) || e.hypotheses.length !== 2) fail("hypotheses", id);
    if (!Array.isArray(e.checks) || e.checks.length !== 3) fail("checks", id);
    if (!Array.isArray(e.does_not_prove)) fail("does_not_prove", id);
  }
  for (const text of packTexts(p)) {
    for (const b of BANNED_PATTERNS) {
      if (b.rx.test(text)) throw new Error(`alarm_pack_banned:${b.id}:${id}`);
    }
  }
  return p;
}

export const ALARM_PACKS: readonly AlarmPack[] = [validatePack(rtdJson), validatePack(failSafeOutputJson)];

export function packFor(
  key: string,
  packs: readonly AlarmPack[] = ALARM_PACKS,
): { pack: AlarmPack; entry: PackEntry } | null {
  for (const pack of packs) {
    const entry = pack.entries.find((e) => e.key === key);
    if (entry) return { pack, entry };
  }
  return null;
}
