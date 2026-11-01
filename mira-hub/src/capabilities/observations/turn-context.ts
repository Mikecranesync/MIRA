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

export type ObservedTurnContext = {
  section: string;
  frame: { stateVersion: string; observationIds: string[] } | null;
};

export async function loadObservedStateForTurn(
  tenantId: string,
  equipmentEntityId: string,
  now: Date,
): Promise<ObservedTurnContext> {
  const observed = deriveObservedState(await listProjectionRows(tenantId, equipmentEntityId), { now });
  const section = renderObservedStateSection(observed);
  return {
    section,
    frame: section ? { stateVersion: observed.stateVersion, observationIds: observed.contributingObservationIds } : null,
  };
}

/**
 * Persisted provenance for a served answer that used observed state. It rides the
 * turn's evidence array so an idempotent replay returns the frame the technician
 * originally got, not a recomputation over rows that may have changed (#5097).
 */
export type ObservedStateEntry = { kind: "observed_state"; stateVersion: string; observationIds: string[] };

export function observedStateEntry(frame: ObservedTurnContext["frame"]): ObservedStateEntry | null {
  return frame ? { kind: "observed_state", stateVersion: frame.stateVersion, observationIds: [...frame.observationIds] } : null;
}

export function isObservedStateEntry(entry: unknown): entry is ObservedStateEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    e.kind === "observed_state" &&
    typeof e.stateVersion === "string" &&
    Array.isArray(e.observationIds) &&
    e.observationIds.every((id) => typeof id === "string")
  );
}
