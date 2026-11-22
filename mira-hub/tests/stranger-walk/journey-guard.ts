/**
 * Paid-turn admission for the CV-101 / Level-3 journey (cv101-journey.spec.ts). Pure, so the rule
 * is unit-tested on its own: the same per-dispatch check the stranger walk makes (walk.spec.ts),
 * applied to every paid turn the journey sends, including the one it cancels.
 */
import { checkFingerprint, runtimeDrift, type BudgetMeter, type LedgerVerdict, type RuntimeIdentity } from "./staging";

/**
 * The paid turn admitted but not yet reconciled against the ledger, per meter. Every admitted turn
 * is unconfirmed spend until reconcilePaidTurn() verifies it: while one is open no further turn is
 * admitted and the reservation is never settled down. This one rule covers a cancelled turn (S17,
 * Codex r3 F1), a turn whose step threw after Send (r4 F15) and any exit in between.
 */
const openTurn = new WeakMap<object, string>();

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
  const open = openTurn.get(meter);
  if (open) throw new Error(`refused before dispatch: paid turn ${open} was never reconciled`);
  if (!meter.canAfford()) throw new Error(meter.unbounded ? `budget stop: ${meter.unbounded} — ${meter.unboundedReason}` : "budget stop: next turn's worst case would cross the run cap");
  meter.book();
  openTurn.set(meter, id);
}

/** Verify an admitted turn's usage against the ledger (BudgetMeter.verify), then close it. */
export function reconcilePaidTurn(meter: BudgetMeter, id: string, sse: string | null, ledger: LedgerVerdict | undefined): void {
  meter.verify(id, sse, ledger);
  openTurn.delete(meter);
}

/**
 * Whether the run's reservation may be settled down to what was booked. Once the meter lost its
 * bound (usage out of bound or unreadable), booked no longer bounds true spend, so the whole
 * reservation stays counted until reconciled by hand, as the stranger walk does (Codex r2 F1).
 */
export function settlementOf(meter: Pick<BudgetMeter, "unbounded" | "unboundedReason" | "booked" | "turns">, reservedUsd: number): { settle: boolean; note: string } {
  const open = openTurn.get(meter);
  if (open) return { settle: false, note: `NOT settled: paid turn ${open} was sent but never reconciled against the ledger; the full $${reservedUsd.toFixed(2)} reservation stays counted until reconciled by hand` };
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
 * The deployed Hub's own report of its paid lanes, checked against the prices the run books at.
 * The stranger walk tolerates a Hub that serves none (#5045); a paid journey does not: without it
 * nothing proves staging bills at or below the booking, so the run refuses before any reservation
 * (Codex r5 F23). Returns the fingerprint hash for the receipt.
 */
export function requireDeployedPricing(fingerprint: unknown, prices: Record<string, { input: number; output: number }>): string {
  const fp = checkFingerprint(fingerprint, prices);
  if (!fp.available) throw new Error("inference fingerprint: staging serves none, so its pricing cannot be checked — refusing to spend");
  return fp.hash;
}
