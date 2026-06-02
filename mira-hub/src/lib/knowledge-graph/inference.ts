// src/lib/knowledge-graph/inference.ts
/**
 * Pure inference of candidate KG edges. No DB, no IO — unit-tested in isolation.
 * Callers (the kg-infer-proposals worker) assign confidence and persist results
 * as relationship_proposals for human review. The industrial analog of
 * Obsidian's "unlinked mentions": connections the system proposes, you confirm.
 */

export interface SameModelInput {
  id: string;
  manufacturer: string | null;
  model: string | null;
}

export interface InferredPair {
  sourceId: string;
  targetId: string;
  key: string; // normalized "manufacturer|model"
}

export interface CoFailEvent {
  equipmentId: string;
  at: number; // epoch seconds
}

export interface CoFailedPair {
  sourceId: string;
  targetId: string;
  count: number; // number of co-occurrence event-pairs (evidence strength)
}

/** Equipment sharing identical (manufacturer, model) → all unordered pairs. */
export function inferSameModelPairs(equipment: SameModelInput[]): InferredPair[] {
  const groups = new Map<string, string[]>();
  for (const e of equipment) {
    const mfr = (e.manufacturer ?? "").trim().toLowerCase();
    const model = (e.model ?? "").trim().toLowerCase();
    if (!mfr || !model) continue;
    const key = `${mfr}|${model}`;
    const arr = groups.get(key) ?? [];
    arr.push(e.id);
    groups.set(key, arr);
  }
  const pairs: InferredPair[] = [];
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        pairs.push({ sourceId: sorted[i], targetId: sorted[j], key });
      }
    }
  }
  return pairs;
}

/** Equipment whose events fall within windowSec of each other → co-failure pairs. */
export function inferCoFailedPairs(events: CoFailEvent[], windowSec: number): CoFailedPair[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const counts = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].at - sorted[i].at > windowSec) break; // sorted → no later j qualifies
      const a = sorted[i].equipmentId;
      const b = sorted[j].equipmentId;
      if (a === b) continue;
      const [s, t] = a < b ? [a, b] : [b, a];
      const k = `${s} ${t}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const pairs: CoFailedPair[] = [];
  for (const [k, count] of counts) {
    const [sourceId, targetId] = k.split(" ");
    pairs.push({ sourceId, targetId, count });
  }
  return pairs;
}
