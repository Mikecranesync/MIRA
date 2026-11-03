// #5130 / #5127 — AutomationDirect drives number parameters as group.index
// ("P1.02" in GS1, "P01.12" in GS10). Before this, "what is P1.02 default"
// produced no exact token at all, and "P01.12 setting" was cut down to "P01",
// which matches every parameter in group 1.
import { describe, it, expect, vi } from "vitest";
import { expandIndustrialQuery } from "@/lib/notebook-query";
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

describe("the exact lane matches a dotted token against the stored glyph (#5130)", () => {
  it("P1.02 searches with a one-character wildcard where the period was", async () => {
    const q = vi.fn(async () => ({ rows: [] }));
    await retrieveNodeChunks({ query: q } as never, "00000000-0000-0000-0000-000000000001", "what is P1.02 default", {
      nodeId: "n1",
      unsPath: null,
      docIds: ["d1"],
    });
    const params = (q.mock.calls as unknown as Array<[string, unknown[]?]>)
      .flatMap(([, p]) => p ?? [])
      .filter((p): p is string[] => Array.isArray(p) && p.every((x) => typeof x === "string"))
      .flat();
    expect(params).toContain("%P1_02%");
    expect(params).toContain("%P01_02%");
    expect(params).not.toContain("%P1.02%");
  });
});
