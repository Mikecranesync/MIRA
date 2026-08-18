/**
 * Evidence-layer tests, anchored to a REAL failure.
 *
 * The fixture below is the verbatim output the shipped recognizer produced for
 * a real photograph of an Oriental Motor DGM200R-AZAC plate (2026-08-15). The
 * plate reads `1.27A`; the model returned `12A`. The plate carries UL/CE/UK CA;
 * the model returned `RoHS`, which is not on it. Every rule here exists because
 * of one of those two observations.
 */
import { describe, it, expect } from "vitest";
import {
  toFact,
  corroborate,
  confirmByTechnician,
  canPromote,
  summarizeForReview,
  parseMeasurement,
  measurementsAgree,
  hasImageEvidence,
  isSafetyCritical,
  isIdentityField,
  isComplianceMark,
} from "@/lib/nameplate/evidence";

/** Verbatim `rawText` from the real run. Note `12A` and the invented `RoHS`. */
const REAL_RAW_TEXT = [
  "DGM200R-AZAC",
  "MODEL",
  "HOLLOW ROTARY ACTUATORS",
  "Orientalmotor",
  "3.87VDC",
  "12A",
  "0010YSTEP",
  "3N5.CLASS A",
  "GSB111970",
  "ORIENTALMOTOR CO., LTD.",
  "MADE IN JAPAN",
  "UL",
  "CE",
  "RoHS",
];

describe("measurement parsing — the decimal is the whole game", () => {
  it("keeps 0.12 / 1.2 / 1.27 / 12 / 12.7 / 127 distinct", () => {
    const raws = ["0.12A", "1.2A", "1.27A", "12A", "12.7A", "127A"];
    const values = raws.map((r) => parseMeasurement(r).value);
    expect(values).toEqual([0.12, 1.2, 1.27, 12, 12.7, 127]);
    expect(new Set(values).size).toBe(6);
    // Every pair must disagree — no collapsing.
    for (let i = 0; i < raws.length; i++) {
      for (let j = i + 1; j < raws.length; j++) {
        expect(measurementsAgree(raws[i], raws[j])).toBe(false);
      }
    }
  });

  it("THE regression: 1.27A must never equal 12A", () => {
    expect(measurementsAgree("1.27A", "12A")).toBe(false);
    expect(measurementsAgree("1.27 A", "1.27A")).toBe(true);
  });

  it("honors a comma decimal but never invents a separator", () => {
    expect(parseMeasurement("1,27A").value).toBe(1.27);
    expect(measurementsAgree("1,27A", "1.27A")).toBe(true);
    // "127A" is NOT repaired into 1.27A.
    expect(measurementsAgree("127A", "1.27A")).toBe(false);
  });

  it("treats a unit mismatch as disagreement even when the number matches", () => {
    expect(measurementsAgree("40°C", "40A")).toBe(false);
    expect(measurementsAgree("3.87VDC", "3.87VDC")).toBe(true);
  });

  it("does NOT treat a part number as a measurement", () => {
    // Regression: an unanchored parse found the `911` inside `AZM911AC-D`, so
    // two different part numbers that happen to share embedded digits compared
    // EQUAL as measurements and corroborated each other silently. A part number
    // is not a quantity.
    expect(parseMeasurement("AZM911AC-D").value).toBeNull();
    expect(parseMeasurement("DGM200R-AZAC").value).toBeNull();
    expect(measurementsAgree("AZM911AC-D", "AZM911AC-0")).toBe(false);
    expect(measurementsAgree("DGM200R-AZAC", "DGM130R-AZAC")).toBe(false);
  });

  it("parses units off real plate strings", () => {
    expect(parseMeasurement("3.87VDC")).toEqual({ value: 3.87, unit: "VDC" });
    expect(parseMeasurement("1.27A")).toEqual({ value: 1.27, unit: "A" });
    expect(parseMeasurement(null)).toEqual({ value: null, unit: null });
    expect(parseMeasurement("Class A")).toEqual({ value: null, unit: null });
  });
});

describe("field taxonomy", () => {
  it("separates identity from safety-critical specification", () => {
    expect(isIdentityField("manufacturer")).toBe(true);
    expect(isIdentityField("model")).toBe(true);
    expect(isSafetyCritical("manufacturer")).toBe(false);
    expect(isSafetyCritical("ratedCurrent")).toBe(true);
    expect(isSafetyCritical("voltage")).toBe(true);
    expect(isSafetyCritical("rpm")).toBe(true);
  });

  it("knows the hallucination-prone compliance marks", () => {
    expect(isComplianceMark("RoHS")).toBe(true);
    expect(isComplianceMark(" ce ")).toBe(true);
    expect(isComplianceMark("DGM200R-AZAC")).toBe(false);
  });
});

describe("image-evidence gate", () => {
  it("supports a claim that appears in the observed text", () => {
    expect(hasImageEvidence("DGM200R-AZAC", REAL_RAW_TEXT)).toBe(true);
    expect(hasImageEvidence("Orientalmotor", REAL_RAW_TEXT)).toBe(true);
  });

  it("refuses a claim with no supporting observed text", () => {
    expect(hasImageEvidence("AZM911AC-D", REAL_RAW_TEXT)).toBe(false);
    expect(hasImageEvidence(null, REAL_RAW_TEXT)).toBe(false);
  });
});

describe("the fabricated RoHS mark", () => {
  it("is REJECTED, not merely downgraded, when the photo does not support it", () => {
    // The model listed RoHS in rawText, but suppose a cleaner pass did not read
    // it — the claim then has no image support and must not be recorded.
    const withoutRohs = REAL_RAW_TEXT.filter((t) => t !== "RoHS");
    const fact = toFact({ field: "certification", value: "RoHS", rawText: withoutRohs });
    expect(fact.status).toBe("rejected");
    expect(fact.source).toBe("image_inferred");
    expect(fact.reason).toMatch(/no text on the photo supports it/i);
    expect(canPromote(fact).ok).toBe(false);
  });

  it("never lets a rejected mark reach canonical knowledge", () => {
    const fact = toFact({ field: "certification", value: "ATEX", rawText: [] });
    expect(canPromote(fact).ok).toBe(false);
  });

  it("blocks the REAL case: the model listed RoHS in its own rawText", () => {
    // This is the actual failure. `RoHS` IS present in REAL_RAW_TEXT because the
    // model reported reading it — a hallucination that corroborates itself. A
    // gate that only checks the claim against the model's own text list would
    // wave this straight through as `observed`.
    expect(REAL_RAW_TEXT).toContain("RoHS");
    const fact = toFact({ field: "certification", value: "RoHS", rawText: REAL_RAW_TEXT });
    expect(fact.status).not.toBe("observed");
    expect(fact.status).toBe("candidate");
    expect(canPromote(fact).ok).toBe(false);
    expect(canPromote(fact).reason).toMatch(/independent corroboration/i);
  });

  it("accepts a mark once an independent source confirms it", () => {
    // UL and CE really are on this plate — they become promotable via a source
    // that is not the same vision pass.
    const ul = toFact({ field: "certification", value: "UL", rawText: REAL_RAW_TEXT });
    expect(canPromote(ul).ok).toBe(false);
    const confirmed = confirmByTechnician(ul, "UL", "tech@plant");
    expect(canPromote(confirmed).ok).toBe(true);
  });
});

describe("safety-critical values are candidates no matter how confident", () => {
  it("does not promote the (wrong) 12A on image evidence alone", () => {
    const fact = toFact({
      field: "ratedCurrent",
      value: "12A",
      rawText: REAL_RAW_TEXT,
      confidence: 0.95,
    });
    // It WAS read off the photo — but that is not enough for a current rating.
    expect(fact.source).toBe("image");
    expect(fact.status).toBe("candidate");
    expect(fact.safetyCritical).toBe(true);
    const gate = canPromote(fact);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/confirm it or corroborate/i);
  });

  it("surfaces a CONFLICT when the OEM document disagrees — never silently picks", () => {
    const fact = toFact({ field: "ratedCurrent", value: "12A", rawText: REAL_RAW_TEXT });
    const checked = corroborate(fact, {
      source: "oem_document",
      value: "1.27 A",
      detail: "HL-80002-12E.pdf p.43",
    });
    expect(checked.status).toBe("conflicting");
    expect(checked.conflicts).toHaveLength(1);
    expect(checked.reason).toMatch(/12A/);
    expect(checked.reason).toMatch(/1\.27 A/);
    expect(canPromote(checked).ok).toBe(false);
  });

  it("promotes only after the technician decides", () => {
    const fact = toFact({ field: "ratedCurrent", value: "12A", rawText: REAL_RAW_TEXT });
    const conflicted = corroborate(fact, { source: "oem_document", value: "1.27 A" });
    const fixed = confirmByTechnician(conflicted, "1.27 A", "tech@plant");
    expect(fixed.status).toBe("technician_confirmed");
    expect(fixed.value).toBe("1.27 A");
    expect(fixed.normalizedValue).toBe(1.27);
    expect(fixed.source).toBe("technician");
    expect(canPromote(fixed).ok).toBe(true);
    // The original bad reading is retained as evidence, not erased.
    expect(fixed.conflicts[0].value).toBe("1.27 A");
  });

  it("promotes a safety value corroborated by the OEM document without a human", () => {
    const fact = toFact({ field: "voltage", value: "3.87VDC", rawText: REAL_RAW_TEXT });
    expect(canPromote(fact).ok).toBe(false);
    const corr = corroborate(fact, { source: "oem_document", value: "3.87 VDC" });
    expect(corr.status).toBe("corroborated");
    expect(canPromote(corr).ok).toBe(true);
  });
});

describe("identity is permissive — discovery validates it downstream", () => {
  it("lets an observed manufacturer/model stand as observed and promotable", () => {
    const mfr = toFact({ field: "manufacturer", value: "Orientalmotor", rawText: REAL_RAW_TEXT });
    const model = toFact({ field: "model", value: "DGM200R-AZAC", rawText: REAL_RAW_TEXT });
    expect(mfr.status).toBe("observed");
    expect(model.status).toBe("observed");
    expect(canPromote(mfr).ok).toBe(true);
    expect(canPromote(model).ok).toBe(true);
  });

  it("marks a missed catalog number as a candidate, never as read", () => {
    const missed = toFact({ field: "catalogNumber", value: null, rawText: REAL_RAW_TEXT });
    expect(missed.status).toBe("candidate");
    expect(missed.rawText).toBeNull();
    expect(canPromote(missed).ok).toBe(false);
  });

  it("accepts a catalog number SUPPLIED by the OEM document, attributed to it", () => {
    const missed = toFact({ field: "catalogNumber", value: null, rawText: REAL_RAW_TEXT });
    const supplied = corroborate(missed, {
      source: "oem_document",
      value: "AZM911AC-D",
      detail: "HL-80002-12E.pdf p.43",
    });
    expect(supplied.value).toBe("AZM911AC-D");
    expect(supplied.source).toBe("oem_document");
    expect(supplied.status).toBe("corroborated");
    // Crucially NOT attributed to the image — we never read it off the plate.
    expect(supplied.rawText).toBeNull();
    expect(supplied.reason).toMatch(/not legible on the photo/i);
  });
});

describe("review summary — show the technician only what needs judgment", () => {
  it("splits the real run into corroborated / needs-review / rejected", () => {
    const noRohs = REAL_RAW_TEXT.filter((t) => t !== "RoHS");
    const facts = [
      toFact({ field: "manufacturer", value: "Orientalmotor", rawText: REAL_RAW_TEXT }),
      toFact({ field: "model", value: "DGM200R-AZAC", rawText: REAL_RAW_TEXT }),
      corroborate(toFact({ field: "voltage", value: "3.87VDC", rawText: REAL_RAW_TEXT }), {
        source: "oem_document",
        value: "3.87VDC",
      }),
      corroborate(toFact({ field: "ratedCurrent", value: "12A", rawText: REAL_RAW_TEXT }), {
        source: "oem_document",
        value: "1.27A",
      }),
      toFact({ field: "certification", value: "RoHS", rawText: noRohs }),
    ];
    const s = summarizeForReview(facts);
    expect(s.total).toBe(5);
    expect(s.rejected.map((f) => f.value)).toEqual(["RoHS"]);
    // The current conflict is the ONE thing demanding a decision.
    expect(s.needsReview.map((f) => f.field)).toContain("ratedCurrent");
    expect(s.needsReview.map((f) => f.field)).not.toContain("voltage");
    expect(s.promotable.map((f) => f.field).sort()).toEqual(
      ["manufacturer", "model", "voltage"].sort(),
    );
  });
});

// ── Anchor gate on identity promotion (internet-100 fix) ─────────────────────
//
// 86 wrong identity promotions across 59 real-world samples shared one shape:
// the string was genuinely on the plate (so image-evidence passed) but it was
// NOT the field it was promoted as. The gate: model/catalogNumber/serialNumber
// promote only when the plate's own printed anchor agrees.

describe("identity anchor gate — right string, wrong field, no promotion", () => {
  it("demotes a frame size assigned as model to candidate (web-006 J56Z case)", () => {
    const fact = toFact({
      field: "model",
      value: "J56Z",
      rawText: ["CENTURY ELECTRIC", "FRAME J56Z", "SER NO J10", "HP 1/3"],
    });
    expect(fact.status).toBe("candidate");
    expect(fact.reason).toMatch(/anchor/i);
    expect(canPromote(fact).ok).toBe(false);
  });

  it("CONFLICTS a bearing number assigned as serial when the plate anchors a different serial", () => {
    const fact = toFact({
      field: "serialNumber",
      value: "6203-2Z-J/C3",
      rawText: ["OPP END BRG 6203-2Z-J/C3", "ID# Z 03 7689115-0061"],
    });
    expect(fact.status).toBe("conflicting");
    expect(fact.conflicts[0].value).toContain("7689115");
    expect(canPromote(fact).ok).toBe(false);
  });

  it("keeps an anchored, agreeing identity observed and promotable (CU320 catalog)", () => {
    const fact = toFact({
      field: "catalogNumber",
      value: "6SL3040-1MA01-0AA0",
      rawText: ["1P 6SL3040-1MA01-0AA0", "S T-P96166484"],
    });
    expect(fact.status).toBe("observed");
    expect(canPromote(fact).ok).toBe(true);
    // Provenance upgraded to the anchored line, not just the bare value.
    expect(fact.rawText).toContain("1P");
  });

  it("manufacturer keeps the permissive rule — logos carry no anchor keyword", () => {
    const fact = toFact({ field: "manufacturer", value: "SIEMENS", rawText: ["SIEMENS", "SINAMICS"] });
    expect(fact.status).toBe("observed");
    expect(canPromote(fact).ok).toBe(true);
  });
});
