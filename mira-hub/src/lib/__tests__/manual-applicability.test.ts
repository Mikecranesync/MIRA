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
  it.each(["25B-D010N104A", "X25B-D010N104", "25B-D010N104-X"])(
    "does not verify a sibling catalog ID %s with the same normalized substring",
    (catalog) => {
      const verdict = assessApplicability({
        identity: PF525,
        chunks: [{ content: `Table of catalog numbers: ${catalog}`, page: 5 }],
        oemHost: true,
      });
      expect(verdict.state).toBe("candidate");
    },
  );

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
  it.each([
    ["PowerFlex 525", "PowerFlex® 525 User Manual", "verified"],
    ["PowerFlex 525", "PowerFlex™ 525 User Manual", "verified"],
    ["ACS355", "ABB ACS355/ACS310 User Manual", "verified"],
    ["ACS310", "ABB ACS355 / ACS310 User Manual", "verified"],
    ["ACS355", "ABB ACS355/24V User Manual", "candidate"],
    ["ACS355", "ABB ACS355 / 24V User Manual", "candidate"],
    ["ACS355", "ABB ACS355/ACS310/02 User Manual", "candidate"],
    ["ACS355", "ABB ACS355/ACS310-\nA User Manual", "candidate"],
    ["ACS355", "ABB ACS355-03U-06A7-2 User Manual", "candidate"],
    ["ACS355", "ABB ACS355\n-03U-06A7-2 User Manual", "candidate"],
    ["ACS355", "ABB ACS355 \r\n  - 03U-06A7-2 User Manual", "candidate"],
    ["ACS355-03U-06A7-2", "ABB ACS355\n-03U\n-06A7-2 User Manual", "verified"],
    ["03U-06A7-2", "ABB ACS355\n-03U-06A7-2 User Manual", "candidate"],
    ["ACS355", "ABB ACS355.\n- 24 V input", "verified"],
    ["ACS355", "ABB ACS355\n- Installation instructions", "verified"],
    ["ACS355", "Applicable ABB model\n- ACS355", "verified"],
    ["ACS355/24V", "ABB ACS355 / 24V User Manual", "verified"],
    ["FST20", "FST20-\nA Product Datasheet", "candidate"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0", "verified"],
    ["6AV2124-0GC01-0AX0", "Applies to Siemens model 6AV2124-0GC01-0AX0. Installation instructions follow.", "verified"],
    ["6AV2124-0GC01-0AX0", "Applies to Siemens model 6AV2124 - 0GC01 - 0AX0.\nInstallation instructions follow.", "verified"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0A", "candidate"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0 - A", "candidate"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0.A", "candidate"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0 -\n A", "candidate"],
    ["6AV2124-0GC01-0AX0", "SIMATIC HMI 6AV2124 - 0GC01 - 0AX0 /\r\n A", "candidate"],
  ])("judges %s against the written model and option boundaries in %j", (model, content, state) => {
    const verdict = assessApplicability({
      identity: { manufacturer: "OEM", model },
      chunks: [{ content, page: 1 }],
      oemHost: true,
    });
    expect(verdict.state).toBe(state);
  });

  it("needs a short model to appear as a whole code", () => {
    const identity = { manufacturer: "Festo", model: "A1" };
    const verdict = (content: string) => assessApplicability({ identity, chunks: [{ content, page: 1 }], oemHost: true });

    expect(verdict("Appendix A 1 lists fasteners.").state).toBe("candidate");
    expect(verdict("Festo A1 technical data.").state).toBe("verified");
  });

  it.each([
    ["FST20-\nA", "verified"],
    ["FST20‑\r\n  A", "verified"],
    ["FST20\nA", "candidate"],
    ["FST20-\nA-X", "candidate"],
  ])("requires the full model across an explicit separator at a PDF line break (%j)", (content, state) => {
    const verdict = assessApplicability({
      identity: { manufacturer: "Festo", model: "FST20-A" },
      chunks: [{ content, page: 1 }],
      oemHost: true,
    });
    expect(verdict.state).toBe(state);
  });

  it("does not verify an omitted option suffix on a manufacturer's own document", () => {
    const verdict = assessApplicability({
      identity: { manufacturer: "Festo", model: "VUVG-LK10-M52-AT-G14-F" },
      chunks: [{ content: "Festo VUVG-LK10-M52-AT-G14-F-A valve datasheet", page: 1 }],
      oemHost: true,
    });
    expect(verdict.state).toBe("candidate");
  });

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
