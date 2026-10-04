import { describe, expect, it } from "vitest";
import { citationTitle } from "../citation-title";

describe("citationTitle", () => {
  it("an upload keeps its filename", () => {
    expect(citationTitle({ title: "520-du001_-en-e.pdf", manufacturer: "Allen-Bradley", modelNumber: "525" })).toBe("520-du001_-en-e.pdf");
  });
  it("a titleless chunk is named by maker and model, never 'Attached document'", () => {
    const t = citationTitle({ title: "", manufacturer: "Yaskawa", modelNumber: "GA500" });
    expect(t).toBe("Yaskawa GA500 manual");
    expect(t).not.toMatch(/attached/i);
  });
  it("Codex #4229 F1: the label never claims provenance a missing title cannot prove", () => {
    // A titleless PRIVATE upload reaches the same fallback as a shared OEM row.
    expect(citationTitle({ title: null, manufacturer: "Siemens", modelNumber: "TP700" })).not.toMatch(/library|manufacturer's|shared|oem/i);
  });
  it("no maker or model still never claims an attachment", () => {
    expect(citationTitle({ title: null, manufacturer: "", modelNumber: null })).toBe("Manual");
  });
  it("whitespace-only titles count as missing", () => {
    expect(citationTitle({ title: "  ", manufacturer: "ABB", modelNumber: "" })).toBe("ABB manual");
  });
});
