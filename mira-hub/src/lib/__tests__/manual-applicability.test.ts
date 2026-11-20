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

  // Owner decision 2026-11-20 (Codex #5706 r4 F4): a space stands in for a
  // break only where the identifier itself writes one. Flattened PDF text
  // cannot show where a table cell ends, so a spaced print of a hyphenated
  // catalog number goes to candidate review rather than verifying.
  it("a spaced print of a hyphenated catalog number (25B D010 N104) is candidate review, not exact", () => {
    const v = assessApplicability({
      identity: PF525,
      chunks: [{ content: "Catalog 25B D010 N104", page: 3 }],
      oemHost: false,
    });
    expect(v.state).toBe("candidate");
  });
  it("matches across punctuation drift (25B-D010-N104 in the manual)", () => {
    const v = assessApplicability({
      identity: PF525,
      chunks: [{ content: "Catalog 25B-D010-N104", page: 3 }],
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

describe("assessApplicability — the identifier is a whole token (2026-11-20, GS10 regression)", () => {
  // Verbatim rows of the official GS10 user manual (gs10usermanual.pdf).
  const P26 = "Model Name: GS11N-2xPx GS11N-20P2 GS11N-20P5 GS11N-21P0 GS11N-22P0 GS11N-23P0 AutomationDirect";
  const P383 = "GS11N-10P5 9.4 N/A\nEMF11AM21A\nGS11N-20P2 5.1 N/A AutomationDirect";
  const gs = (model: string, content: string, catalogNumber?: string) =>
    assessApplicability({
      identity: { manufacturer: "AutomationDirect", model, ...(catalogNumber ? { catalogNumber } : {}) },
      chunks: [{ content, page: 26 }],
      oemHost: true,
    });

  it("verifies the exact plate model from the model table, with or without its hyphen", () => {
    expect(gs("GS11N-20P2", P26)).toMatchObject({ state: "verified", method: "model_exact_with_manufacturer" });
    expect(gs("GS11N20P2", P26).state).toBe("verified");
    expect(gs("gs11n-20p2", P26).state).toBe("verified");
  });

  it.each([
    ["GS11N-20P25", P383], // a table neighbour ("5.1") is not part of the model
    ["GS11N-20", P26], // a stem of the real model is not the exact model
    ["GS11N-2", P26],
    ["GS11N-20P3", P26], // a look-alike
  ])("does not verify %s as the exact model", (model, content) => {
    const v = gs(model, content);
    expect(v.state).toBe("candidate");
    expect(v.method).not.toMatch(/exact/);
  });

  it("a catalog number never takes a neighbouring table cell either", () => {
    expect(gs("GS10", P383, "GS11N-20P25").method).not.toBe("catalog_number_exact");
    expect(gs("GS10", P383, "GS11N-20P2").method).toBe("catalog_number_exact");
  });
});

describe("assessApplicability — identifier pages (2026-11-20)", () => {
  it("lists only the pages that name the exact model, not manufacturer-only pages", () => {
    const v = assessApplicability({
      identity: { manufacturer: "AutomationDirect", model: "GS11N-20P2" },
      chunks: [
        { content: "AutomationDirect DURApulse GS10 user manual", page: 1 },
        { content: "Model Name: GS11N-20P2 GS11N-20P5", page: 26 },
        { content: "GS11N-20P2 5.1 N/A", page: 383 },
      ],
      oemHost: true,
    });
    expect(v.state).toBe("verified");
    expect(v.evidencePages).toEqual([1, 26, 383]);
    expect(v.identifierPages).toEqual([26, 383]);
  });
});

describe("assessApplicability — suffixes, table cells and PDF dashes (Codex #5706 r1 F4/F5)", () => {
  const oem = (model: string, content: string) =>
    assessApplicability({ identity: { manufacturer: "AutomationDirect", model }, chunks: [{ content, page: 26 }], oemHost: true });

  it.each([
    ["GS11N-20P2", "Applies to GS11N-20P2-EX only"], // a longer suffixed model
    ["GS11N-20P2", "Applies to GS11N-20P2/EX only"],
    ["GS11N-20P2N", "GS11N-20P2 N/A 5.1"], // a neighbouring N/A cell
    ["GS11N-20P2N", "GS11N-20P2 N 5.1"], // a one-letter neighbouring cell
  ])("%s does not verify against %j", (model, content) => {
    const v = oem(model, content);
    expect(v.state).toBe("candidate");
    expect(v.identifierPages ?? []).toEqual([]);
  });

  it.each([
    "Model GS11N–20P2 rated 0.25 HP", // en dash
    "Model GS11N‑20P2 rated 0.25 HP", // non-breaking hyphen
    "Model GS11N-20P2, GS11N-20P5", // a comma-separated list
    "Model GS11N-20P2.", // sentence end
  ])("GS11N-20P2 verifies against %j", (content) => {
    expect(oem("GS11N-20P2", content)).toMatchObject({ state: "verified", identifierPages: [26] });
  });

  it.each([
    ["PowerFlex 40", "PowerFlex 40 Adjustable Frequency AC Drive user manual"],
    ["PowerFlex 4", "PowerFlex 4 Adjustable Frequency AC Drive"],
    ["PowerFlex 70", "This manual covers the PowerFlex 70 drive"],
  ])("a model whose own last group is short (%s) still verifies against its own spelling", (model, content) => {
    expect(assessApplicability({ identity: { manufacturer: "Allen-Bradley", model }, chunks: [{ content, page: 3 }], oemHost: true }).state).toBe("verified");
  });

  it("control: PowerFlex 40 does not verify against PowerFlex 400", () => {
    expect(assessApplicability({ identity: { manufacturer: "Allen-Bradley", model: "PowerFlex 40" }, chunks: [{ content: "PowerFlex 400 drive", page: 3 }], oemHost: true }).state).toBe("candidate");
  });

  it.each([
    ["GS11N20P2", "Applies to GS11N20P2-EX only"], // Codex #5706 r2 F4: compact spelling, suffixed variant
    ["GS11N-20P2-230", "GS11N-20P2 230 V 1.7 A"], // a neighbouring voltage cell
    ["GS11N-20P2-230V", "GS11N-20P2 230V 1.7 A"], // advisor: the same class with a letter tail
    ["GS11N-20P2-1PH", "GS11N-20P2 1PH 0.25 HP"],
    ["GS11N-20P2-IP20", "GS11N-20P2 IP20 enclosure"],
  ])("model %s does not verify against %j", (model, content) => {
    const v = oem(model, content);
    expect(v.state).toBe("candidate");
    expect(v.identifierPages ?? []).toEqual([]);
  });

  it.each([
    ["GS11N-20P2-230", "GS11N-20P2 230 V 1.7 A"],
    ["GS11N-20P2-230V", "GS11N-20P2 230V 1.7 A"],
    ["GS11N-20P2-IP20", "GS11N-20P2 IP20 enclosure"],
  ])("catalog %s does not verify against a neighbouring cell %j", (catalogNumber, content) => {
    const v = assessApplicability({
      identity: { manufacturer: "AutomationDirect", model: "", catalogNumber },
      chunks: [{ content, page: 26 }],
      oemHost: true,
    });
    expect(v.state).toBe("candidate");
    expect(v.identifierPages ?? []).toEqual([]);
  });

  it.each([
    ["GS11N20P2", "Model GS11N20P2 rated 0.25 HP"],
    ["PowerFlex 525", "PowerFlex 525 AC Drives"],
    ["PowerFlex525", "PowerFlex525 AC Drives"],
    ["GS11N-20P2-230", "Model GS11N-20P2-230 rated"],
  ])("control: %s verifies against %j", (model, content) => {
    expect(oem(model, content).state).toBe("verified");
  });

  // Codex #5706 r3 F4: a compact prefix followed by a spaced cell mixes two
  // spellings of the identity's own separators, for the model and the catalog
  // number alike.
  it.each([
    ["GS11N-20P2-230", "GS11N20P2 230 V 1.7 A"],
    ["GS11N-20P2-230V", "GS11N20P2 230V 1.7 A"],
    ["GS11N-20P2-IP20", "GS11N20P2 IP20 enclosure"],
  ])("r3 F4: %s does not verify against %j, as a model or as a catalog number", (id, content) => {
    for (const identity of [
      { manufacturer: "AutomationDirect", model: id },
      { manufacturer: "AutomationDirect", model: "", catalogNumber: id },
    ]) {
      const v = assessApplicability({ identity, chunks: [{ content, page: 26 }], oemHost: true });
      expect(v.state).toBe("candidate");
      expect(v.identifierPages ?? []).toEqual([]);
    }
  });

  it.each([
    ["GS11N-20P2-230", "Model GS11N20P2230 rated"], // every separator omitted
    ["GS11N-20P2-230", "Model GS11N.20P2.230 rated"], // every separator punctuated
    ["PowerFlex 40", "PowerFlex 40 Adjustable Frequency AC Drive"], // the identifier writes the space
  ])("r3 F4 control: %s verifies against the consistent spelling %j", (id, content) => {
    expect(assessApplicability({ identity: { manufacturer: "AutomationDirect", model: "", catalogNumber: id }, chunks: [{ content, page: 26 }], oemHost: true }).state).toBe("verified");
  });

  // Codex #5706 r4 F4 (owner decision 2026-11-20): a space where the identifier
  // writes none is a possible table-cell boundary, so the match never verifies.
  it.each([
    ["GS11N-20P2-230", "Model GS11N 20P2 230 rated"], // the r4 example: base model + next voltage cell
    ["GS11N-20P2", "Model GS11N 20P2 rated"],
    ["25B-D010N104", "Catalog 25B D010 N104 drive"],
    ["PowerFlex525", "PowerFlex 525 AC Drives"], // a compact request against a spaced print
  ])("r4 F4: %s stays a candidate against the spaced print %j, as model and as catalog number", (id, content) => {
    for (const identity of [
      { manufacturer: "AutomationDirect", model: id },
      { manufacturer: "AutomationDirect", model: "", catalogNumber: id },
    ]) {
      const v = assessApplicability({ identity, chunks: [{ content, page: 26 }], oemHost: true });
      expect(v.state).toBe("candidate");
      expect(v.identifierPages ?? []).toEqual([]);
    }
  });

  it("a slash-joined model list is not read as either model (fails safe to candidate review)", () => {
    expect(oem("GS11N-20P2", "Models GS11N-20P2/GS11N-20P5 rated 0.25 HP").state).toBe("candidate");
  });

  it("control: a different suffix written with an en dash stays a candidate", () => {
    expect(oem("GS11N-20P3", "Model GS11N–20P2 rated 0.25 HP").state).toBe("candidate");
  });
});
