/**
 * Pure-logic tests for Connector Commissioning aggregation. Framework-only
 * (vitest); no DB / network — the function is pure over injected signals.
 */
import { expect, test, describe } from "vitest";
import {
  buildCommissioningStatus,
  type CommissioningSignals,
} from "./commissioning";

/** A fully-ready connector; override fields per test. */
function signals(over: Partial<CommissioningSignals> = {}): CommissioningSignals {
  return {
    gatewayCount: 1,
    onlineGatewayCount: 1,
    boundEquipmentCount: 1,
    resolvableUnsCount: 1,
    approvedTagCount: 41,
    displayCount: 1,
    reachableDisplayCount: 1,
    freshness: { live: 5, stale: 0, simulated: 0 },
    ...over,
  };
}

const stateOf = (s: ReturnType<typeof buildCommissioningStatus>, key: string) =>
  s.checklist.find((i) => i.key === key)?.state;

describe("buildCommissioningStatus — ready path", () => {
  test("claimed + online + live data → ready, all core items ok", () => {
    const s = buildCommissioningStatus(signals());
    expect(s.ready).toBe(true);
    expect(stateOf(s, "claimed")).toBe("ok");
    expect(stateOf(s, "online")).toBe("ok");
    expect(stateOf(s, "liveData")).toBe("ok");
    expect(stateOf(s, "askMira")).toBe("ok");
    expect(s.nextAction).toMatch(/ready/i);
  });

  test("ready does not require display reachability (secondary)", () => {
    const s = buildCommissioningStatus(signals({ displayCount: 0, reachableDisplayCount: 0 }));
    expect(s.ready).toBe(true); // still ready
    expect(stateOf(s, "display")).toBe("missing");
    expect(s.nextAction).toMatch(/optionally register/i);
  });
});

describe("buildCommissioningStatus — missing live data", () => {
  test("stale-only → not ready, liveData warn, action mentions stale", () => {
    const s = buildCommissioningStatus(signals({ freshness: { live: 0, stale: 4, simulated: 0 } }));
    expect(s.ready).toBe(false);
    expect(stateOf(s, "liveData")).toBe("warn");
    expect(s.nextAction).toMatch(/stale|simulated/i);
  });

  test("no data at all → not ready, liveData missing, action says start the stream", () => {
    const s = buildCommissioningStatus(signals({ freshness: { live: 0, stale: 0, simulated: 0 } }));
    expect(s.ready).toBe(false);
    expect(stateOf(s, "liveData")).toBe("missing");
    expect(s.nextAction).toMatch(/no live data|start the gateway/i);
  });

  test("simulated-only → not ready, liveData warn", () => {
    const s = buildCommissioningStatus(signals({ freshness: { live: 0, stale: 0, simulated: 7 } }));
    expect(s.ready).toBe(false);
    expect(stateOf(s, "liveData")).toBe("warn");
  });
});

describe("buildCommissioningStatus — missing prerequisites surface a next action", () => {
  test("not claimed → next action is to generate/enter a claim code", () => {
    const s = buildCommissioningStatus(signals({ gatewayCount: 0, onlineGatewayCount: 0 }));
    expect(s.ready).toBe(false);
    expect(stateOf(s, "claimed")).toBe("missing");
    expect(s.nextAction).toMatch(/claim code/i);
  });

  test("claimed but offline → next action is on-site connector check", () => {
    const s = buildCommissioningStatus(signals({ onlineGatewayCount: 0 }));
    expect(stateOf(s, "online")).toBe("missing");
    expect(stateOf(s, "source")).toBe("missing");
    expect(s.nextAction).toMatch(/offline|running/i);
  });

  test("missing UNS binding → bound missing, next action is build the namespace", () => {
    const s = buildCommissioningStatus(signals({ boundEquipmentCount: 0 }));
    expect(stateOf(s, "bound")).toBe("missing");
    expect(s.nextAction).toMatch(/bind|namespace/i);
  });

  test("missing approved tags → approvedTags missing, next action is approve tags", () => {
    const s = buildCommissioningStatus(signals({ approvedTagCount: 0 }));
    expect(stateOf(s, "approvedTags")).toBe("missing");
    expect(s.nextAction).toMatch(/approve.*tags|allowlist/i);
  });

  test("missing resolvable UNS → askMira missing", () => {
    const s = buildCommissioningStatus(signals({ resolvableUnsCount: 0 }));
    expect(stateOf(s, "askMira")).toBe("missing");
  });
});

describe("buildCommissioningStatus — read-only & separation", () => {
  test("pure: same input → same output, input not mutated", () => {
    const input = signals();
    const snapshot = JSON.stringify(input);
    const a = buildCommissioningStatus(input);
    const b = buildCommissioningStatus(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot); // no mutation of caller's signals
  });

  test("two connectors are independent (no shared/global state)", () => {
    // e.g. garage connector (not ready) vs Northwind/CV-200 connector (ready):
    // the function carries no state between calls, so one cannot affect the other.
    const garage = buildCommissioningStatus(signals({ approvedTagCount: 0, freshness: { live: 0, stale: 0, simulated: 0 } }));
    const cv200 = buildCommissioningStatus(signals());
    expect(garage.ready).toBe(false);
    expect(cv200.ready).toBe(true);
    // re-evaluating garage again is unchanged by the cv200 call in between
    expect(buildCommissioningStatus(signals({ approvedTagCount: 0, freshness: { live: 0, stale: 0, simulated: 0 } }))).toEqual(garage);
  });
});
