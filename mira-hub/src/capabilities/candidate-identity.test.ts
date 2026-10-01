import { describe, it, expect } from "vitest";
import { extractCandidateIdentity, isSafeCandidateSearchIdentity, makerFromText, wantsManualDocumentation } from "./candidate-identity";

// Manual-First PRD R1 (#4160 S5): a candidate (manufacturer, part) read from a
// LOOK observation or typed text WITHOUT consulting the corpus. Makers come
// from the one shared OEM maker table (manual-discovery.ts OEM_HOSTS); the part
// comes from the serial-safe photo reader (photo-part-lookup.ts, #4150).

describe("extractCandidateIdentity — the PRD acceptance cases", () => {
  it("reads the SMC valve label (the trace that started Manual-First)", () => {
    const obs = "Blue SMC solenoid valve. Label text: SMC SS5Y3-DUW01302 24VDC";
    expect(extractCandidateIdentity(obs)).toEqual({ manufacturer: "SMC", part: "SS5Y3-DUW01302" });
  });

  it("reads the #4148 sensor part with no recognisable maker", () => {
    const obs = "Cylindrical sensor, printed: Ni8U-S12-AP6 / 1BN+ 3BU- 4B";
    expect(extractCandidateIdentity(obs)).toEqual({ manufacturer: null, part: "Ni8U-S12-AP6" });
  });
});

describe("extractCandidateIdentity — 20 non-label observations extract nothing", () => {
  const nonLabel = [
    "A gray electrical cabinet with the door open and several wires visible.",
    "Conveyor belt section, slightly worn, no visible markings.",
    "Close-up of a hydraulic hose with a small leak near the fitting.",
    "Motor housing covered in dust; the nameplate is not visible in this photo.",
    "Two terminal blocks with blue and brown wires, no printed text legible.",
    "Blurry photo of a control panel; text is unreadable.",
    "A pressure gauge reading approximately 80 psi.",
    "Rusty bolt on a mounting bracket.",
    "Photo of a technician's hand holding a multimeter showing 230 V.",
    "Belt guard removed; pulley and belt visible.",
    "Date stamp on the box: 2026-09-30.",
    "Supply range printed on the label: 380-480VAC 50/60Hz.",
    "Fuse rated 10A 250V.",
    "Serial number S/N AB-1234567 on a silver sticker.",
    "AB-1234567 (S/N) printed beside the barcode.",
    "S.N. AB-1234567 engraved on the plate.",
    "The panel says DANGER HIGH VOLTAGE in red letters.",
    "Green indicator light on, amber light off.",
    "Air filter element looks clogged with dust.",
    "A pallet of cardboard boxes next to the machine.",
  ];
  it.each(nonLabel)("nothing from: %s", (obs) => {
    expect(extractCandidateIdentity(obs)).toBeNull();
  });
});

describe("extractCandidateIdentity — serial safety and ambiguity", () => {
  it("never returns a serial number as the part, even with a maker present", () => {
    expect(extractCandidateIdentity("SMC valve, Serial No. 7Y2K-88412-Z9")).toBeNull();
  });

  it("an explicitly labelled part survives a separate serial field", () => {
    expect(extractCandidateIdentity("SMC  P/N: SS5Y3-DUW01302  S/N: 7Y2K-88412-Z9")).toEqual({
      manufacturer: "SMC",
      part: "SS5Y3-DUW01302",
    });
  });

  it("two different part codes on one label are ambiguous: nothing", () => {
    expect(extractCandidateIdentity("SMC SS5Y3-DUW01302 and SY5120-5LZD-01")).toBeNull();
  });

  it("a maker alone is not a candidate identity", () => {
    expect(extractCandidateIdentity("An SMC valve manifold, label worn off.")).toBeNull();
  });

  it("falls back to the typed text when the photo has no part", () => {
    expect(extractCandidateIdentity("Valve, label unreadable.", "it's an SMC SS5Y3-DUW01302")).toEqual({
      manufacturer: "SMC",
      part: "SS5Y3-DUW01302",
    });
  });

  it("a photo part wins over a different typed part", () => {
    expect(extractCandidateIdentity("SMC SS5Y3-DUW01302", "maybe SY5120-5LZD-01?")?.part).toBe("SS5Y3-DUW01302");
  });
});

describe("makerFromText — the shared OEM maker table, corpus-independent", () => {
  it("recognises makers case-insensitively when the name is not an English word", () => {
    expect(makerFromText("festo cylinder DSBC-32-50")).toBe("FESTO");
    expect(makerFromText("Allen-Bradley PowerFlex 525")).toBe("ALLEN-BRADLEY");
  });

  it("dictionary-word makers count only when written in capitals, as on a label", () => {
    expect(makerFromText("SICK WL12-3P2431 photoelectric")).toBe("SICK");
    expect(makerFromText("the operator felt sick near the conveyor")).toBeNull();
    expect(makerFromText("a banner hung over the line")).toBeNull();
    expect(makerFromText("BANNER Q4X sensor")).toBe("BANNER");
  });

  it("two different makers on one label are ambiguous: no maker", () => {
    expect(makerFromText("SIEMENS drive with an SMC valve")).toBeNull();
  });

  it("aliases of one maker are not ambiguous", () => {
    expect(makerFromText("Rockwell Automation / Allen-Bradley 1756-L83E")).not.toBeNull();
  });

  it("a maker name inside another word does not count", () => {
    expect(makerFromText("SMCX-200 adapter")).toBeNull();
  });
});

describe("wantsManualDocumentation — #4160 S6 candidate-basis trigger, half 1 of PRD R2", () => {
  it("recognises an explicit ask for the manual/documentation", () => {
    expect(wantsManualDocumentation("can you find the manual for this?")).toBe(true);
    expect(wantsManualDocumentation("do you have documentation for this part?")).toBe(true);
    expect(wantsManualDocumentation("I need the datasheet")).toBe(true);
    expect(wantsManualDocumentation("look up the data sheet")).toBe(true);
    expect(wantsManualDocumentation("any instructions for this valve?")).toBe(true);
    expect(wantsManualDocumentation("where's the user guide")).toBe(true);
    expect(wantsManualDocumentation("need the service manual")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(wantsManualDocumentation("MANUAL please")).toBe(true);
  });

  it("word-boundary discipline both directions — never a substring hit", () => {
    // front boundary: "manual" must not match inside a longer word
    expect(wantsManualDocumentation("manually operated valve")).toBe(false);
    expect(wantsManualDocumentation("docset is out of date")).toBe(false);
    // back boundary: the word before "manual"/"docs" must not glue onto it
    expect(wantsManualDocumentation("aeromanuals are different")).toBe(false);
    expect(wantsManualDocumentation("thedocs repo")).toBe(false);
  });

  it("control: an ordinary troubleshooting question never matches", () => {
    expect(wantsManualDocumentation("why is this valve not actuating")).toBe(false);
    expect(wantsManualDocumentation("is this part compatible with my cylinder")).toBe(false);
  });
});

// Codex post-cap F6/F5 (#4172): ONE validator for every candidate identity
// that may leave as a search — serials and ambiguity across BOTH inputs.
describe("isSafeCandidateSearchIdentity", () => {
  const SERIAL_PHOTO = "Siemens S/N: 6AV2124-0GC01-0AX0";
  it("rejects a photo serial even when the technician types it back", () => {
    expect(isSafeCandidateSearchIdentity(SERIAL_PHOTO, "Find the manual for Siemens 6AV2124-0GC01-0AX0", "6AV2124-0GC01-0AX0", "Siemens")).toBe(false);
  });
  it("rejects a typed serial", () => {
    expect(isSafeCandidateSearchIdentity("", "manual for S/N 6AV2124-0GC01-0AX0", "6AV2124-0GC01-0AX0", "Siemens")).toBe(false);
  });
  it("rejects a value beside an unparsed serial label unless it is the labelled part", () => {
    expect(isSafeCandidateSearchIdentity("AB-1234567 serial number", "", "AB-1234567", "Siemens")).toBe(false);
  });
  it("strict: any serial label in either text means no automatic search, even beside a labelled part", () => {
    expect(isSafeCandidateSearchIdentity("Siemens P/N: 6ES7214-1AG40-0XB0 S/N: XC-99887766", "Find the manual for this", "6ES7214-1AG40-0XB0", "Siemens")).toBe(false);
    // Codex post-cap 3 F6: a normalised serial typed back ("TP 700" -> TP700).
    expect(isSafeCandidateSearchIdentity("S/N: TP 700", "Find the manual for Siemens TP700", "TP700", "Siemens")).toBe(false);
  });
  it("strict: an identity the serial-safe reader did not produce never auto-searches", () => {
    expect(isSafeCandidateSearchIdentity("", "Find the manual for my Allen-Bradley SLC 5/03", "SLC 5/03", "Allen-Bradley")).toBe(false);
  });
  it("strict: two labelled part numbers are ambiguous, not absent (Codex post-cap 3 F5)", () => {
    expect(isSafeCandidateSearchIdentity("Controller P/N: 1769-L33ER and P/N: 1769-L24ER", "Find the manual for my Allen-Bradley SLC 5/03", "SLC 5/03", "Allen-Bradley")).toBe(false);
    expect(isSafeCandidateSearchIdentity("Controller P/N: 1769-L33ER and P/N: 1769-L24ER", "", "1769-L33ER", "Allen-Bradley")).toBe(false);
  });
  it("rejects a maker that either text contradicts (Codex post-cap 4 F8)", () => {
    expect(isSafeCandidateSearchIdentity("Blue valve. Label: SMC SS5Y3-DUW01302", "Find the manual for Siemens SS5Y3-DUW01302", "SS5Y3-DUW01302", "Siemens")).toBe(false);
    // A proposed maker the OEM table does not know cannot be checked against a
    // maker the text DOES name — fail closed.
    expect(isSafeCandidateSearchIdentity("Label: SMC SS5Y3-DUW01302", "", "SS5Y3-DUW01302", "Acme Widgets")).toBe(false);
  });
  it("control: the proposed maker matching the one the text names is accepted", () => {
    expect(isSafeCandidateSearchIdentity("Label: SMC SS5Y3-DUW01302", "Find the manual for this", "SS5Y3-DUW01302", "SMC")).toBe(true);
  });
  it("rejects a value under an abbreviated serial label (Codex post-cap 7 F12)", () => {
    expect(isSafeCandidateSearchIdentity("SMC Ser. No. AB-1234567", "Find the manual for this", "AB-1234567", "SMC")).toBe(false);
    expect(isSafeCandidateSearchIdentity("SMC SER: AB-1234567", "Find the manual for this", "AB-1234567", "SMC")).toBe(false);
  });
  it("rejects any turn whose photo or typed text carries an asset-tag label (Codex post-cap 14 F14)", () => {
    expect(isSafeCandidateSearchIdentity("SMC Asset tag: VALVE-1234", "Find the manual for this", "VALVE-1234", "SMC")).toBe(false);
    expect(isSafeCandidateSearchIdentity("SMC P/N: SY3120-5LZD Asset tag: VALVE-1234", "Find the manual for this", "SY3120-5LZD", "SMC")).toBe(false);
    expect(isSafeCandidateSearchIdentity("SMC P/N: SY3120-5LZD", "asset id AB-1234567, find the manual", "SY3120-5LZD", "SMC")).toBe(false);
  });
  it("control: the single serial-safe code, in the photo or the typed text, is accepted", () => {
    expect(isSafeCandidateSearchIdentity("Siemens P/N: 6ES7214-1AG40-0XB0", "Find the manual for this", "6ES7214-1AG40-0XB0", "Siemens")).toBe(true);
    expect(isSafeCandidateSearchIdentity("", "Find the manual for the SMC SS5Y3-DUW01302", "SS5Y3-DUW01302", "SMC")).toBe(true);
  });
  it("rejects a photo that names two machines", () => {
    expect(isSafeCandidateSearchIdentity("Siemens 6ES7214-1AG40-0XB0 and TP700", "Find the manual for this", "TP700", "Siemens")).toBe(false);
    expect(isSafeCandidateSearchIdentity("Siemens 6ES7214-1AG40-0XB0 and TP700", "Find the manual for this", "6ES7214-1AG40-0XB0", "Siemens")).toBe(false);
  });
  it("rejects a second machine split across photo and typed text", () => {
    expect(isSafeCandidateSearchIdentity("Siemens P/N 6ES7214-1AG40-0XB0", "and the TP700 too", "6ES7214-1AG40-0XB0", "Siemens")).toBe(false);
  });
  it("rejects a candidate that differs from an explicitly labelled part in either text", () => {
    // A P/N label must not hide a second machine (Codex post-cap 2 F5).
    expect(isSafeCandidateSearchIdentity("Siemens P/N: 6ES7214-1AG40-0XB0 and TP700", "Find the manual for this", "TP700", "Siemens")).toBe(false);
    expect(isSafeCandidateSearchIdentity("Controller P/N: 6ES7214-1AG40-0XB0", "Find the manual for my Allen-Bradley SLC 5/03", "SLC 5/03", "Allen-Bradley")).toBe(false);
  });
  it("accepts a single-machine photo and a neutral question", () => {
    expect(isSafeCandidateSearchIdentity("Blue solenoid valve. Label text: SMC SS5Y3-DUW01302 24VDC", "Find the manual for this", "SS5Y3-DUW01302", "SMC")).toBe(true);
    // TP700 is not a serial-safe part code, so under the strict rule it never
    // auto-searches (#4173 tracks short models).
    expect(isSafeCandidateSearchIdentity("Siemens TP700 Comfort panel, 24 VDC", "Find the manual for this", "TP700", "Siemens")).toBe(false);
  });
  it("fails closed on a panel model beside a different order-number code (accepted cost of the narrowing)", () => {
    // Even when both describe one panel, two distinct identities never auto-search;
    // the technician can still confirm the machine and bind it.
    expect(isSafeCandidateSearchIdentity("Siemens TP700 Comfort 6AV2124-0GC01-0AX0", "", "TP700", "Siemens")).toBe(false);
  });
});

// #4160 gate NO-GO: "Typed maker+model doesn't trigger the search". Root cause:
// a maker whose name is also an English word (Banner, Sick, Parker, …) counted
// only in ALL CAPS — right for a printed LABEL, wrong for a technician TYPING
// "Banner Q4XTBLAF300-Q8". In typed text such a maker now counts when it is
// capitalised AND the part code follows within a few words.
describe("#4160 gate — typed dictionary-word makers next to a part code", () => {
  it.each([
    ["I need the manual for a Banner Q4XTBLAF300-Q8", "BANNER", "Q4XTBLAF300-Q8"],
    ["manual for my Sick WL12-3P2431 photo eye", "SICK", "WL12-3P2431"],
    ["Parker valve D1VW-001CNJW manual please", "PARKER", "D1VW-001CNJW"],
  ])("%s → %s / %s", (typed, maker, part) => {
    expect(extractCandidateIdentity("", typed)).toEqual({ manufacturer: maker, part });
    expect(isSafeCandidateSearchIdentity("", typed, part, maker)).toBe(true);
  });

  it.each([
    ["a banner Q4XTBLAF300-Q8 manual", "lowercase is an ordinary word"],
    ["Sick of this sensor. Need the manual for Q4XTBLAF300-Q8", "the word is far from the part code"],
    ["Sick. Manual for Q4XTBLAF300-Q8", "a sentence ends between the word and the part code"],
    ["Sick of this Q4XTBLAF300-Q8, need the manual", "Codex #4184 F1: an ordinary word sits between them"],
    ["Banner is wrong on the Q4XTBLAF300-Q8 manual", "a verb sits between them"],
    ["Manual for Sick or Banner Q4XTBLAF300-Q8", "Codex #4184 F3: two makers named as alternatives"],
    ["Manual for Banner or Sick Q4XTBLAF300-Q8", "Codex #4184 F3: reversed order"],
    ["Banner at the gate fell down, so I need the long datasheet for the old Q4XTBLAF300-Q8 again", "more than a few words away"],
  ])("control: %s → no maker (%s)", (typed) => {
    expect(extractCandidateIdentity("", typed)?.manufacturer ?? null).toBeNull();
  });

  it("Codex #4184 F3: the safety gate also declines coordinated typed makers", () => {
    expect(isSafeCandidateSearchIdentity("", "Manual for Sick or Banner Q4XTBLAF300-Q8", "Q4XTBLAF300-Q8", "BANNER")).toBe(false);
    expect(isSafeCandidateSearchIdentity("", "Manual for Banner or Sick Q4XTBLAF300-Q8", "Q4XTBLAF300-Q8", "SICK")).toBe(false);
  });

  it("known limit (unchanged safety gate): naming the family AND the part still declines the automatic search", () => {
    // The maker is now read, but namesOnlyThisMachine (the strict multi-machine
    // gate, owner-settled in #4172) does not treat "Q4X" and "Q4XTBLAF300-Q8"
    // as one machine, so the turn fails closed — no automatic search.
    const typed = "Find the manual for the Banner Q4X sensor, part Q4XTBLAF300-Q8";
    expect(extractCandidateIdentity("", typed)).toEqual({ manufacturer: "BANNER", part: "Q4XTBLAF300-Q8" });
    expect(isSafeCandidateSearchIdentity("", typed, "Q4XTBLAF300-Q8", "BANNER")).toBe(false);
  });

  it("control: a printed LABEL still needs capitals — the photo rule is unchanged", () => {
    expect(extractCandidateIdentity("Banner Q4XTBLAF300-Q8", "")?.manufacturer ?? null).toBeNull();
    expect(extractCandidateIdentity("BANNER Q4XTBLAF300-Q8", "")).toEqual({ manufacturer: "BANNER", part: "Q4XTBLAF300-Q8" });
  });

  it("control: makerFromText (used for label text) is unchanged", () => {
    expect(makerFromText("Banner Q4XTBLAF300-Q8")).toBeNull();
  });
});
