/**
 * Pure projection of technician observations into a machine's reported state.
 * No I/O: the caller passes the rows (store.ts) and gets back the same answer
 * for the same rows. Human reports are evidence, so every fact carries its
 * author and both timestamps, and asset-level root cause / health / safety
 * are fixed to "not established" here. No rule in this file may set them.
 */
import { createHash } from "node:crypto";
import type { FactKey, FactValue } from "./parse";

export const PROJECTOR_VERSION = "obs-proj-1";
/** Two different reports this close in observed time are contested, not ordered. */
export const CONTEST_WINDOW_MS = 60 * 60 * 1000;

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
  /** Present only when contested: every report on the disputed fact, current included. */
  conflicting: FactEntry[];
};

export type HistoryRow = ObservationRow & { superseded: boolean };

export type ObservedState = {
  projectorVersion: typeof PROJECTOR_VERSION;
  stateVersion: string;
  /** Sorted ids of the rows that shape the state (see stateVersion). */
  contributingObservationIds: string[];
  asOf: string;
  facts: FactState[];
  history: HistoryRow[];
  rootCause: null;
  safeToOperate: "not_established";
  health: "not_established";
};

/** State label per fact. Repairs never imply a healthy machine. */
function stateLabel(factKey: FactKey, factValue: FactValue): string {
  if (factValue === "repaired") return "repair_reported";
  if (factValue === "absent") return `${factKey}_not_observed`;
  return factKey === "seal_leak" ? "leak_reported" : `${factKey}_reported`;
}

function entryOf(r: ObservationRow): FactEntry {
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

export function deriveObservedState(rows: ObservationRow[], opts: { now: Date }): ObservedState {
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
    const windowStart = Date.parse(current.observedAt) - CONTEST_WINDOW_MS;
    const windowEnd = Date.parse(current.observedAt) + CONTEST_WINDOW_MS;
    const opposed = ofKey.filter(
      (r) =>
        r.id !== current.id &&
        r.factValue !== current.factValue &&
        Date.parse(r.observedAt) >= windowStart &&
        Date.parse(r.observedAt) <= windowEnd &&
        r.supersedesId !== current.id &&
        current.supersedesId !== r.id,
    );
    const contested = opposed.length > 0;
    facts.push({
      factKey,
      state: contested ? "contested" : stateLabel(factKey, current.factValue),
      contested,
      current: entryOf(current),
      conflicting: contested ? [current, ...opposed].map(entryOf) : [],
    });
  }

  // Only the rows that shape the state are versioned: a late, non-conflicting,
  // superseded or unrelated row does not change the version.
  const contributing = facts
    .flatMap((f) => (f.contested ? f.conflicting : [f.current]).map((e) => e.observationId))
    .sort();
  const stateVersion = createHash("sha256")
    .update(JSON.stringify([PROJECTOR_VERSION, contributing]))
    .digest("hex");

  return {
    projectorVersion: PROJECTOR_VERSION,
    stateVersion,
    contributingObservationIds: contributing,
    asOf: opts.now.toISOString(),
    facts,
    history,
    rootCause: null,
    safeToOperate: "not_established",
    health: "not_established",
  };
}
