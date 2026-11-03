// #5130 / #5127 — AutomationDirect drives number parameters as group.index
// ("P1.02" in GS1, "P01.12" in GS10). Before this, "what is P1.02 default"
// produced no exact token at all, and "P01.12 setting" was cut down to "P01",
// which matches every parameter in group 1.
import { describe, it, expect, vi } from "vitest";
import { expandIndustrialQuery, rerankChunks, storedSpellings, type RerankTraceRow } from "@/lib/notebook-query";
import { retrieveNodeChunks } from "@/lib/manual-rag";

describe("dotted parameter numbers are exact tokens (#5130)", () => {
  it("P1.02 is an exact token, in both group spellings", () => {
    const { exactTokens } = expandIndustrialQuery("what is P1.02 default");
    expect(exactTokens).toEqual(expect.arrayContaining(["P1.02", "P01.02"]));
  });

  it("P01.12 is kept whole, not cut down to P01", () => {
    const { exactTokens } = expandIndustrialQuery("P01.12 setting");
    expect(exactTokens).toEqual(expect.arrayContaining(["P01.12", "P1.12"]));
    expect(exactTokens).not.toContain("P01");
    expect(exactTokens).not.toContain("P001");
  });

  // Controls: the undotted spellings behave exactly as before.
  it("P042 still expands to its zero-padding spellings", () => {
    expect(expandIndustrialQuery("P042 value").exactTokens).toEqual(["P042", "P42"]);
  });
  it("a sentence-ending period does not make a dotted token", () => {
    expect(expandIndustrialQuery("check P042.").exactTokens).toEqual(["P042", "P42"]);
  });
});

// Postgres ILIKE semantics for the patterns the lane sends: % is any run, _ is
// any one character, everything else literal and case-insensitive.
function ilike(pattern: string, text: string): boolean {
  const re = pattern
    .split("")
    .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`, "is").test(text);
}

async function exactLanePatterns(question: string): Promise<string[]> {
  const q = vi.fn(async () => ({ rows: [] }));
  await retrieveNodeChunks({ query: q } as never, "00000000-0000-0000-0000-000000000001", question, {
    nodeId: "n1",
    unsPath: null,
    docIds: ["d1"],
  });
  return (q.mock.calls as unknown as Array<[string, unknown[]?]>)
    .filter(([sql]) => /ILIKE ANY/.test(sql))
    .flatMap(([, p]) => (p ?? [])[2] as string[]);
}

describe("the exact lane matches a dotted token in both stored spellings (#5130, #5143 F2)", () => {
  it("sends the period and the U+FFFD spelling as explicit alternatives", async () => {
    const patterns = await exactLanePatterns("what is P1.02 default");
    expect(patterns).toEqual(expect.arrayContaining(["%P1.02%", "%P1�02%", "%P01.02%", "%P01�02%"]));
    expect(patterns.some((p) => p.includes("_"))).toBe(false);
  });

  it("matches P1.02 and P1�02, and rejects P1102, P1A02 and P1-02", async () => {
    const patterns = await exactLanePatterns("what is P1.02 default");
    const hits = (text: string) => patterns.some((p) => ilike(p, text));
    expect(hits("Default for P1.02 is 30")).toBe(true);
    expect(hits("Default for P1�02 is 30")).toBe(true);
    expect(hits("Default for P1102 is 30")).toBe(false);
    expect(hits("Default for P1A02 is 30")).toBe(false);
    expect(hits("Default for P1-02 is 30")).toBe(false);
  });

  it("an undotted token keeps a single spelling", () => {
    expect(storedSpellings("P042")).toEqual(["P042"]);
  });
});

describe("rerank credits a dotted token stored with U+FFFD (#5130)", () => {
  const expanded = expandIndustrialQuery("what is P1.02 default");
  const exactHit = (content: string) => {
    const trace: RerankTraceRow[] = [];
    rerankChunks(expanded, [{ content, rank: 1, sourcePage: 9, docId: "d1" }], { trace });
    return trace[0]?.exactHit;
  };
  it("P1�02 counts as the exact ID", () => {
    expect(exactHit("P1�02 Decel Time 1 Default Setting: 30�0 sec")).toBe(true);
  });
  it("P1102 does not", () => {
    expect(exactHit("P1102 Decel Time 1 Default Setting: 30 sec")).toBe(false);
  });
});
