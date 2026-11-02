/**
 * The chat route's single read of observed state for one turn: the bounded
 * projection rows for the bound machine (no raw reports, no full history, #5098)
 * → pure projection → prompt section + evidence-frame key. One function so the route and the real-Postgres "later answer" test run
 * the same code path. Throws on storage errors; the route catches and answers
 * without the section.
 */
import { listProjectionRows } from "./store";
import { deriveObservedState } from "./project";
import { renderObservedStateSection } from "./context";

/** stateVersion covers every contributor; observationIds are the ones the prompt listed
 *  (bounded, #5106); contributorCount says how many exist in all. */
export type ObservedStateFrame = { stateVersion: string; observationIds: string[]; contributorCount: number };

export type ObservedTurnContext = {
  section: string;
  frame: ObservedStateFrame | null;
};

export async function loadObservedStateForTurn(
  tenantId: string,
  equipmentEntityId: string,
  now: Date,
): Promise<ObservedTurnContext> {
  const { rows, contests } = await listProjectionRows(tenantId, equipmentEntityId);
  const observed = deriveObservedState(rows, { now, contests });
  const section = renderObservedStateSection(observed);
  return {
    section,
    frame: section
      ? { stateVersion: observed.stateVersion, observationIds: observed.shownObservationIds, contributorCount: observed.contributorCount }
      : null,
  };
}

/**
 * Persisted provenance for a served answer that used observed state. It rides the
 * turn's evidence array so an idempotent replay returns the frame the technician
 * originally got, not a recomputation over rows that may have changed (#5097).
 */
export type ObservedStateEntry = { kind: "observed_state" } & ObservedStateFrame;

export function observedStateEntry(frame: ObservedTurnContext["frame"]): ObservedStateEntry | null {
  return frame
    ? { kind: "observed_state", stateVersion: frame.stateVersion, observationIds: [...frame.observationIds], contributorCount: frame.contributorCount }
    : null;
}

/** The frame a replay re-sends, exactly as persisted. */
export function observedStateFrameOf(entry: ObservedStateEntry): ObservedStateFrame {
  return { stateVersion: entry.stateVersion, observationIds: entry.observationIds, contributorCount: entry.contributorCount };
}

export function isObservedStateEntry(entry: unknown): entry is ObservedStateEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    e.kind === "observed_state" &&
    typeof e.stateVersion === "string" &&
    Array.isArray(e.observationIds) &&
    e.observationIds.every((id) => typeof id === "string") &&
    Number.isInteger(e.contributorCount)
  );
}
