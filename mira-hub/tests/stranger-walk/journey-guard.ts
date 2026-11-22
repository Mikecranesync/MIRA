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

/**
 * Whether the run's reservation may be settled down to what was booked. Once the meter lost its
 * bound (usage out of bound or unreadable), booked no longer bounds true spend, so the whole
 * reservation stays counted until reconciled by hand, as the stranger walk does (Codex r2 F1).
 */
export function settlementOf(meter: Pick<BudgetMeter, "unbounded" | "unboundedReason" | "booked" | "turns">, reservedUsd: number): { settle: boolean; note: string } {
  if (meter.unbounded) return { settle: false, note: `NOT settled: meter unbounded at ${meter.unbounded} (${meter.unboundedReason}); the full $${reservedUsd.toFixed(2)} reservation stays counted until reconciled by hand` };
  return { settle: true, note: `settled at $${Math.min(meter.booked, reservedUsd).toFixed(4)} booked over ${meter.turns} turns` };
}

/**
 * The tenant this run's setup token created, read under the token's row lock (the beta-gate
 * provisioner's classifySeededToken). Only that receipt is authority to sweep: an account the token
 * merely signed into is never touched. A read that keeps failing is reported, never read as
 * "no account" (Codex r2 F4).
 */
export async function recoverSetupTenant(classify: () => Promise<string | null>, attempts = 3): Promise<{ tenantId: string | null; error: string | null }> {
  let error: string | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return { tenantId: await classify(), error: null };
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { tenantId: null, error: `setup token receipt unreadable after ${attempts} attempts (${error}); token kept for recovery` };
}

/**
 * After a paid turn the run cancels on purpose (S17), there is no ledger evidence of what it cost:
 * Stop may not have cut the answer off. Unbound the meter, so the whole reservation stays counted
 * until someone reconciles it by hand (Codex r3 F1, Mike chose A 2026-11-22).
 */
export function closeCancelledTurn(meter: Pick<BudgetMeter, "halt">, id: string): void {
  meter.halt(id, "cancelled stream: its cost is not reconciled, so the full reservation stays counted");
}
