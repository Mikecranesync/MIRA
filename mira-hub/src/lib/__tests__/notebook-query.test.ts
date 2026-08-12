/**
 * Query expansion + rerank for Equipment Notebook retrieval. Pure-function unit
 * tests — assert the vocabulary bridge and exact-token dominance that the live
 * failures (P042 / "slow down" / terminal 07) require.
 */
import { describe, expect, it } from "vitest";
import { expandIndustrialQuery, rerankChunks } from "../notebook-query";

describe("expandIndustrialQuery", () => {
  it("bridges 'slow down ramp' → deceleration vocabulary", () => {
    const e = expandIndustrialQuery("What parameter is the slow down ramp?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("deceleration");
    expect(joined).toContain("decel time");
    expect(e.variants[0]).toBe("What parameter is the slow down ramp?"); // original first
  });

  it("expands 'second speed' to both interpretations", () => {
    const e = expandIndustrialQuery("Which terminal sets second speed?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("speed reference 2");
    expect(joined).toContain("preset frequency");
  });

  it("expands 'motor frequency' to the frequency family, not monitoring", () => {
    const e = expandIndustrialQuery("What about setting motor frequency?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("motor np hertz");
    expect(joined).toContain("maximum freq");
    expect(joined).toContain("minimum freq");
  });

  it("extracts exact parameter IDs and fault codes verbatim", () => {
    expect(expandIndustrialQuery("What parameter is P042?").exactTokens).toContain("P042");
    expect(expandIndustrialQuery("what does fault F004 mean").exactTokens).toContain("F004");
    expect(expandIndustrialQuery("tell me about A410").exactTokens).toContain("A410");
    expect(expandIndustrialQuery("read b001").exactTokens).toContain("B001");
  });

  it("extracts a terminal number as a zero-padded exact token", () => {
    expect(expandIndustrialQuery("Which terminal sets second speed? terminal 7").exactTokens).toContain("07");
    expect(expandIndustrialQuery("what is terminal 07").exactTokens).toContain("07");
  });

  it("captures quoted phrases", () => {
    expect(expandIndustrialQuery('what is "Decel Time 1"').phrases).toContain("Decel Time 1");
  });

  it("is a no-op-ish for a plain query with no domain triggers", () => {
    const e = expandIndustrialQuery("hello there");
    expect(e.variants).toEqual(["hello there"]);
    expect(e.exactTokens).toEqual([]);
  });
});

describe("rerankChunks", () => {
  const mk = (content: string, rank: number, page = 1) => ({ content, rank, sourcePage: page, docId: "d1" });

  it("floats the exact-token chunk above a higher-ts_rank same-page sibling", () => {
    // The live bug: two chunks on p.21; the FLA one out-ranks the P042 one.
    const e = expandIndustrialQuery("What parameter is P042?");
    const fla = mk("P033 [Motor NP FLA] ... P035 [Motor NP Poles] sets poles", 0.9, 21);
    const p042 = mk("P042 [Decel Time 1] 0.00/600.00 s ... decel from Maximum Freq to 0 Hz", 0.1, 21);
    const out = rerankChunks(e, [fla, p042]);
    expect(out[0]).toBe(p042); // exact-token dominance wins
  });

  it("ranks a chunk that matches synonym terms above an unrelated one", () => {
    const e = expandIndustrialQuery("slow down ramp");
    const decel = mk("P042 [Decel Time 1] sets deceleration time decel time", 0.2);
    const noise = mk("grounding and wiring inspection checklist", 0.5);
    const out = rerankChunks(e, [decel, noise]);
    expect(out[0]).toBe(decel);
  });

  it("preserves ts_rank order when no boosts apply", () => {
    const e = expandIndustrialQuery("general question");
    const a = mk("alpha content", 0.9);
    const b = mk("beta content", 0.3);
    expect(rerankChunks(e, [b, a])).toEqual([a, b]);
  });
});
