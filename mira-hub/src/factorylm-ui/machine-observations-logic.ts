/**
 * Pure helpers for the Machine state panel (MachineObservations.tsx): retry-safe
 * request ids, refusal copy and labels. No React, no fetch, so it unit-tests in
 * the hub's node vitest environment.
 */
import type { ObservationPreview as ServerPreview } from "@/capabilities/observations/parse";
import type { FactEntry, FactState, HistoryRow, ObservedStateSummary } from "@/capabilities/observations/project";

/** What the technician is reviewing: the server preview, possibly corrected. */
export type ObservationPreview = ServerPreview;
/** GET observations: the state, one page of history, and (on a save readback) the saved row. */
export type ObservedStateView = {
  equipmentEntityId: string;
  state: ObservedStateSummary;
  history: HistoryRow[];
  nextCursor: string | null;
  observation?: HistoryRow | null;
  /** Present when asked for with ?conflicts=<factKey>: one page of that fact's opposing reports. */
  conflicts?: { factKey: string; rows: FactEntry[]; nextCursor: string | null };
};
export type { FactEntry, FactState };

const FACT_LABELS: Record<string, string> = {
  seal_leak: "Seal leak",
  abnormal_noise: "Abnormal noise",
  vibration: "Vibration",
  overheating: "Overheating",
};

const STATE_LABELS: Record<string, string> = {
  present: "reported",
  absent: "not seen",
  repaired: "repair reported",
};

/** "Seal leak — reported", "Seal leak — repair reported", or contested. */
export function factLine(fact: FactState): string {
  const name = FACT_LABELS[fact.factKey] ?? fact.factKey;
  if (fact.contested) return `${name} — contested: technician reports disagree`;
  return `${name} — ${STATE_LABELS[fact.current.factValue] ?? fact.current.factValue}`;
}

/** "Showing 20 of 135 reports" when a contested fact lists only some of them, else null. */
export function conflictCountLine(shown: number, total: number): string | null {
  return total > shown ? `Showing ${shown} of ${total} reports` : null;
}

function contentKey(p: ObservationPreview): string {
  return JSON.stringify([p.factKey, p.factValue, p.observedAt, p.rawReport]);
}

/**
 * One request id per observation the technician is confirming. A retry of the
 * SAME content (after a timeout, a lost reply or an unconfirmed readback) reuses
 * the id, so the server returns the stored row instead of a duplicate. Changing
 * any field is a new observation and gets a new id. `settle` forgets the id
 * once the server answered definitively.
 */
export function createObservationRequestIds(newId: () => string = () => crypto.randomUUID()) {
  const ids = new Map<string, string>();
  return {
    idFor(p: ObservationPreview): string {
      const key = contentKey(p);
      let id = ids.get(key);
      if (!id) {
        id = newId();
        ids.set(key, id);
      }
      return id;
    },
    settle(p: ObservationPreview): void {
      ids.delete(contentKey(p));
    },
  };
}

/** Plain sentence for a refused save; the server's own message wins when present. */
export function observationSaveMessage(error: string | undefined, message: string | undefined): string {
  if (message) return message;
  switch (error) {
    case "asset_not_confirmed":
      return "Confirm which machine this is before reporting an observation.";
    case "asset_not_bound":
      return "Pick the machine for this notebook before reporting an observation.";
    case "observed_at_in_future":
      return "The observed time is in the future. Correct it and confirm again.";
    case "request_id_conflict":
      return "That save was already used for a different report. Edit the report and confirm again.";
    case "observations_unavailable":
      return "Machine state is unavailable right now. Try again later.";
    default:
      return "The observation was not saved. Retry — it will not create a duplicate.";
  }
}
