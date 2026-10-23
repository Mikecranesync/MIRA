/**
 * #4645 defects 2+3 — factory-restore is never a fault-clear answer.
 *
 * Retrieval demotion lives in notebook-query (intent-gated content signature).
 * This module is the #3975-shaped pre-display floor: when the question is a
 * fault-clear (existing `classifyIntent === "fault"`) and the candidate
 * INSTRUCTS a factory-restore / OS-wipe, replace it. Negated mentions are
 * cancelled by the shared `firstUngovernedMatch` layer.
 *
 * Not a question phrase list. Defect 1's restart banner is PR #4652.
 */

import { classifyIntent, isFactoryResetMaterial } from "@/lib/notebook-query";
import { firstUngovernedMatch } from "./hazard-modifiers";

export const FACTORY_RESET_AS_FAULT_REPLACEMENT = `A factory reset or operating-system update is a destructive maintenance action. It deletes project data and license keys on the device. It is not how you clear or acknowledge a fault.

Find and correct the cause first. Use this machine's acknowledge or fault-reset control — not a factory restore. Keep people clear before restarting a stopped machine, and lock out before any hands-in work.`;

/** Reuses the existing industrial intent classifier — no parallel detector. */
export function isFaultResetAsk(question: string): boolean {
  return classifyIntent(question) === "fault";
}

// Content signature of INSTRUCTING a factory-restore / OS-wipe. Clause-initial
// or modal heads, plus coupling a factory-restore to a fault-clear goal.
// Declarative warnings ("A reset to the factory settings also deletes the
// license keys") do not match: they are not verb-initial instructions.
const FACTORY_RESTORE_SRC =
  "factory[\\s-]+(?:reset|settings|defaults?)|" +
  "reset\\b[^.!?]{0,40}\\bfactory(?:\\s+settings)?|" +
  "restore\\b[^.!?]{0,40}\\bfactory(?:\\s+settings)?|" +
  "(?:update|reinstall)\\s+the\\s+operating\\s+system";

const INSTRUCT_HEAD =
  "(?:^|[.!?:;]\\s+|[\u2014\u2013]\\s*|\\n)\\s*(?:[-*\u2022]\\s+|\\d+[.)]\\s+)?" +
  "(?:then\\s+|next\\s+|now\\s+|first\\s+|simply\\s+|just\\s+)?" +
  "(?:you\\s+(?:should|must|need\\s+to|have\\s+to|can|may)\\s+|it\\s+is\\s+(?:best|easiest)\\s+to\\s+)?" +
  "(?:perform|do|run|execute|start|begin|initiate|carry\\s+out|complete|use|apply)?\\s*";

const FACTORY_RESET_INSTRUCTION = new RegExp(
  INSTRUCT_HEAD +
    "(?:" +
    FACTORY_RESTORE_SRC +
    ")\\b" +
    "|\\b(?:" +
    FACTORY_RESTORE_SRC +
    ")\\b[^.!?\\n]{0,60}\\b(?:will|to)\\s+(?:clear|reset|fix|resolve|acknowledge|get\\s+\\w+(?:\\s+\\w+)?\\s+running)\\b" +
    "|\\b(?:to\\s+(?:clear|reset|acknowledge)|to\\s+get\\s+\\w+(?:\\s+\\w+)?\\s+running)\\b[^.!?\\n]{0,60}\\b(?:" +
    FACTORY_RESTORE_SRC +
    ")\\b",
  "im",
);

/**
 * Ungoverned factory-restore instruction in an answer to a fault-clear ask,
 * or null. Detection only — the caller replaces the whole candidate.
 */
export function factoryResetAsFaultClear(question: string, answerText: string): string | null {
  if (!isFaultResetAsk(question)) return null;
  if (!isFactoryResetMaterial(answerText)) return null;
  const instructed = firstUngovernedMatch(FACTORY_RESET_INSTRUCTION, answerText);
  return instructed ? instructed[0].slice(0, 160) : null;
}
