/**
 * The conversation a saved turn contributes to the next question — ONE rule for
 * the screen (`hub-host-logic.historyRows`, built from the loaded thread) and the
 * server (`bench-components/selection.historyUnderSelection`, built from the saved
 * turns under a selected component, #5504 Codex r2 F2). Two copies of this rule
 * would drift; this is the only one.
 *
 * Each turn gives its question; then its answer, unless the turn ended in a
 * terminal safety stop (the refusal prose stays out of model history), was a
 * provider error, or was stopped mid-answer (an error row that still has text).
 */
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import { isSafetyNoticeEntry, type SafetyNoticeEntry } from "@/lib/notebook-chat-types";

/**
 * A `safety_notice` is terminal unless it is the energized-electrical directive:
 * a directive answer still streams and completes, carrying the sentinel as its
 * trigger; a terminal refusal (input-side hard stop, or an unsafe answer rejected
 * by output validation) carries the matched phrase / violation. Mirroring that
 * rule keeps live and re-hydrated lifecycles identical (Codex #3839 round 2 F1)
 * and keeps refusal prose out of model history (F2).
 */
export function isTerminalSafetyNotice(entry: SafetyNoticeEntry): boolean {
  return entry.trigger !== ENERGIZED_ELECTRICAL_HAZARD;
}

/** Every `safety_notice` entry on a persisted row (a rejected unsafe answer can carry the directive AND the violation). */
export function safetyNoticesOf(evidence: readonly unknown[]): SafetyNoticeEntry[] {
  return evidence.filter(isSafetyNoticeEntry);
}

export function hasTerminalSafetyStop(evidence: readonly unknown[]): boolean {
  return safetyNoticesOf(evidence).some(isTerminalSafetyNotice);
}

/** The fields of a saved turn this rule reads (a `PersistedTurn` has them all). */
export type SavedTurnText = {
  question?: string | null;
  answerStatus?: string | null;
  answerText?: string | null;
  evidence: readonly unknown[];
};

export type HistoryRow = { role: "user" | "assistant"; content: string; status?: "answered" | "insufficient_evidence" | "error"; stopped?: boolean };

export function historyFromSavedTurns(rows: readonly SavedTurnText[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const row of rows) {
    const stopped = row.answerStatus === "error" && !!row.answerText;
    out.push({ role: "user", content: row.question ?? "" });
    if (hasTerminalSafetyStop(row.evidence)) continue;
    if (row.answerText && !stopped && row.answerStatus !== "error") {
      out.push({ role: "assistant", content: row.answerText, status: row.answerStatus as "answered" | "insufficient_evidence" });
    }
  }
  return out;
}
