/**
 * Unresolved `[n]` markers must never ship to the technician. Resolved ones
 * stay as `[n]` so Hub/mobile renderers can show the manual and page.
 *
 * Run: cd mira-hub && ./node_modules/.bin/vitest run src/capabilities/citation-markers.test.ts
 */
import { describe, expect, it } from "vitest";
import { makeUnresolvedCitationStripper, stripUnresolvedCitationMarkers } from "./citation-markers";

const cites = [{ citationId: "1" }, { citationId: "2" }];

describe("stripUnresolvedCitationMarkers", () => {
  it("keeps a marker that resolves to a shipped citation", () => {
    expect(stripUnresolvedCitationMarkers("P042 sets decel [1].", cites)).toBe("P042 sets decel [1].");
  });

  it("strips a bare [n] that names no citation, including the space before it", () => {
    expect(stripUnresolvedCitationMarkers("P042 sets decel [1] and also [9].", cites)).toBe(
      "P042 sets decel [1] and also.",
    );
  });

  it("strips every [n] when no citations shipped (general / refusal)", () => {
    expect(stripUnresolvedCitationMarkers("Check the DC bus [1] and the fan [2].", [])).toBe(
      "Check the DC bus and the fan.",
    );
  });

  it("leaves ordinary bracketed prose and parameter names alone", () => {
    expect(stripUnresolvedCitationMarkers("P042 [Decel Time 1] on terminal [A].", cites)).toBe(
      "P042 [Decel Time 1] on terminal [A].",
    );
  });

  it("does not convert provider 【n】 markers — that is answer-shape / #4303", () => {
    expect(stripUnresolvedCitationMarkers("reset the fault【1】", cites)).toBe("reset the fault【1】");
  });
});

describe("makeUnresolvedCitationStripper", () => {
  it("keeps resolvable markers and drops unknown ones across deltas", () => {
    const s = makeUnresolvedCitationStripper(cites);
    let out = s.push("P042 sets decel ");
    out += s.push("[1] then a ghost ");
    out += s.push("[");
    out += s.push("9] done");
    out += s.flush();
    expect(out).toBe("P042 sets decel [1] then a ghost done");
  });

  it("never leaks a held-back partial as if it were a marker", () => {
    const s = makeUnresolvedCitationStripper(cites);
    expect(s.push("see note [") + s.flush()).toBe("see note [");
  });
});
