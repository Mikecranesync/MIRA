/**
 * OEM catalog corroboration, anchored to the real Oriental Motor case.
 *
 * The photo's motor part number was either missed entirely (baseline) or read
 * as `AZM1A91-0` / `AZM911AC-0` (multi-pass). The confirmed OEM manual contains
 * `AZM911AC-D` on page 43. The document is an independent observation of the
 * same equipment, so it can corroborate — but it must never rewrite what the
 * camera saw.
 */
import { describe, it, expect } from "vitest";
import {
  ocrDistance,
  isConfusablePair,
  stripSeparators,
  extractIdentifierCandidates,
  matchObservationToDocument,
  isCorroborating,
} from "@/lib/nameplate/oem-corroboration";
import { toFact, corroborate, canPromote } from "@/lib/nameplate/evidence";

/** Realistic slice of the DGII manual text around the specification table. */
const OEM_PAGES = [
  { page: 1, text: "DGII Series Hollow Rotary Actuator OPERATING MANUAL" },
  {
    page: 43,
    text:
      "Specifications table\n" +
      "Model: DGM200R-AZAC   Motor P/N AZM911AC-D\n" +
      "Rated current 1.27 A   Resolution 0.01 deg/step\n" +
      "Insulation class A   Ambient 40 C",
  },
  { page: 44, text: "DGM200R-AZAC continued. See also DGM130R-AZAC and DGM85R-AZAC." },
];

describe("OCR-confusion distance", () => {
  it("knows the plate confusion pairs", () => {
    expect(isConfusablePair("0", "O")).toBe(true);
    expect(isConfusablePair("1", "I")).toBe(true);
    expect(isConfusablePair("8", "B")).toBe(true);
    expect(isConfusablePair("5", "S")).toBe(true);
    // Not confusable — genuinely different characters.
    expect(isConfusablePair("A", "X")).toBe(false);
    expect(isConfusablePair("3", "9")).toBe(false);
  });

  it("ignores separators OCR drops or invents", () => {
    expect(stripSeparators("AZM911AC-D")).toBe("AZM911ACD");
    expect(ocrDistance("AZM911AC-D", "AZM911ACD")).toBe(0);
    expect(ocrDistance("DGM200R-AZAC", "DGM200R AZAC")).toBe(0);
  });

  it("scores a confusion substitution far below a real difference", () => {
    // O/0 confusion vs a genuinely different character.
    const confusable = ocrDistance("DGM2OOR-AZAC", "DGM200R-AZAC");
    const different = ocrDistance("DGM250R-AZAC", "DGM200R-AZAC");
    expect(confusable).toBeLessThan(1);
    expect(different).toBeGreaterThanOrEqual(1);
    expect(confusable).toBeLessThan(different);
  });
});

describe("identifier extraction from the OEM document", () => {
  const candidates = extractIdentifierCandidates(OEM_PAGES);

  it("finds the model and the motor part number", () => {
    const values = candidates.map((c) => c.value);
    expect(values).toContain("DGM200R-AZAC");
    expect(values).toContain("AZM911AC-D");
  });

  it("records where each identifier was seen", () => {
    const motor = candidates.find((c) => c.value === "AZM911AC-D")!;
    expect(motor.pages).toEqual([43]);
    const model = candidates.find((c) => c.value === "DGM200R-AZAC")!;
    // Appears on 43 and 44 — provenance keeps both.
    expect(model.pages).toEqual([43, 44]);
    expect(model.occurrences).toBeGreaterThanOrEqual(2);
  });

  it("prefers identifiers that sit next to a MODEL / P-N label", () => {
    const motor = candidates.find((c) => c.value === "AZM911AC-D")!;
    expect(motor.labelled).toBe(true);
  });

  it("does not harvest prose, units, or bare numbers", () => {
    const values = candidates.map((c) => c.value);
    expect(values).not.toContain("OPERATING");
    expect(values).not.toContain("1.27");
    expect(values).not.toContain("43");
    expect(values).not.toContain("NEMA");
  });
});

describe("matching the real photo readings", () => {
  const candidates = extractIdentifierCandidates(OEM_PAGES);

  it("THE case: AZM911AC-0 corroborates AZM911AC-D by confusion alone", () => {
    // Observed by the multi-pass reader. Differs from the manual only by 0/D.
    const match = matchObservationToDocument("AZM911AC-0", candidates);
    expect(match).not.toBeNull();
    expect(match!.candidate.value).toBe("AZM911AC-D");
    expect(match!.kind).toBe("confusable");
    expect(isCorroborating(match)).toBe(true);
    // The wording never claims the photo said the OEM value.
    expect(match!.reason).toMatch(/the photo reads AZM911AC-0/);
    expect(match!.reason).toMatch(/ambiguous, not corrected/);
  });

  it("an exact model read is corroborated exactly", () => {
    const match = matchObservationToDocument("DGM200R-AZAC", candidates);
    expect(match!.kind).toBe("exact");
    expect(isCorroborating(match)).toBe(true);
  });

  it("a badly mangled reading is NOT treated as corroborating", () => {
    // AZM1A91-0 has real character moves, not pure confusion — a human hint at
    // best. This is the guard against quietly adopting a wrong part number.
    const match = matchObservationToDocument("AZM1A91-0", candidates);
    if (match) {
      expect(match.kind).not.toBe("exact");
      expect(match.kind).not.toBe("confusable");
      expect(isCorroborating(match)).toBe(false);
    }
  });

  it("does not collapse a genuinely different family member", () => {
    // DGM130R-AZAC is a REAL different actuator in the same manual. A reading of
    // it must never be "corrected" to DGM200R-AZAC.
    const match = matchObservationToDocument("DGM130R-AZAC", candidates);
    expect(match!.candidate.value).toBe("DGM130R-AZAC");
    expect(match!.kind).toBe("exact");
  });

  it("returns null for an empty or absent observation", () => {
    expect(matchObservationToDocument(null, candidates)).toBeNull();
    expect(matchObservationToDocument("   ", candidates)).toBeNull();
  });
});

describe("end-to-end with the evidence layer", () => {
  const candidates = extractIdentifierCandidates(OEM_PAGES);
  const rawText = ["DGM200R-AZAC", "Orientalmotor", "AZM911AC-0"];

  it("turns an ambiguous photo reading into corroborated evidence, keeping both values", () => {
    const fact = toFact({ field: "catalogNumber", value: "AZM911AC-0", rawText });
    // On the photo alone it is merely observed and un-promotable as identity? —
    // identity may stand, but we want the document's agreement recorded.
    const match = matchObservationToDocument("AZM911AC-0", candidates)!;
    expect(isCorroborating(match)).toBe(true);

    const corroborated = corroborate(fact, {
      source: "oem_document",
      value: match.candidate.value,
      detail: `page ${match.candidate.pages[0]} — ${match.kind}`,
    });

    // It is a CONFLICT, not a silent overwrite: the strings genuinely differ.
    expect(corroborated.status).toBe("conflicting");
    // Both readings survive. The photo's value is never rewritten.
    expect(corroborated.value).toBe("AZM911AC-0");
    expect(corroborated.conflicts[0].value).toBe("AZM911AC-D");
    expect(corroborated.conflicts[0].source).toBe("oem_document");
    expect(canPromote(corroborated).ok).toBe(false);
  });

  it("supplies a catalog number the photo never read, attributed to the document", () => {
    // The baseline missed it entirely — this is the common real case.
    const missed = toFact({ field: "catalogNumber", value: null, rawText: [] });
    const supplied = corroborate(missed, {
      source: "oem_document",
      value: "AZM911AC-D",
      detail: "page 43",
    });
    expect(supplied.value).toBe("AZM911AC-D");
    expect(supplied.source).toBe("oem_document");
    expect(supplied.rawText).toBeNull(); // never attributed to the image
    expect(supplied.reason).toMatch(/not legible on the photo/i);
    expect(canPromote(supplied).ok).toBe(true);
  });

  it("the safety boundary is unchanged: a corroborated current is promotable, an unsupported one is not", () => {
    const alone = toFact({ field: "ratedCurrent", value: "12A", rawText: ["12A"] });
    expect(canPromote(alone).ok).toBe(false);

    const withDoc = corroborate(alone, { source: "oem_document", value: "1.27 A", detail: "page 43" });
    expect(withDoc.status).toBe("conflicting");
    expect(canPromote(withDoc).ok).toBe(false); // conflict still blocks

    const agreeing = corroborate(
      toFact({ field: "ratedCurrent", value: "1.27A", rawText: ["1.27A"] }),
      { source: "oem_document", value: "1.27 A", detail: "page 43" },
    );
    expect(agreeing.status).toBe("corroborated");
    expect(canPromote(agreeing).ok).toBe(true);
  });
});
