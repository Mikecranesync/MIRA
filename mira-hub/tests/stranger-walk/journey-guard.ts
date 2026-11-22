/**
 * Paid-turn admission for the CV-101 / Level-3 journey (cv101-journey.spec.ts). Pure, so the rule
 * is unit-tested on its own: the same per-dispatch check the stranger walk makes (walk.spec.ts),
 * applied to every paid turn the journey sends, including the one it cancels.
 */
import { runtimeDrift, type BudgetMeter, type RuntimeIdentity } from "./staging";

/**
 * Book one paid turn, or throw before anything is sent. Staging that changed since the run was
 * priced (or whose identity cannot be read) halts the meter, so every later turn is refused too:
 * paid1-tablet sent S5b while a6e27e244 was deploying under it.
 */
export function admitPaidTurn(meter: BudgetMeter, start: RuntimeIdentity, now: RuntimeIdentity | null, id: string): void {
  const drift = runtimeDrift(start, now);
  if (drift) {
    meter.halt(id, drift);
    throw new Error(`refused before dispatch: ${drift}`);
  }
  if (!meter.canAfford()) throw new Error(meter.unbounded ? `budget stop: ${meter.unbounded} — ${meter.unboundedReason}` : "budget stop: next turn's worst case would cross the run cap");
  meter.book();
}
