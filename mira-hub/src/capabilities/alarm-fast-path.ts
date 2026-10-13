/**
 * Notebook-chat fast path for the alarm card (spec §8, .claude/rules/fast-path-optimization.md).
 * Read-only, deterministic, claims a turn only for an alarm question about a photo
 * whose stored screen text produces a card; everything else falls through.
 */
import { buildAlarmCard, type AlarmCard } from "./alarm-card";
import { validateAnswer } from "./answer-validation";

const ALARM_INTENT =
  /\b(?:this|these|that|those) (?:alarm|alarms|fault|faults|error|errors)\b|\bwhat does (?:this|that|it) mean\b|\bwhy is (?:this|it) alarming\b|\bwhat(?:'s| is) this (?:fault|error|alarm)\b/i;

export function alarmIntent(question: string, card: AlarmCard): boolean {
  const q = question.trim();
  if (!q) return true;
  if (ALARM_INTENT.test(q)) return true;
  const lower = q.toLowerCase();
  return card.covered.some((l) => l.designations.some((d) => lower.includes(d.raw.toLowerCase())));
}

export function alarmCardForTurn(opts: { question: string; lines: readonly string[] | null }): AlarmCard | null {
  if (!opts.lines || opts.lines.length === 0) return null;
  const card = buildAlarmCard(opts.lines);
  if (!card || !alarmIntent(opts.question, card)) return null;
  const v = validateAnswer({
    answerText: card.text, question: opts.question, general: false, served: true, refused: false, evidenceSufficient: true,
  });
  return v.ok ? card : null;
}

export type AlarmReadingEntry = {
  kind: "alarm_reading";
  fileId: string;
  packIds: string[];
  packVersions: number[];
  records: { text: string; kind: string; designations: string[]; count: number }[];
};

export function alarmReadingEntry(fileId: string, card: AlarmCard): AlarmReadingEntry {
  return {
    kind: "alarm_reading",
    fileId,
    packIds: card.packIds,
    packVersions: card.packVersions,
    records: card.covered.map((l) => ({
      text: l.record.text,
      kind: l.kind,
      designations: l.designations.map((d) => d.raw),
      count: l.record.count,
    })),
  };
}
