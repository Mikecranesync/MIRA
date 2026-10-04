import { describe, expect, it } from "vitest";
import { citationTitle } from "../citation-title";

describe("citationTitle", () => {
  it("an upload keeps its filename", () => {
    expect(citationTitle({ title: "520-du001_-en-e.pdf", manufacturer: "Allen-Bradley", modelNumber: "525" })).toBe("520-du001_-en-e.pdf");
  });
  it("a shared-library chunk is named by maker and model, never 'Attached document'", () => {
    const t = citationTitle({ title: "", manufacturer: "Yaskawa", modelNumber: "GA500" });
    expect(t).toBe("Yaskawa GA500 (manufacturer library)");
    expect(t).not.toMatch(/attached/i);
  });
  it("a library chunk with no maker or model still never claims an attachment", () => {
    expect(citationTitle({ title: null, manufacturer: "", modelNumber: null })).toBe("Manufacturer library manual");
  });
  it("whitespace-only titles count as missing", () => {
    expect(citationTitle({ title: "  ", manufacturer: "ABB", modelNumber: "" })).toBe("ABB (manufacturer library)");
  });
});
