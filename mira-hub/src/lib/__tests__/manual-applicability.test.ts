// Vitest coverage for src/lib/manual-applicability.ts.
//
// The rule being protected: a manual is only "verified" when THAT DOCUMENT'S
// OWN TEXT proves it covers the confirmed component. Titles, URLs, and OEM
// hosts alone never promote a source into chat.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/manual-applicability.test.ts

import { describe, it, expect } from "vitest";
import { normalizeIdentifier, assessApplicability } from "@/lib/manual-applicability";

const PF525 = { manufacturer: "Allen-Bradley", model: "525", catalogNumber: "25B-D010N104" };

describe("normalizeIdentifier", () => {
  it("collapses case and punctuation so PF-525 ~ pf 525 ~ PF525", () => {
    expect(normalizeIdentifier("PF-525")).toBe("PF525");
    expect(normalizeIdentifier("pf 525")).toBe("PF525");
    expect(normalizeIdentifier(" 25B-D010N104 ")).toBe("25BD010N104");
    expect(normalizeIdentifier("")).toBe("");
  });
});

describe("assessApplicability — rule 1: exact catalog number wins", () => {
  it("verifies on an exact normalized catalog match and records tokens + pages", () => {
    const v = assessApplicability({
      identity: PF525,
      chunks: [
        { content: "Front matter", page: 1 },
        { content: "Drive catalog number 25B-D010N104 rated 10 A", page: 7 },
      ],
      oemHost: false,
    });
    expect(v.state).toBe("verified");
    expect(v.method).toBe("catalog_number_exact");
    expect(v.matchedTokens).toContain("25BD010N104");
    expect(v.evidencePages).toEqual([7]);
    expect(v.confidence).toBeGreaterThan(0.9);
  });

  it("matches across punctuation drift (25B D010 N104 in the manual)", () => {
    const v = assessApplicability({
      identity: PF525,
      chunks: [{ content: "Catalog 25B D010 N104", page: 3 }],
      oemHost: false,
    });
    expect(v.state).toBe("verified");
  });
});

describe("assessApplicability — rule 2: model plus attribution", () => {
  it("verifies on model + manufacturer named in the text", () => {
    const v = assessApplicability({
      identity: { manufacturer: "Allen-Bradley", model: "525" },
      chunks: [{ content: "Allen-Bradley PowerFlex 525 Adjustable Frequency AC Drive", page: 1 }],
      oemHost: false,
    });
    expect(v.state).toBe("verified");
    expect(v.method).toBe("model_exact_with_manufacturer");
    expect(v.matchedTokens).toContain("525");
    expect(v.evidencePages).toEqual([1]);
  });

  it("verifies on model + oemHost even when the text never names the maker", () => {
    const v = assessApplicability({
      identity: { manufacturer: "Allen-Bradley", model: "525" },
      chunks: [{ content: "PowerFlex 525 user manual — parameter list", page: 2 }],
      oemHost: true,
    });
    expect(v.state).toBe("verified");
    expect(v.method).toBe("model_exact_on_oem_host");
    expect(v.evidencePages).toEqual([2]);
  });

  it("leaves an unattributed model match as a candidate", () => {
    const v = assessApplicability({
      identity: { manufacturer: "Allen-Bradley", model: "525" },
      chunks: [{ content: "Generic distributor sheet: 525 unit in stock", page: 4 }],
      oemHost: false,
    });
    expect(v.state).toBe("candidate");
    expect(v.method).toBe("model_exact_unattributed");
  });
});

describe("assessApplicability — rule 3: family prefix is never auto-verified", () => {
  it("keeps a 520-series document as a candidate for a 525", () => {
    const v = assessApplicability({
      identity: { manufacturer: "Allen-Bradley", model: "525" },
      chunks: [
        { content: "Allen-Bradley PowerFlex 520-Series Adjustable Frequency AC Drive", page: 1 },
      ],
      oemHost: true,
    });
    expect(v.state).toBe("candidate");
    expect(v.method).toBe("family_prefix_only");
    expect(v.matchedTokens).toContain("520");
    expect(v.evidencePages).toEqual([1]);
    expect(v.reason).toMatch(/525/);
  });
});

describe("assessApplicability — rule 4: no evidence", () => {
  it("returns a candidate naming what was missing", () => {
    const v = assessApplicability({
      identity: PF525,
      chunks: [{ content: "This manual covers the SEW MOVITRAC B inverter.", page: 1 }],
      oemHost: true,
    });
    expect(v.state).toBe("candidate");
    expect(v.method).toBe("no_identifier_evidence");
    expect(v.matchedTokens).toEqual([]);
    expect(v.evidencePages).toEqual([]);
    expect(v.reason).toMatch(/25B-D010N104/);
  });

  it("never returns verified on zero chunk evidence, even on an OEM host", () => {
    const v = assessApplicability({ identity: PF525, chunks: [], oemHost: true });
    expect(v.state).toBe("candidate");
    expect(v.method).toBe("no_chunk_evidence");
    expect(v.confidence).toBe(0);
  });
});

describe("assessApplicability — evidence bookkeeping", () => {
  it("collects and de-duplicates evidence pages in order, ignoring null pages", () => {
    const v = assessApplicability({
      identity: { manufacturer: "Allen-Bradley", model: "525" },
      chunks: [
        { content: "Allen-Bradley PowerFlex 525", page: 9 },
        { content: "Allen-Bradley PowerFlex 525 again", page: 2 },
        { content: "Allen-Bradley PowerFlex 525 again", page: 2 },
        { content: "Allen-Bradley PowerFlex 525 with no page", page: null },
      ],
      oemHost: false,
    });
    expect(v.state).toBe("verified");
    expect(v.evidencePages).toEqual([2, 9]);
  });
});
