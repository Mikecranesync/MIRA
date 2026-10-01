import { describe, expect, it } from "vitest";
import { PART_SEARCH_CANCEL, asksPartCompatibility, confirmedPartSearchCandidate, explicitManualLookupRequest, partSearchConfirmation, partSearchDecision, unambiguousPartNumber } from "./photo-part-lookup";

describe("photo part lookup", () => {
  it("uses one label-shaped code as a lookup candidate without asserting what it is", () => {
    expect(unambiguousPartNumber("Label reads Ni8U-S12-AP6; wiring: 1BN+ 3BU- 4BK")).toBe("Ni8U-S12-AP6");
  });

  it("refuses to choose when multiple label codes are present", () => {
    expect(unambiguousPartNumber("P/N Ni8U-S12-AP6; alternate Ni8U-S12-AP8")).toBeNull();
  });

  it("accepts a contiguous code only when the label marks it as a part/catalog number", () => {
    expect(unambiguousPartNumber("P/N 6AV2124-0GC01-0AX0; Serial P96166484")).toBe("6AV2124-0GC01-0AX0");
    expect(unambiguousPartNumber("P/N 6AV21240GC010AX0")).toBe("6AV21240GC010AX0");
    expect(unambiguousPartNumber("Label P96166484")).toBeNull();
  });

  it("does not treat short wire markings or retail barcodes as a part number", () => {
    expect(unambiguousPartNumber("1BN+ 3BU- 4BK X0026E67QS")).toBeNull();
    expect(unambiguousPartNumber("1P 230VAC, 50/60Hz")).toBeNull();
  });

  it("never selects an explicitly marked serial number", () => {
    expect(unambiguousPartNumber("P/N Ni8U-S12-AP6; Serial: AB-1234567")).toBe("Ni8U-S12-AP6");
  });

  it.each(["Look up the PDF manual", "Can you find the datasheet?"]) (
    "recognizes an explicit manual lookup: %s",
    (q) => expect(explicitManualLookupRequest(q)).toBe(true),
  );

  it("does not turn a generic help question into a web search", () => {
    expect(explicitManualLookupRequest("What does this part do?")).toBe(false);
  });

  it("recognizes compatibility questions without deciding compatibility", () => {
    expect(asksPartCompatibility("Is M12 a substitute for S12?")).toBe(true);
    expect(asksPartCompatibility("Can I use my M12 instead of this S12?")).toBe(true);
    expect(asksPartCompatibility("What does S12 mean?")).toBe(false);
  });
});

describe("#4150 Codex r1 — egress and parsing defects", () => {
  it.each([
    'Serial: "AB-1234567"',
    'S/N: "AB-1234567"',
    "SN: AB-1234567",
    "SN AB-1234567",
    "Serial No. 'AB-1234567'",
  ])("F1: a serial-only label, however quoted, yields no search key: %s", (label) => {
    expect(unambiguousPartNumber(label)).toBeNull();
  });

  it("F1: a quoted serial does not hide a separate part number", () => {
    expect(unambiguousPartNumber('P/N Ni8U-S12-AP6; Serial: "AB-1234567"')).toBe("Ni8U-S12-AP6");
  });

  it.each([
    "Do not look up the manual",
    "Don't search for the manual yet",
    "Before you search for the manual, tell me what you can read",
    "I could not find the manual. What is visible in this photo?",
    "Never download the PDF",
  ])("F2: a negated, deferred or descriptive mention is not a lookup request: %s", (q) => {
    expect(explicitManualLookupRequest(q)).toBe(false);
  });

  it.each(["Look up the PDF manual", "Can you find the datasheet?", "Please search for the manual", "Find me the manual for this"])(
    "F2 control: an affirmative request still counts: %s",
    (q) => expect(explicitManualLookupRequest(q)).toBe(true),
  );

  it("F4: a sentence-ending period is prose, not part of the part number", () => {
    expect(unambiguousPartNumber("P/N 6AV2124-0GC01-0AX0.")).toBe("6AV2124-0GC01-0AX0");
  });

  it("F4: a quoted contiguous part number is still read", () => {
    expect(unambiguousPartNumber('P/N "6AV21240GC010AX0"')).toBe("6AV21240GC010AX0");
  });

  it("F4 control: two genuinely different codes are still refused", () => {
    expect(unambiguousPartNumber("P/N 6AV2124-0GC01-0AX0. Alt 6AV2124-0GC01-0AX1.")).toBeNull();
  });
});

describe("#4150 Codex r2 — fail closed on serials and on non-requests", () => {
  it.each([
    "S/N = AB-1234567",
    "Serial number (AB-1234567)",
    "Serial number is AB-1234567",
    "SERIAL NO: AB-1234567",
    "Serial: AB-1234567 Mfg 2021",
  ])("F1: any serial-field format yields no search key: %s", (label) => {
    expect(unambiguousPartNumber(label)).toBeNull();
  });

  it("F1: with a serial present, only an explicitly labelled part number is accepted", () => {
    expect(unambiguousPartNumber("Serial number is AB-1234567. P/N Ni8U-S12-AP6")).toBe("Ni8U-S12-AP6");
    expect(unambiguousPartNumber("Serial number is AB-1234567. Ni8U-S12-AP6")).toBeNull();
  });

  it.each([
    "I will look up the manual myself later.",
    "Look up the manual? No, just read the label.",
    'The label says "find the manual online". What is visible?',
    "Can you explain how to search for the manual without doing it?",
    "I can't find the manual, can you look it up?",
  ])("F2: not an affirmative request to MIRA: %s", (q) => {
    expect(explicitManualLookupRequest(q)).toBe(false);
  });

  it.each([
    "Look up the PDF manual",
    "Can you find the datasheet?",
    "Please search for the manual",
    "Find me the manual for this",
    "Could you please download the PDF manual?",
    "What is this part? Look up the manual.",
  ])("F2 control: an affirmative request addressed to MIRA still counts: %s", (q) => {
    expect(explicitManualLookupRequest(q)).toBe(true);
  });
});


describe("#4150 owner decision — search only after an exact, one-time confirmation", () => {
  const CANDIDATE = "6ES7214-1AG40-0XB0";
  const proposed = { kind: "part_search_proposal", candidate: CANDIDATE };

  it.each(["AB-1234567 (S/N)", "S.N. AB-1234567", "S/N = AB-1234567", "Serial number is AB-1234567"])(
    "reported serial form is never a candidate: %s",
    (label) => expect(unambiguousPartNumber(label)).toBeNull(),
  );

  it("the confirmation text names the exact candidate and parses back to it", () => {
    expect(partSearchConfirmation(CANDIDATE)).toBe(`Search the web for "${CANDIDATE}"`);
    expect(confirmedPartSearchCandidate(partSearchConfirmation(CANDIDATE))).toBe(CANDIDATE);
    expect(confirmedPartSearchCandidate("please look it up")).toBeNull();
  });

  it("a request only proposes; it never authorizes a search", () => {
    expect(partSearchDecision({ message: "Look up the PDF manual", candidate: CANDIDATE, previousEvidence: [] }))
      .toEqual({ action: "propose", candidate: CANDIDATE });
  });

  it.each([
    "Look up the manual. Actually, cancel that.",
    "Find the manual locally only.",
    "Look up the manual tomorrow.",
    "Do not look up the manual",
  ])("a withdrawn, restricted or negated request does not even propose: %s", (message) => {
    expect(partSearchDecision({ message, candidate: CANDIDATE, previousEvidence: [] }).action).toBe("none");
  });

  it("positive control: the exact confirmation after a matching proposal searches that string", () => {
    expect(partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: CANDIDATE, previousEvidence: [proposed] }))
      .toEqual({ action: "search", candidate: CANDIDATE });
  });

  it("a confirmation with no pending proposal does not search", () => {
    expect(partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: CANDIDATE, previousEvidence: [] }).action)
      .toBe("mismatch");
  });

  it("a confirmation for a different candidate does not search", () => {
    const other = "6ES7214-1AG40-0XB1";
    expect(partSearchDecision({ message: partSearchConfirmation(other), candidate: CANDIDATE, previousEvidence: [proposed] }).action)
      .toBe("mismatch");
  });

  it("a changed photo candidate invalidates the earlier confirmation", () => {
    expect(partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: "Ni8U-S12-AP6", previousEvidence: [proposed] }).action)
      .toBe("mismatch");
    expect(partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: null, previousEvidence: [proposed] }).action)
      .toBe("mismatch");
  });

  it("cancel after a proposal is acknowledged and never searches", () => {
    expect(partSearchDecision({ message: PART_SEARCH_CANCEL, candidate: CANDIDATE, previousEvidence: [proposed] }))
      .toEqual({ action: "cancelled", candidate: CANDIDATE });
  });

  it("the confirmation must be exact: extra words are not a confirmation", () => {
    expect(confirmedPartSearchCandidate(`${partSearchConfirmation(CANDIDATE)} and also the other one`)).toBeNull();
    expect(confirmedPartSearchCandidate(`Don't ${partSearchConfirmation(CANDIDATE)}`)).toBeNull();
  });
});

describe("#4150 review r4 F1 — any serial label disables unlabelled extraction", () => {
  it.each(["AB-1234567 S/N", "AB-1234567 serial number", "AB-1234567 SN", "AB-1234567 — Serial"])(
    "an unbracketed suffix serial label never yields a candidate: %s",
    (label) => {
      expect(unambiguousPartNumber(label)).toBeNull();
      expect(partSearchDecision({ message: "Look up the PDF manual", candidate: unambiguousPartNumber(label), previousEvidence: [] }).action).toBe("none");
    },
  );

  it("control: an explicitly labelled part number next to a suffix serial is still proposed", () => {
    expect(unambiguousPartNumber("AB-1234567 S/N. P/N 6ES7214-1AG40-0XB0")).toBe("6ES7214-1AG40-0XB0");
  });
});

// #4171 Codex r1 F3/F4: the proposal binds the WHOLE identity that will be
// sent (part + nullable maker), and a consumed proposal authorizes nothing.
describe("partSearchDecision — identity binding and one-time use", () => {
  const confirm = 'Search the web for "SS5Y3-DUW01302"';
  const proposal = (manufacturer: string | null | undefined) => [
    { kind: "part_search_proposal", candidate: "SS5Y3-DUW01302", ...(manufacturer === undefined ? {} : { manufacturer }) },
  ];

  it("searches when part AND maker match the proposal", () => {
    expect(
      partSearchDecision({ message: confirm, candidate: "SS5Y3-DUW01302", manufacturer: "SMC", previousEvidence: proposal("SMC") }),
    ).toEqual({ action: "search", candidate: "SS5Y3-DUW01302" });
  });

  it("does not search when the maker appeared after a part-only proposal", () => {
    expect(
      partSearchDecision({ message: confirm, candidate: "SS5Y3-DUW01302", manufacturer: "SMC", previousEvidence: proposal(null) }).action,
    ).toBe("mismatch");
  });

  it("does not search when the maker changed", () => {
    expect(
      partSearchDecision({ message: confirm, candidate: "SS5Y3-DUW01302", manufacturer: "FESTO", previousEvidence: proposal("SMC") }).action,
    ).toBe("mismatch");
  });

  it("a legacy proposal without a maker field binds a maker-less search only", () => {
    expect(
      partSearchDecision({ message: confirm, candidate: "SS5Y3-DUW01302", manufacturer: null, previousEvidence: proposal(undefined) }).action,
    ).toBe("search");
  });

  it("a consumed proposal authorizes nothing", () => {
    const consumed = [...proposal("SMC"), { kind: "part_search_proposal_consumed" }];
    expect(
      partSearchDecision({ message: confirm, candidate: "SS5Y3-DUW01302", manufacturer: "SMC", previousEvidence: consumed }).action,
    ).toBe("mismatch");
  });
});
