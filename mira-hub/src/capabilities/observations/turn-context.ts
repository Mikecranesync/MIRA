/**
 * The chat route's single read of observed state for one turn: persisted rows
 * for the bound machine → pure projection → prompt section + evidence-frame
 * key. One function so the route and the real-Postgres "later answer" test run
 * the same code path. Throws on storage errors; the route catches and answers
 * without the section.
 */
import { listObservationsForAsset } from "./store";
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
  const observed = deriveObservedState(await listObservationsForAsset(tenantId, equipmentEntityId), { now });
  const section = renderObservedStateSection(observed);
  return {
    section,
    frame: section ? { stateVersion: observed.stateVersion, observationIds: observed.contributingObservationIds } : null,
  };
}
