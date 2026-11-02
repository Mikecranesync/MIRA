/**
 * Pure projection of technician observations into a machine's reported state.
 * No I/O: the caller passes the rows (store.ts) and gets back the same answer
 * for the same rows. Human reports are evidence, so every fact carries its
 * author and both timestamps, and asset-level root cause / health / safety
 * are fixed to "not established" here. No rule in this file may set them.
 */
import { createHash } from "node:crypto";
import type { FactKey, FactValue } from "./parse";

export const PROJECTOR_VERSION = "obs-proj-4";
/** Two different reports this close in observed time are contested, not ordered. */
export const CONTEST_WINDOW_MS = 60 * 60 * 1000;
/** Most reports a contested fact lists (the current one first, then the newest opposing).
 *  The rest are counted exactly and paged, never dropped (#5106). */
export const CONFLICTS_SHOWN = 20;

export type ObservationRow = {
  id: string;
  factKey: FactKey;
  factValue: FactValue;
  /** ISO instant the technician said it was observed. */
  observedAt: string;
  /** ISO instant the row was written. */
  recordedAt: string;
  recordedBy: string | null;
  verificationMethod: string;
  uncertainty: string;
  supersedesId: string | null;
};

export type FactEntry = {
  observationId: string;
  factValue: FactValue;
  source: "technician";
  author: string | null;
  observedAt: string;
  recordedAt: string;
  verificationMethod: string;
  uncertainty: string;
};

export type FactState = {
  factKey: FactKey;
  state: string;
  contested: boolean;
  current: FactEntry;
  /** Present only when contested: the current report, then the newest opposing reports,
   *  at most CONFLICTS_SHOWN in all (projector order). */
  conflicting: FactEntry[];
  /** Every report in the dispute, current included; 0 when not contested. Exact, never capped. */
  conflictTotal: number;
  /** Opposing reports not listed continue after this id (GET ?conflicts=<factKey>&conflictCursor=); null when all are listed. */
  conflictsNextCursor: string | null;
  /** sha256 of this fact's sorted contributor ids: the current report, plus every opposing one when contested. */
  contributorDigest: string;
};

/** What the store computed in SQL over the full opposing set of one fact (#5106). */
export type ContestSummary = { opposingTotal: number; contributorDigest: string };

export type HistoryRow = ObservationRow & { superseded: boolean };

export type ObservedState = {
  projectorVersion: typeof PROJECTOR_VERSION;
  stateVersion: string;
  /** How many reports shape the state (see stateVersion), listed or not. */
  contributorCount: number;
  /** Sorted ids of the reports the facts list: what a reader of this state actually sees. */
  shownObservationIds: string[];
  asOf: string;
  facts: FactState[];
  history: HistoryRow[];
  rootCause: null;
  safeToOperate: "not_established";
  health: "not_established";
};

/** What the GET route serves as `state`: the history comes separately, in pages (#5098). */
export type ObservedStateSummary = Omit<ObservedState, "history">;

export function summaryOf(state: ObservedState): ObservedStateSummary {
  const { history: _history, ...summary } = state;
  void _history;
  return summary;
}

/**
 * Only "present" and "absent" contradict each other. "repaired" after "present"
 * is a fault-then-repair sequence, and "present" after "repaired" is a recurrence:
 * both are ordinary history, not a disagreement (#5092). obs-proj-2; obs-proj-3
 * adds the repair boundary in deriveObservedState.
 */
function contradicts(a: FactValue, b: FactValue): boolean {
  return (a === "present" && b === "absent") || (a === "absent" && b === "present");
}

function stateLabel(factKey: FactKey, factValue: FactValue): string {
  if (factValue === "repaired") return "repair_reported";
  if (factValue === "absent") return `${factKey}_not_observed`;
  return factKey === "seal_leak" ? "leak_reported" : `${factKey}_reported`;
}

export function entryOf(r: ObservationRow): FactEntry {
  return {
    observationId: r.id,
    factValue: r.factValue,
    source: "technician",
    author: r.recordedBy,
    observedAt: r.observedAt,
    recordedAt: r.recordedAt,
    verificationMethod: r.verificationMethod,
    uncertainty: r.uncertainty,
  };
}

/** Newest observed first; ties broken by recorded time, then id, so the order is total. */
function newestFirst(a: ObservationRow, b: ObservationRow): number {
  if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? 1 : -1;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** sha256 of sorted ids joined by commas; store.ts computes the same in SQL (COLLATE "C"). */
export function contributorDigestOf(ids: string[]): string {
  return createHash("sha256").update([...ids].sort().join(",")).digest("hex");
}

/**
 * `contests` carries what the store counted in SQL over a fact's whole opposing set when
 * `rows` holds only the newest of them. Without it the rows are taken as complete.
 */
export function deriveObservedState(
  rows: ObservationRow[],
  opts: { now: Date; contests?: Partial<Record<FactKey, ContestSummary>> },
): ObservedState {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => id !== null));
  const history: HistoryRow[] = [...rows]
    .sort(newestFirst)
    .map((r) => ({ ...r, superseded: superseded.has(r.id) }));

  const active = history.filter((r) => !r.superseded);
  const keys = [...new Set(active.map((r) => r.factKey))].sort();

  const facts: FactState[] = [];
  for (const factKey of keys) {
    const ofKey = active.filter((r) => r.factKey === factKey); // already newest-first
    const current = ofKey[0]!;
    // A repair is an epoch boundary: reports observed before the newest repair (at or
    // before the current report) describe the machine before the work and cannot
    // contest what was seen after it. They stay in history (#5091 Codex r2 F1).
    const boundary = ofKey.find((r) => r.id !== current.id && r.factValue === "repaired");
    const epochStart = boundary ? Date.parse(boundary.observedAt) : Number.NEGATIVE_INFINITY;
    const windowStart = Math.max(Date.parse(current.observedAt) - CONTEST_WINDOW_MS, epochStart);
    const windowEnd = Date.parse(current.observedAt) + CONTEST_WINDOW_MS;
    const opposed = ofKey.filter(
      (r) =>
        r.id !== current.id &&
        contradicts(r.factValue, current.factValue) &&
        Date.parse(r.observedAt) >= windowStart &&
        Date.parse(r.observedAt) <= windowEnd &&
        r.supersedesId !== current.id &&
        current.supersedesId !== r.id,
    );
    const summary = opts.contests?.[factKey] ?? {
      opposingTotal: opposed.length,
      contributorDigest: contributorDigestOf([current.id, ...opposed.map((r) => r.id)]),
    };
    const contested = summary.opposingTotal > 0;
    const conflicting = contested ? [current, ...opposed].slice(0, CONFLICTS_SHOWN).map(entryOf) : [];
    const conflictTotal = contested ? summary.opposingTotal + 1 : 0;
    facts.push({
      factKey,
      state: contested ? "contested" : stateLabel(factKey, current.factValue),
      contested,
      current: entryOf(current),
      conflicting,
      conflictTotal,
      conflictsNextCursor: conflictTotal > conflicting.length ? conflicting[conflicting.length - 1]!.observationId : null,
      contributorDigest: summary.contributorDigest,
    });
  }

  // Only the rows that shape the state are versioned: a late, non-conflicting,
  // superseded or unrelated row does not change the version. Each fact's digest covers
  // every contributor, listed or not, so a hidden opposing report still moves it.
  const stateVersion = createHash("sha256")
    .update(JSON.stringify([PROJECTOR_VERSION, facts.map((f) => [f.factKey, f.contributorDigest])]))
    .digest("hex");

  return {
    projectorVersion: PROJECTOR_VERSION,
    stateVersion,
    contributorCount: facts.reduce((n, f) => n + (f.contested ? f.conflictTotal : 1), 0),
    shownObservationIds: facts.flatMap((f) => (f.contested ? f.conflicting : [f.current]).map((e) => e.observationId)).sort(),
    asOf: opts.now.toISOString(),
    facts,
    history,
    rootCause: null,
    safeToOperate: "not_established",
    health: "not_established",
  };
}
