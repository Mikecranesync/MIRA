import { describe, expect, it } from "vitest";
import { admitPaidTurn } from "./journey-guard";
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
