import { describe, expect, it } from "vitest";

import { FALLBACK_SUGGESTIONS, suggestionsFrom } from "./HomeComposer";

/**
 * Three suggestions drawn from live equipment state (tracker unblocker 1,
 * gates A-1 / B-1).
 *
 * Two of these tests are not about formatting. They encode the boundary that
 * keeps the composer inside the general/educational carve-out of
 * `.claude/rules/uns-confirmation-gate.md`:
 *
 *   - a suggestion names a MODEL, never an asset INSTANCE — "what causes F0004
 *     on a PowerFlex 525?" is a general question the tenant's own fleet merely
 *     inspired; "why is CV-101 faulting?" is asset-specific and the chat-gate
 *     applies to it;
 *   - a suggestion never asserts machine STATE. Naming no instance is not
 *     enough: "why is your PowerFlex 525 running hot?" names nothing and still
 *     claims a live condition MIRA has not observed.
 *
 * The hard test for the second one, and the reason it is mechanical rather
 * than a matter of taste: **a suggestion must be equally true for a technician
 * who has that model and one who does not.** Anything that fails it has
 * smuggled in state.
 */

const POWERFLEX = { manufacturer: "Allen-Bradley", model: "PowerFlex 525", lastFault: null };

describe("suggestionsFrom — live equipment state, general questions", () => {
  it("builds from make + model, in the order the API returned them", () => {
    const out = suggestionsFrom([
      POWERFLEX,
      { manufacturer: "Siemens", model: "G120", lastFault: null },
    ]);
    // /api/assets orders last_work_order_at DESC, so first == most recently
    // active. That ordering IS the "live" part; re-sorting would discard it.
    expect(out[0]).toContain("Allen-Bradley PowerFlex 525");
    expect(out[1]).toContain("Siemens G120");
  });

  it("quotes a fault only when the row actually carries one", () => {
    const withFault = suggestionsFrom([{ ...POWERFLEX, lastFault: "F0004" }]);
    expect(withFault[0]).toBe("What causes F0004 on a Allen-Bradley PowerFlex 525?");

    const without = suggestionsFrom([POWERFLEX]);
    expect(without[0]).toBe("How do I troubleshoot a Allen-Bradley PowerFlex 525?");
    // Never invent a fault code for a machine that has not reported one.
    expect(without[0]).not.toMatch(/F\d{3,4}/);
  });

  it("dedupes by make+model so one fleet of identical drives is one chip", () => {
    const out = suggestionsFrom([POWERFLEX, { ...POWERFLEX }, { ...POWERFLEX }]);
    expect(out).toHaveLength(1);
  });

  it("skips a row with neither make nor model rather than prompting vaguely", () => {
    const out = suggestionsFrom([
      { manufacturer: null, model: null, lastFault: "F0004" },
      POWERFLEX,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("PowerFlex 525");
  });

  it("caps at three", () => {
    const many = ["A", "B", "C", "D", "E"].map((m) => ({
      manufacturer: "Vendor",
      model: m,
      lastFault: null,
    }));
    expect(suggestionsFrom(many)).toHaveLength(3);
  });

  it("falls back to generic starters for a tenant with no equipment", () => {
    // The Z-1 case: a stranger on a ten-minute-old account. An empty composer
    // with nothing to tap is the failure this unblocker exists to fix.
    expect(suggestionsFrom([])).toEqual([...FALLBACK_SUGGESTIONS]);
  });

  it("never names an asset instance — on EITHER branch", () => {
    // Both templates must be covered. An earlier version of this test passed
    // only a fault-less row, so it exercised the "how do I troubleshoot"
    // branch alone — and a mutation that leaked the tag into the "what causes
    // <fault>" branch sailed straight past it. A guard that covers one of two
    // paths is a guard on one of two paths.
    const instance = { tag: "CV-101", id: "asset-uuid-1", serialNumber: "SN-99" } as object;
    const out = [
      ...suggestionsFrom([{ ...POWERFLEX, ...instance }]),
      ...suggestionsFrom([{ ...POWERFLEX, lastFault: "F0004", ...instance }]),
    ];
    expect(out).toHaveLength(2); // control: both branches actually produced text

    for (const s of out) {
      // Naming an instance would make the question asset-specific and pull the
      // composer under the UNS confirmation gate it was designed to sit outside.
      expect(s, `"${s}" names an asset tag`).not.toContain("CV-101");
      expect(s, `"${s}" leaks an asset id`).not.toContain("asset-uuid-1");
      expect(s, `"${s}" leaks a serial number`).not.toContain("SN-99");
    }
  });

  it("never asserts machine state — true whether or not you own the model", () => {
    const all = [
      ...suggestionsFrom([{ ...POWERFLEX, lastFault: "F0004" }]),
      ...suggestionsFrom([POWERFLEX]),
      ...suggestionsFrom([]),
    ];
    expect(all.length).toBeGreaterThan(0); // control: an empty set passes vacuously

    for (const s of all) {
      // Possessives claim the machine is theirs and in some condition.
      expect(s, `"${s}" claims ownership`).not.toMatch(/\byour\b/i);
      // Present-tense condition claims: "is running hot", "is faulting",
      // "showing F0004" — MIRA has observed no such thing from this surface.
      expect(s, `"${s}" asserts a live condition`).not.toMatch(
        /\b(is|are|showing|currently|right now)\b/i,
      );
      // "Why is X ..." presupposes the condition it asks about.
      expect(s, `"${s}" presupposes a condition`).not.toMatch(/^why\b/i);
    }
  });
});
