/**
 * The golden set a replay runs: the stranger-walk corpus by default, or another file in the
 * same shape via REPLAY_CORPUS (e.g. real-36.json). A question may carry `acceptablePages`
 * (other pages that state the same answer) and `expectedPage: null` when the manual does not
 * contain the answer — those are excluded from recall and reported separately.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Manual } from "../stranger-walk/score";

export type ReplayQuestion = {
  id: string;
  manual: string;
  question: string;
  expectedPage: number | null;
  acceptablePages?: number[];
  anchor: string;
  safetyRelevant?: boolean;
};
export type ReplayCorpus = { version: number; tolerance: number; manuals: Manual[]; questions: ReplayQuestion[] };

export function loadCorpus(): ReplayCorpus {
  const file = process.env.REPLAY_CORPUS ?? path.resolve(__dirname, "../stranger-walk/corpus.json");
  return JSON.parse(readFileSync(file, "utf8")) as ReplayCorpus;
}
