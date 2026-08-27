/**
 * Follow-up suggestion builder — deterministic, evidence-derived, no LLM.
 * Chips are REAL questions the proven answer paths handle (setup/procedure,
 * spec range, keypad navigation, fault clear); a facet with no evidence never
 * becomes a suggestion.
 */
import { describe, expect, it } from "vitest";
import { buildFollowupSuggestions } from "../notebook-followups";

describe("buildFollowupSuggestions", () => {
  it("offers per-facet drill-downs after a multi-facet answer, proven facets only", () => {
    const s = buildFollowupSuggestions({
      plan: { shape: "multi_facet", facets: ["embedded EtherNet/IP", "RS-485 Modbus RTU", "DeviceNet"] },
      provenFacets: ["embedded EtherNet/IP", "RS-485 Modbus RTU"], // DeviceNet was a gap
      answer: "The drive supports embedded EtherNet/IP [1] and RS-485 Modbus RTU [2].",
      status: "answered",
    });
    expect(s).toContain("How do I set up embedded EtherNet/IP?");
    expect(s).toContain("How do I set up RS-485 Modbus RTU?");
    expect(s.join(" ")).not.toMatch(/DeviceNet/); // gap facet never suggested
  });

  it("uses the how-does-it-work template for non-comm facets", () => {
    const s = buildFollowupSuggestions({
      plan: { shape: "multi_facet", facets: ["motor overload", "ground fault"] },
      provenFacets: ["motor overload", "ground fault"],
      answer: "Protections include motor overload [1] and ground fault [2].",
      status: "answered",
    });
    expect(s).toContain("How does motor overload work on this drive?");
  });

  it("offers range + keypad follow-ups after a parameter answer", () => {
    const s = buildFollowupSuggestions({
      plan: { shape: "single_fact", facets: [] },
      provenFacets: [],
      answer: "P042 [Decel Time 1] sets the deceleration time [1].",
      status: "answered",
    });
    expect(s).toContain("What's the valid range for P042?");
    expect(s).toContain("How do I change P042 from the keypad?");
  });

  it("offers fault-clear after a fault-meaning answer", () => {
    const s = buildFollowupSuggestions({
      plan: { shape: "single_fact", facets: [] },
      provenFacets: [],
      answer: "Fault F004 [UnderVoltage] means the DC bus voltage fell below its minimum [1].",
      status: "answered",
    });
    expect(s).toContain("How do I clear fault F004?");
  });

  it("suggests nothing on refusals, errors, and caps at 3", () => {
    expect(
      buildFollowupSuggestions({
        plan: { shape: "single_fact", facets: [] },
        provenFacets: [],
        answer: "The excerpts do not contain that.",
        status: "insufficient_evidence",
      }),
    ).toEqual([]);
    const many = buildFollowupSuggestions({
      plan: { shape: "exhaustive", facets: ["a1 thing", "b2 thing", "c3 thing", "d4 thing", "e5 thing"] },
      provenFacets: ["a1 thing", "b2 thing", "c3 thing", "d4 thing", "e5 thing"],
      answer: "All five things exist [1].",
      status: "answered",
    });
    expect(many.length).toBeLessThanOrEqual(3);
  });
});
