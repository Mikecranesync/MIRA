import { describe, expect, it } from "vitest";
import { admitPaidTurn, closeCancelledTurn, recoverSetupTenant, settlementOf } from "./journey-guard";
import { BudgetMeter, type RuntimeIdentity } from "./staging";

const start: RuntimeIdentity = { gitSha: "a6e27e244", builtAt: "2026-11-22T13:01:24Z", deploymentGeneration: "gen-1", fingerprintHash: "fp-1" };

describe("admitPaidTurn", () => {
  it("books a turn when staging is unchanged and the budget allows it", () => {
    const m = new BudgetMeter(1, 0.1);
    admitPaidTurn(m, start, { ...start }, "S5");
    expect(m.turns).toBe(1);
    expect(m.booked).toBeCloseTo(0.1);
  });

  it("refuses, books nothing and halts later turns when staging redeployed", () => {
    const m = new BudgetMeter(1, 0.1);
    expect(() => admitPaidTurn(m, start, { ...start, gitSha: "bce2d3548" }, "S5b")).toThrow(/refused before dispatch: .*gitSha/);
    expect(m.turns).toBe(0);
    // the control: an unchanged identity on the next turn is still refused, because the run is halted
    expect(() => admitPaidTurn(m, start, { ...start }, "S6")).toThrow(/budget stop: S5b/);
    expect(m.turns).toBe(0);
  });

  it("refuses when staging's identity cannot be read", () => {
    const m = new BudgetMeter(1, 0.1);
    expect(() => admitPaidTurn(m, start, null, "S5")).toThrow(/refused before dispatch: runtime identity unreadable/);
    expect(m.turns).toBe(0);
  });

  it("refuses a turn whose worst case would cross the cap", () => {
    const m = new BudgetMeter(0.25, 0.1);
    admitPaidTurn(m, start, start, "S5");
    admitPaidTurn(m, start, start, "S5b");
    expect(() => admitPaidTurn(m, start, start, "S6")).toThrow(/budget stop/);
    expect(m.turns).toBe(2);
  });
});

describe("settlementOf", () => {
  it("settles a bounded run at what it booked", () => {
    const m = new BudgetMeter(1, 0.1);
    admitPaidTurn(m, start, start, "S5");
    expect(settlementOf(m, 1)).toMatchObject({ settle: true });
  });
  it("keeps the whole reservation once the meter lost its bound", () => {
    const m = new BudgetMeter(1, 0.1);
    admitPaidTurn(m, start, start, "S5");
    m.halt("S5", "served turn with tokens above the booked bound");
    const s = settlementOf(m, 1);
    expect(s.settle).toBe(false);
    expect(s.note).toMatch(/full \$1\.00 reservation stays counted/);
  });
});

describe("recoverSetupTenant", () => {
  it("returns the tenant the token's own receipt names", async () => {
    expect(await recoverSetupTenant(async () => "t-1")).toEqual({ tenantId: "t-1", error: null });
  });
  it("reports no tenant, without error, when the token created none", async () => {
    expect(await recoverSetupTenant(async () => null)).toEqual({ tenantId: null, error: null });
  });
  it("retries a failed read before giving up", async () => {
    let n = 0;
    expect(await recoverSetupTenant(async () => { if (++n < 3) throw new Error("conn reset"); return "t-2"; })).toEqual({ tenantId: "t-2", error: null });
  });
  it("never reads an unreadable receipt as 'no account'", async () => {
    const r = await recoverSetupTenant(async () => { throw new Error("db down"); });
    expect(r.tenantId).toBeNull();
    expect(r.error).toMatch(/unreadable after 3 attempts \(db down\); token kept/);
  });
});

describe("closeCancelledTurn", () => {
  it("keeps the whole reservation after a deliberately cancelled paid turn", () => {
    const m = new BudgetMeter(1, 0.1);
    admitPaidTurn(m, start, start, "S17");
    expect(settlementOf(m, 1).settle).toBe(true); // precondition: bounded before the cancel
    closeCancelledTurn(m, "S17");
    expect(settlementOf(m, 1)).toMatchObject({ settle: false });
    expect(settlementOf(m, 1).note).toMatch(/S17 \(cancelled stream/);
  });
});
