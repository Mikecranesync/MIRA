/**
 * #5356 — a technician's "is it still live?" wording vs the manual's
 * "hazardous voltage" / "shock hazard", and the synonym boost that must be able
 * to tell the manual-worded chunk apart. Pure-function tests; the chunk texts are
 * short paraphrases of the shape of real manual passages, not manual excerpts.
 */
import { describe, expect, it } from "vitest";
import { expandIndustrialQuery, rerankChunks, type ExpandedQuery } from "../notebook-query";

const mk = (content: string, rank: number, page = 1) => ({ content, rank, sourcePage: page, docId: "d1" });
const joined = (q: string) => expandIndustrialQuery(q).variants.join(" ").toLowerCase();

describe("expandIndustrialQuery — live / energized / shock wording", () => {
  it.each([
    "smc flex is powered off but is there still live voltage on the motor side",
    "Motor is stopped - are the output terminals still live?",
    "Can I unplug connectors while the circuit is still hot?",
    "Is the DC bus still energized after I open the disconnect?",
    "If I shut it off, can I still get shocked on the motor leads?",
  ])("bridges %j to hazard-statement vocabulary", (q) => {
    const j = joined(q);
    expect(j).toContain("hazardous voltage");
    expect(j).toContain("shock hazard");
    expect(expandIndustrialQuery(q).variants[0]).toBe(q); // the technician's words still lead
  });

  it.each([
    "Can I watch live data values on the controller's LCD screen?",
    "How do I see live tag values from the PLC?",
    "My drive runs hot in the cabinet, what clearance does it need?",
    "What is the hot restart time after a power loss?",
  ])("leaves non-electrical %j alone", (q) => {
    expect(joined(q)).not.toContain("hazardous voltage");
  });
});

describe("rerankChunks — the synonym boost counts only the added vocabulary", () => {
  it("lifts the hazard statement above a chunk that merely repeats the question's words (#5356 SMC Flex p.103)", () => {
    const e = expandIndustrialQuery("smc flex is powered off but is there still live voltage on the motor side");
    // Shares many of the technician's words, higher ts_rank: before the fix it
    // earned the same capped synonym bonus as the hazard statement and won.
    const echo = mk("SMC Flex controller troubleshooting: if the motor side voltage is still present when powered, check the side wiring", 0.8, 104);
    const hazard = mk("SHOCK HAZARD: Hazardous voltage is present in the motor circuit even when the controller is off. To avoid shock hazard, disconnect main power.", 0.5, 103);
    expect(rerankChunks(e, [echo, hazard])[0]).toBe(hazard);
  });

  it("still boosts a query rewrite's terms when no static synonym fired", () => {
    const q = "what keeps tripping my starter";
    const e: ExpandedQuery = { variants: [q, "overload trip class setting"], exactTokens: [], codeTokens: [], phrases: [] };
    const generic = mk("starter keeps tripping and what to check general notes", 0.9, 2);
    const answer = mk("Overload trip class setting selects 10, 15, 20 or 30", 0.5, 40);
    expect(rerankChunks(e, [generic, answer])[0]).toBe(answer);
  });

  it("keeps ts_rank order for a question with no synonym or rewrite", () => {
    const e = expandIndustrialQuery("general question about the enclosure");
    const a = mk("enclosure question general content", 0.9);
    const b = mk("enclosure general", 0.3);
    expect(rerankChunks(e, [b, a])).toEqual([a, b]);
  });
});
