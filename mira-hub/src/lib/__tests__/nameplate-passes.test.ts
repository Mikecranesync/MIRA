/**
 * Adversarial tests for the DETERMINISTIC nameplate parser.
 *
 * These test the parser, never the model. Everything here is offline and pure:
 * no network, no provider, no fixtures on disk.
 *
 * The failure this suite exists to make impossible: the shipped single-pass
 * recognizer read `1.27A` off a real motor plate as `12A`. A technician sizing
 * an overload from a 10x-wrong current is the worst outcome this feature can
 * produce, and it is exactly the kind of error a language model makes silently
 * and a regex cannot. So the invariant is stated as a test, not a comment:
 * decimal placement survives, and an unparseable token becomes null rather than
 * the nearest plausible number.
 */
import { describe, it, expect } from "vitest";
import {
  parseNumberToken,
  parseVoltage,
  parseCurrent,
  parseResolution,
  parseAmbient,
  parseInsulation,
  parseCatalogNumber,
  parseModel,
  parseSerial,
  parseMarks,
  voteMarks,
  coerceSpecValue,
  coerceAmbient,
  coerceInsulation,
  parseNameplateLines,
  reconcileIdentityCandidate,
  mergeCandidates,
  agreementKey,
  evidenceToValues,
  runMultiPass,
  type VisionCall,
} from "../nameplate/passes";
import { inspectImage, rotationDegreesFor, orientationHint } from "../nameplate/preprocess";

// ── The headline invariant: numbers must not collapse into one another ───────

describe("parseNumberToken — magnitudes stay distinct", () => {
  const LADDER = ["0.12", "1.2", "1.27", "12", "12.7", "127"];

  it("parses every rung to its own distinct value", () => {
    const values = LADDER.map((t) => parseNumberToken(t)!.value);
    expect(values).toEqual([0.12, 1.2, 1.27, 12, 12.7, 127]);
    expect(new Set(values).size).toBe(LADDER.length);
  });

  it("never moves, adds, or drops a decimal point", () => {
    for (const t of LADDER) {
      const p = parseNumberToken(t)!;
      const expectedDecimals = t.includes(".") ? t.split(".")[1].length : 0;
      expect(p.decimals).toBe(expectedDecimals);
      expect(p.text).toBe(t);
    }
  });

  it("does NOT rescue a missing decimal point — 127 stays 127, never 1.27", () => {
    const p = parseNumberToken("127")!;
    expect(p.value).toBe(127);
    expect(p.text).toBe("127");
  });

  it("does NOT insert a decimal to make an implausible reading plausible", () => {
    // 480 amps on a 100 A panel is implausible, but inventing 4.80 would be worse.
    expect(parseNumberToken("480")!.value).toBe(480);
  });
});

describe("parseNumberToken — OCR homoglyph repair", () => {
  const CASES: [string, number][] = [
    ["O.12", 0.12], // O vs 0
    ["0.l2", 0.12], // l vs 1
    ["l.27", 1.27], // l vs 1
    ["I.27", 1.27], // I vs 1
    ["|.27", 1.27], // pipe vs 1
    ["1.2S", 1.25], // S vs 5
    ["B.5", 8.5], // B vs 8
    ["i2.7", 12.7], // i vs 1
    ["3.87", 3.87],
  ];

  it.each(CASES)("reads %s as %s", (raw, expected) => {
    const p = parseNumberToken(raw)!;
    expect(p).not.toBeNull();
    expect(p.value).toBe(expected);
  });

  it("flags repaired tokens so confidence can be reduced", () => {
    expect(parseNumberToken("l.27")!.repaired).toBe(true);
    expect(parseNumberToken("1.27")!.repaired).toBe(false);
  });

  it("preserves the raw token for citation even after repair", () => {
    expect(parseNumberToken("O.12")!.raw).toBe("O.12");
  });

  it("keeps repaired magnitudes distinct too", () => {
    const vals = ["O.l2", "l.2", "l.27", "l2", "l2.7", "l27"].map(
      (t) => parseNumberToken(t)!.value,
    );
    expect(vals).toEqual([0.12, 1.2, 1.27, 12, 12.7, 127]);
  });
});

describe("parseNumberToken — refuses rather than guesses", () => {
  const REJECT = [
    "", // empty
    "   ", // blank
    "1.2.7", // two decimal points
    "12A", // unit glued on — the caller strips units, not this function
    "abc",
    "12-7", // a range or a part-number fragment, not a number
    "0010YSTEP", // the garbled resolution the baseline produced
    "1,234,567", // ambiguous thousands separators
    "-", // punctuation only
  ];

  it.each(REJECT)("returns null for %j", (raw) => {
    expect(parseNumberToken(raw)).toBeNull();
  });

  it("accepts a single European decimal comma but not thousands separators", () => {
    expect(parseNumberToken("1,27")!.value).toBe(1.27);
    expect(parseNumberToken("1,270")!.value).toBe(1.27);
    expect(parseNumberToken("1,2345")).toBeNull();
  });
});

// ── Measurement extraction off real plate lines ──────────────────────────────

describe("parseCurrent", () => {
  it("reads 1.27A off the real Oriental Motor spec line", () => {
    const m = parseCurrent(["3.87VDC   1.27A   0.01°/STEP"])!;
    expect(m.value).toBe(1.27);
    expect(m.unit).toBe("A");
    expect(m.text).toBe("1.27A");
  });

  it("does NOT read amps out of a part number", () => {
    // "AZM911AC-D" must not yield 911 A.
    expect(parseCurrent(["Motor P/N AZM911AC-D"])).toBeNull();
    expect(parseCurrent(["Catalog: 2080-LC20-20QWB"])).toBeNull();
  });

  it("does not confuse VA/VAC with amps", () => {
    expect(parseCurrent(["Input: 208-240VAC 1PH"])).toBeNull();
    expect(parseCurrent(["Output: 0-240VAC 3PH"])).toBeNull();
  });

  it("reads a whole-number current", () => {
    expect(parseCurrent(["Current: 100A"])!.value).toBe(100);
  });

  it("survives a homoglyph in the integer part", () => {
    const m = parseCurrent(["l.27A"])!;
    expect(m.value).toBe(1.27);
    expect(m.repaired).toBe(true);
  });
});

describe("parseVoltage", () => {
  it("reads 3.87VDC", () => {
    const m = parseVoltage(["3.87VDC 1.27A"])!;
    expect(m.value).toBe(3.87);
    expect(m.unit).toBe("VDC");
    expect(m.text).toBe("3.87VDC");
  });

  it("keeps a range intact instead of reporting only the upper bound", () => {
    const m = parseVoltage(["Input: 208-240VAC 1PH"])!;
    expect(m.text).toBe("208-240VAC");
    expect(m.value).toBe(240);
  });

  it("reads a bare 24VDC", () => {
    expect(parseVoltage(["Voltage: 24VDC"])!.text).toBe("24VDC");
  });
});

describe("parseResolution — the lost degree symbol", () => {
  it("reads 0.01°/STEP", () => {
    const m = parseResolution(["3.87VDC 1.27A 0.01°/STEP"])!;
    expect(m.value).toBe(0.01);
    expect(m.text).toBe("0.01°/STEP");
  });

  it("still reads it when OCR loses the degree symbol", () => {
    expect(parseResolution(["0.01/STEP"])!.value).toBe(0.01);
    expect(parseResolution(["0.01 o /STEP"])!.value).toBe(0.01);
    expect(parseResolution(["0.01 deg/step"])!.value).toBe(0.01);
  });

  it("refuses the garbled form rather than inventing a decimal point", () => {
    // The baseline produced "0010YSTEP" for "0.01°/STEP". Reporting 10°/step or
    // 0.01°/step from this string would both be fabrications.
    expect(parseResolution(["0010YSTEP"])).toBeNull();
    expect(parseResolution(["001010STEP"])).toBeNull();
  });

  it("does not silently rescale when the decimal point is genuinely absent", () => {
    expect(parseResolution(["001/STEP"])!.value).toBe(1);
  });
});

describe("parseAmbient / parseInsulation", () => {
  it("reads Amb.40°C", () => {
    expect(parseAmbient(["INS.Class A   Amb.40°C"])!.value).toBe(40);
    expect(parseAmbient(["INS.Class A   Amb.40°C"])!.text).toBe("Amb.40°C");
  });

  it("reads the ambient with the degree symbol lost", () => {
    expect(parseAmbient(["Amb 40 C"])!.value).toBe(40);
  });

  it("reads the insulation class", () => {
    expect(parseInsulation(["INS.Class A"])).toBe("INS.Class A");
    expect(parseInsulation(["Ins. Class A"])).toBe("INS.Class A");
    expect(parseInsulation(["Insulation Class F"])).toBe("INS.Class F");
  });

  it("coerces bare model-supplied forms", () => {
    expect(coerceAmbient("40°C")!.text).toBe("Amb.40°C");
    expect(coerceInsulation("Class A")).toBe("INS.Class A");
    expect(coerceInsulation("A")).toBe("INS.Class A");
    expect(coerceInsulation("hot")).toBeNull();
  });
});

// ── Identifiers: missing dashes, homoglyphs, wrong field ─────────────────────

describe("identifier parsing", () => {
  it("keeps the Danfoss TYPE and P/N separate from the FC-202 model/series", () => {
    const rawText = [
      "Danfoss",
      "VLT AQUA Drive",
      "TYPE FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
      "P/N 131H4017",
      "S/N 02334H073",
      "15 kW / 20 HP",
      "3x200-240 V",
    ];
    const parsed = parseNameplateLines(rawText);
    expect(parsed.typeCode?.value).toBe("FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX");
    expect(parsed.partNumber?.value).toBe("131H4017");
    expect(parsed.catalogNumber?.value).toBe("131H4017");

    const identity = reconcileIdentityCandidate(
      {
        manufacturer: "Danfoss",
        productFamily: "VLT AQUA Drive",
        series: "FC-202",
        model: "FC-202",
        rawText,
      },
      rawText,
    );
    expect(identity).toMatchObject({
      productFamily: "VLT AQUA Drive",
      series: "FC-202",
      model: "FC-202",
      typeCode: "FC-202P15KT2E20H2XGXXSXXXXAXBXCXXXXDX",
      partNumber: "131H4017",
      catalogNumber: "131H4017",
      serialNumber: "02334H073",
    });
  });

  it("pulls the motor part number out of a labelled line", () => {
    expect(parseCatalogNumber(["Motor P/N AZM911AC-D"])!.value).toBe("AZM911AC-D");
    expect(parseCatalogNumber(["Catalog: 2080-LC20-20QWB"])!.value).toBe("2080-LC20-20QWB");
    expect(parseCatalogNumber(["PART NO. GS10-20P5"])!.value).toBe("GS10-20P5");
  });

  it("pulls the model out of a labelled line", () => {
    expect(parseModel(["MODEL DGM200R-AZAC"])!.value).toBe("DGM200R-AZAC");
    expect(parseModel(["Model: Micro820"])!.value).toBe("Micro820");
  });

  it("treats a missing dash as a DIFFERENT string, not the same one", () => {
    // The parser must not repair punctuation inside an identifier...
    expect(parseCatalogNumber(["P/N AZM911ACD"])!.value).toBe("AZM911ACD");
    // ...but the agreement key deliberately ignores it, so two passes that
    // disagree only about a dash still count as agreeing.
    expect(agreementKey("AZM911ACD")).toBe(agreementKey("AZM911AC-D"));
    expect(agreementKey("AZM911AC-D")).not.toBe(agreementKey("AZM911AC-0"));
  });

  it("does not confuse a serial for a part number", () => {
    expect(parseCatalogNumber(["S/N QS8I119701"])).toBeNull();
    expect(parseSerial(["S/N QS8 I119701"])!.value).toBe("QS8 I119701");
  });

  it("returns null rather than scavenging an unlabelled string", () => {
    expect(parseCatalogNumber(["ORIENTAL MOTOR CO., LTD."])).toBeNull();
    expect(parseSerial(["TOKYO 110-8536 JAPAN"])).toBeNull();
  });
});

// ── Anti-hallucination surfaces ──────────────────────────────────────────────

describe("marks — literal presence, then repetition", () => {
  it("reports only marks whose letters are present", () => {
    expect(parseMarks(["UL", "CE", "UK CA"])).toEqual(["UL", "CE", "UKCA"]);
    expect(parseMarks(["MADE IN JAPAN", "TOKYO 110-8536"])).toEqual([]);
  });

  it("does not read CE out of an ordinary word", () => {
    expect(parseMarks(["HOLLOW ROTARY ACTUATOR", "CERTIFIED", "SOURCE"])).toEqual([]);
  });

  it("keeps a mark seen by both passes and drops one seen by only one", () => {
    const voted = voteMarks([
      ["UL", "CE", "UK CA"],
      ["UL", "CE", "UK CA"],
      ["UL", "RoHS"], // the invented mark, present in one read only
    ]);
    expect(voted.threshold).toBe(2);
    expect(voted.votes).toMatchObject({ UL: 3, CE: 2, UKCA: 2, RoHS: 1 });
    expect(voted.marks).toEqual(["UL", "CE", "UKCA"]);
    expect(voted.marks).not.toContain("RoHS");
  });

  it("cannot vote with a single pass, and says so via the threshold", () => {
    const voted = voteMarks([["UL", "RoHS"]]);
    expect(voted.threshold).toBe(1);
    expect(voted.marks).toContain("RoHS");
  });
});

describe("coerceSpecValue — a value must fit the field it was labelled with", () => {
  it("drops a voltage that a model put in the current field", () => {
    expect(coerceSpecValue("current", "0-240VAC")).toBeNull();
    expect(coerceSpecValue("current", "1.27A")).toBe("1.27A");
  });

  it("drops prose in a numeric field", () => {
    expect(coerceSpecValue("voltage", "low voltage")).toBeNull();
    expect(coerceSpecValue("resolution", "high resolution")).toBeNull();
  });

  it("leaves identity fields untouched", () => {
    expect(coerceSpecValue("model", "DGM200R-AZAC")).toBe("DGM200R-AZAC");
  });
});

// ── Whole-plate parse ────────────────────────────────────────────────────────

describe("parseNameplateLines on the real Oriental Motor plate", () => {
  const LINES = [
    "Orientalmotor",
    "MODEL DGM200R-AZAC",
    "HOLLOW ROTARY ACTUATOR",
    "Motor P/N AZM911AC-D",
    "3.87VDC   1.27A   0.01°/STEP",
    "INS.Class A   Amb.40°C",
    "TE",
    "QS8 I119701",
    "ORIENTAL MOTOR CO., LTD.",
    "TOKYO 110-8536 JAPAN",
    "MADE IN JAPAN",
    "CE",
    "UK CA",
    "UL",
  ];

  it("recovers every field the baseline got wrong", () => {
    const d = parseNameplateLines(LINES);
    expect(d.model!.value).toBe("DGM200R-AZAC");
    expect(d.catalogNumber!.value).toBe("AZM911AC-D");
    expect(d.voltage!.text).toBe("3.87VDC");
    expect(d.current!.text).toBe("1.27A"); // baseline said 12A
    expect(d.resolution!.text).toBe("0.01°/STEP"); // baseline said 0010YSTEP
    expect(d.ambient!.text).toBe("Amb.40°C");
    expect(d.insulation).toBe("INS.Class A");
    expect(d.marks).toEqual(["UL", "CE", "UKCA"]);
  });

  it("does not report RoHS, which is not on this plate", () => {
    expect(parseNameplateLines(LINES).marks).not.toContain("RoHS");
  });

  it("leaves the unlabelled lot code null rather than guessing which line it is", () => {
    expect(parseNameplateLines(LINES).serialNumber).toBeNull();
  });
});

// ── Merge / agreement ────────────────────────────────────────────────────────

describe("mergeCandidates", () => {
  const cand = (field: string, value: string, source: string, base: number) => ({
    field: field as never,
    value,
    rawText: value,
    source,
    base,
  });

  it("lets two agreeing passes outrank one more-trusted pass", () => {
    const merged = mergeCandidates(
      [
        cand("current", "1.27A", "det:ocr", 0.75),
        cand("current", "1.27A", "det:ocr:rot90", 0.75),
        cand("current", "12A", "semantic", 0.9),
      ],
      { current: 3 },
    );
    expect(merged.current.value).toBe("1.27A");
    expect(merged.current.agreementCount).toBe(2);
    expect(merged.current.passesSeen).toBe(3);
  });

  it("preserves the disagreement instead of averaging it away", () => {
    const merged = mergeCandidates(
      [cand("current", "1.27A", "det:ocr", 0.75), cand("current", "12A", "semantic", 0.55)],
      { current: 2 },
    );
    expect(merged.current.alternatives).toEqual([{ value: "12A", sources: ["semantic"] }]);
  });

  it("raises confidence with agreement and lowers it for a repaired read", () => {
    const solo = mergeCandidates([cand("current", "1.27A", "det:ocr", 0.75)], { current: 1 });
    const duo = mergeCandidates(
      [cand("current", "1.27A", "det:ocr", 0.75), cand("current", "1.27A", "det:ocr:rot90", 0.75)],
      { current: 2 },
    );
    expect(duo.current.confidence).toBeGreaterThan(solo.current.confidence);

    const repaired = mergeCandidates(
      [{ ...cand("current", "1.27A", "det:ocr", 0.75), repaired: true }],
      { current: 1 },
    );
    expect(repaired.current.confidence).toBeLessThan(solo.current.confidence);
  });

  it("treats punctuation-only differences as agreement", () => {
    const merged = mergeCandidates(
      [
        cand("catalogNumber", "AZM911AC-D", "det:ocr", 0.75),
        cand("catalogNumber", "AZM911ACD", "identifier", 0.7),
      ],
      { catalogNumber: 2 },
    );
    expect(merged.catalogNumber.agreementCount).toBe(2);
    expect(merged.catalogNumber.value).toBe("AZM911AC-D"); // higher-trust rendering
  });

  it("reports a field no pass produced as a null with zero agreement", () => {
    const merged = mergeCandidates([], { current: 2 });
    expect(merged.current).toMatchObject({
      value: null,
      agreementCount: 0,
      passesSeen: 2,
      alternatives: [],
    });
  });
});

// ── Orchestration, with a stub provider (no network) ─────────────────────────

describe("runMultiPass", () => {
  const stub =
    (byPrompt: (prompt: string) => string): VisionCall =>
    async ({ prompt }) => ({ text: byPrompt(prompt), model: "stub" });

  const OCR_REPLY = JSON.stringify({
    lines: ["MODEL DGM200R-AZAC", "Motor P/N AZM911AC-D", "3.87VDC 1.27A 0.01°/STEP", "UL", "CE"],
  });
  const SEMANTIC_REPLY = JSON.stringify({
    manufacturer: "Orientalmotor",
    model: "DGM200R-AZAC",
    catalogNumber: null,
    equipmentType: "Hollow Rotary Actuator",
    current: "12A",
    marks: ["UL", "CE", "RoHS"],
  });
  const ID_REPLY = JSON.stringify({ model: "DGM200R-AZAC", partNumber: "AZM911AC-D" });

  const route = (p: string) =>
    p.includes("TRANSCRIPTION") ? OCR_REPLY : p.includes("IDENTIFIER") ? ID_REPLY : SEMANTIC_REPLY;

  const img = { base64: "AA==", mimeType: "image/jpeg" };

  it("prefers the deterministically parsed current over the model's", async () => {
    const r = await runMultiPass(img, { call: stub(route) });
    expect(r.fields.current.value).toBe("1.27A");
    expect(r.fields.current.alternatives.map((a) => a.value)).toContain("12A");
  });

  it("recovers the catalog number the semantic pass dropped", async () => {
    const r = await runMultiPass(img, { call: stub(route) });
    expect(r.fields.catalogNumber.value).toBe("AZM911AC-D");
    expect(r.fields.catalogNumber.agreementCount).toBe(2);
  });

  it("keeps the semantic pass's equipment type, which OCR alone cannot infer", async () => {
    const r = await runMultiPass(img, { call: stub(route) });
    expect(r.fields.equipmentType.value).toBe("Hollow Rotary Actuator");
  });

  it("survives a dead pass instead of losing the whole read", async () => {
    const flaky: VisionCall = async ({ prompt }) => {
      if (prompt.includes("IDENTIFIER")) throw new Error("recognizer_provider_error_503");
      return { text: route(prompt), model: "stub" };
    };
    const r = await runMultiPass(img, { call: flaky });
    expect(r.errors).toHaveLength(1);
    expect(r.fields.current.value).toBe("1.27A");
  });

  it("throws only when every pass fails", async () => {
    const dead: VisionCall = async () => {
      throw new Error("recognizer_provider_error_500");
    };
    await expect(runMultiPass(img, { call: dead })).rejects.toThrow("recognizer_provider_error_500");
  });

  it("returns the documented evidence shape for every field", async () => {
    const r = await runMultiPass(img, { call: stub(route) });
    for (const f of Object.values(r.fields)) {
      expect(f).toHaveProperty("value");
      expect(f).toHaveProperty("rawText");
      expect(typeof f.confidence).toBe("number");
      expect(typeof f.agreementCount).toBe("number");
      expect(typeof f.passesSeen).toBe("number");
    }
    expect(Object.keys(evidenceToValues(r.fields))).toContain("catalogNumber");
  });

  it("does not mutate the image it was handed", async () => {
    const input = { base64: "AA==", mimeType: "image/jpeg" };
    const before = JSON.stringify(input);
    await runMultiPass(input, { call: stub(route) });
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ── Header-only preprocessing ────────────────────────────────────────────────

describe("inspectImage", () => {
  it("reads PNG dimensions from the header", () => {
    const png = new Uint8Array(26);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(16, 800);
    new DataView(png.buffer).setUint32(20, 500);
    const info = inspectImage(png);
    expect(info).toMatchObject({ format: "png", width: 800, height: 500 });
  });

  it("reports unknown for a non-image buffer instead of throwing", () => {
    expect(inspectImage(new Uint8Array([1, 2, 3, 4]))).toMatchObject({ format: "unknown" });
  });

  it("maps EXIF orientation to a clockwise rotation", () => {
    expect(rotationDegreesFor(1)).toBe(0);
    expect(rotationDegreesFor(6)).toBe(90);
    expect(rotationDegreesFor(3)).toBe(180);
    expect(rotationDegreesFor(8)).toBe(270);
    expect(rotationDegreesFor(null)).toBe(0);
  });

  it("says nothing when there is nothing to say", () => {
    expect(orientationHint(inspectImage(new Uint8Array([1, 2, 3])))).toBeNull();
  });
});

// ── Anchored identity lookup (internet-100 field-assignment fix) ─────────────
//
// The benchmark's dominant genuine defect was correctly-READ strings slotted
// into the wrong identity field. anchoredValueFor is the deterministic layer
// that answers "which value does the PLATE label as this field?" — these
// fixtures are lifted from real failing samples.

import { anchoredValueFor } from "../nameplate/passes";

describe("anchoredValueFor — printed label anchors", () => {
  it("anchors the Siemens 1P article number as catalogNumber (web CU320 case)", () => {
    const lines = ["SIEMENS", "SINAMICS", "CONTROL UNIT CU320-2 PN", "1P 6SL3040-1MA01-0AA0", "S T-P96166484"];
    expect(anchoredValueFor("catalogNumber", lines)?.value).toBe("6SL3040-1MA01-0AA0");
  });

  it("anchors the Siemens bare-S data-identifier line as the FULL serial (T- prefix kept)", () => {
    const lines = ["1P 6SL3040-1MA01-0AA0", "S T-P96166484", "A5E31885465"];
    expect(anchoredValueFor("serialNumber", lines)?.value).toBe("T-P96166484");
  });

  it("anchors SER NO rows (web-006: 'SER NO J10' was mispromoted as J110)", () => {
    expect(anchoredValueFor("serialNumber", ["FRAME J56Z", "SER NO J10"])?.value).toBe("J10");
  });

  it("finds a model on the ADJACENT line when the keyword stands alone (real Oriental OCR order)", () => {
    const lines = ["DGM200R-AZAC", "MODEL", "HOLLOW ROTARY ACTUATORS"];
    expect(anchoredValueFor("model", lines)?.value).toBe("DGM200R-AZAC");
  });

  it("does NOT anchor a frame size, bearing number, or RPM row as an identity", () => {
    const lines = ["FRAME J56Z", "OPP END BRG 6203-2Z-J/C3", "TR/MIN-RPM 1770", "HP 15"];
    expect(anchoredValueFor("model", lines)).toBeNull();
    expect(anchoredValueFor("catalogNumber", lines)).toBeNull();
    expect(anchoredValueFor("serialNumber", lines)).toBeNull();
  });

  it("does not let a prose neighbor satisfy an adjacency anchor", () => {
    // "MADE IN JAPAN" next to a keyword-only SERIAL line must not become the serial.
    expect(anchoredValueFor("serialNumber", ["SERIAL", "MADE IN JAPAN"])).toBeNull();
    // A spaced description next to "MODEL" must not become the model.
    expect(anchoredValueFor("model", ["MODEL", "HOLLOW ROTARY ACTUATORS"])).toBeNull();
  });

  it("anchors TYPE rows as a model anchor (GE 'TYPE 5K444AK456')", () => {
    expect(anchoredValueFor("model", ["TYPE 5K444AK456", "FRAME 444TS"])?.value).toBe("5K444AK456");
  });
});
