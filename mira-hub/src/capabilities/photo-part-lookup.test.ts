import { describe, expect, it } from "vitest";
import { PART_SEARCH_CANCEL, asksPartCompatibility, confirmedPartSearchCandidate, explicitManualLookupRequest, partSearchConfirmation, mentionsAssetLabel, mentionsSerialLabel, partSearchDecision, unambiguousPartNumber } from "./photo-part-lookup";
import { resolveModelFromObservationText } from "@/lib/manual-rag";

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

  it.each([
    "I think this means I just need to use a handheld on that seat. It's white on the tablet instead of being green",
    "Why is the indicator red instead of green?",
    "Red instead of green",
    "I think I need to use a handheld on that seat it is white on the tablet instead of being green",
    "I use the handheld and the display shows 1 instead of 0",
    "It shows 1 instead of 0. What does that mean?",
    "The gateway is offline instead of online",
    "The LED is white instead of green. What should I check?",
    "The LED is white instead of green. Can I inspect it?", "The LED is white instead of green. What happened?", "The LED is white instead of green. Why did it turn red?",
  ])("does not treat a reported indication as a substitute-part request: %s", (q) => {
    expect(asksPartCompatibility(q)).toBe(false);
  });

  it.each([
    "Can I use this sensor instead of the original?",
    "Can I use my M12 instead of this S12? It is red instead of green.",
    "Is this replacement compatible? The indicator is red instead of green.",
    "Can I install this module instead of that one?",
    "Can I use this green wire instead of that white wire?",
    "Is white wire OK instead of green wire?",
    "Can I use a sensor that is rated for 24 V instead of 12 V?",
    "Is 24 V acceptable instead of 12 V?",
    "Can I use a sensor that is rated for 24 instead of 12?",
    "Can I use wire that is white instead of green?",
    "Can I install an LED that is white instead of green?",
    "Can I use an indicator which is white instead of green?",
    "Would a white LED work instead of green?",
    "Is a white LED safe instead of green?",
    "The LED is white instead of green; can I install it?",
    "Can I install this LED? It is white instead of green.", "It is white instead of green. What about installing this LED?", "It is white instead of green. Which LED should I choose?", "The LED is white instead of green. Is it legal?", "Is this LED legal? It is white instead of green.", "It is white instead of green. Can I run this LED?", "It is white instead of green. Would you recommend this LED?", "The LED is white instead of green; should I proceed?", "The LED is white instead of green. Is it permitted?", "Can this LED be installed? It is white instead of green.", "Would this LED work? It is white instead of green.", "The LED is white instead of green; would it work in this machine?", "Could this LED be used? It is white instead of green.", "It is white instead of green. Will this LED work?", "Does this LED work? It is white instead of green.", "It is white instead of green. Can this component be fitted?", "Will this component operate? It is white instead of green.",
    "The LED is white instead of green. Is it safe?", "The LED is white instead of green. Am I allowed to install this LED?", "The LED is white instead of green. Am I permitted to use it?", "The LED is white instead of green. OK to install it?", "The LED is white instead of green. Any reason not to use it?", "The LED is white instead of green. Mind if I install it?", "The LED is white instead of green. Install this LED.", "The LED is white instead of green. I want to install this LED.", "The LED is white instead of green. What is the safest LED to install?",
    "Is a white LED allowed instead of green?",
    "Is a white LED legal instead of green?",
    "Is an indicator that is white OK instead of green?",
    "Can I use this LED if it is white instead of green?",
  ])("keeps the compatibility gate for real substitution: %s", (q) => {
    expect(asksPartCompatibility(q)).toBe(true);
  });

  it.each(["RJ45-style port", "M12-like connector", "USB3-shaped socket"])(
    "does not mint a part label from descriptive vision prose: %s", (text) => {
      expect(unambiguousPartNumber(text)).toBeNull();
    },
  );

  it("keeps explicitly labelled codes as candidates without decoding them", () => {
    expect(unambiguousPartNumber("P/N RJ45-STYLE")).toBe("RJ45-STYLE");
  });

  it("does not let a connector description hide a real part label", () => {
    expect(unambiguousPartNumber("RJ45-style port. P/N Ni8U-S12-AP6")).toBe("Ni8U-S12-AP6");
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
  // #4193 Codex round 2 F3+F6: a legacy proposal (no `originTurnId`) anchors
  // its origin to the turn it currently sits on — `previousTurnId` below.
  const PREV_TURN_ID = "11111111-0000-0000-0000-000000000150";
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
    // #4193 Codex round 2 F3+F6: a FRESH propose carries NO origin from the
    // pure decision — the caller assigns one (this turn's own id) only once
    // it actually persists the proposal (see route.ts).
    expect(partSearchDecision({ message: "Look up the PDF manual", candidate: CANDIDATE, previousEvidence: [] }))
      .toEqual({ action: "propose", candidate: CANDIDATE, age: 1 });
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
    expect(
      partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: CANDIDATE,
        previousEvidence: [proposed],
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
  });

  it("a confirmation with no pending proposal does not search", () => {
    expect(partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: CANDIDATE, previousEvidence: [] }).action)
      .toBe("mismatch");
  });

  it("a confirmation for a different candidate does not search", () => {
    const other = "6ES7214-1AG40-0XB1";
    expect(
      partSearchDecision({
        message: partSearchConfirmation(other),
        candidate: CANDIDATE,
        previousEvidence: [proposed],
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });

  it("a changed photo candidate invalidates the earlier confirmation", () => {
    expect(
      partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: "Ni8U-S12-AP6",
        previousEvidence: [proposed],
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
    expect(
      partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: null,
        previousEvidence: [proposed],
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });

  it("cancel after a proposal is acknowledged and never searches", () => {
    expect(partSearchDecision({ message: PART_SEARCH_CANCEL, candidate: CANDIDATE, previousEvidence: [proposed] }))
      .toEqual({ action: "cancelled", candidate: CANDIDATE });
  });

  it("the confirmation must be exact: extra words are not a confirmation", () => {
    expect(confirmedPartSearchCandidate(`${partSearchConfirmation(CANDIDATE)} and also the other one`)).toBeNull();
    expect(confirmedPartSearchCandidate(`Don't ${partSearchConfirmation(CANDIDATE)}`)).toBeNull();
  });

  // #4193 Codex round 2 F3: fail closed when the origin cannot be resolved at
  // all (no `originTurnId` on the proposal AND no known `previousTurnId`) —
  // a search with nothing to atomically claim against must never run.
  it("a matching confirmation with no resolvable origin at all does not search", () => {
    expect(
      partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: CANDIDATE, previousEvidence: [proposed] }).action,
    ).toBe("mismatch");
  });
});

// #4185/#4186: the Pixel walk incident (#4160, c5941295415) — an unquoted or
// short-affirmative reply to a pending offer got an LLM answer ("I'm unable
// to browse the web… contact the manufacturer (SMC)") instead of being
// recognised as consent, and a non-matching reply silently dropped the offer.
describe("#4185/#4186 — tolerant search consent", () => {
  const CANDIDATE = "SS5Y3-DUW01302";
  // #4193 Codex round 2 F3+F6: these fixtures are TRUE legacy entries (no
  // `originTurnId`), so every test that expects a search to fire must supply
  // `previousTurnId` — the turn that fixture currently sits on — exactly as
  // route.ts always does when a pending proposal exists.
  const PREV_TURN_ID = "22222222-0000-0000-0000-000000004185";
  const proposed = (age?: number) => [
    { kind: "part_search_proposal", candidate: CANDIDATE, ...(age === undefined ? {} : { age }) },
  ];

  it("an unquoted confirmation, any case, is accepted", () => {
    expect(confirmedPartSearchCandidate(`search the web for ${CANDIDATE}`)).toBe(CANDIDATE);
    expect(
      partSearchDecision({
        message: `search the web for ${CANDIDATE}`,
        candidate: CANDIDATE,
        previousEvidence: proposed(),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
  });

  it("a curly-quoted confirmation is accepted (pinned control, not a regression)", () => {
    const curly = `Search the web for “${CANDIDATE}”`;
    expect(confirmedPartSearchCandidate(curly)).toBe(CANDIDATE);
    expect(
      partSearchDecision({ message: curly, candidate: CANDIDATE, previousEvidence: proposed(), previousTurnId: PREV_TURN_ID }),
    ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
  });

  it.each(["yes", "Yes", "search", "go ahead", "yes search", "yes search."])(
    "a short affirmative right after an offer confirms it: %s",
    (message) => {
      expect(
        partSearchDecision({ message, candidate: CANDIDATE, previousEvidence: proposed(), previousTurnId: PREV_TURN_ID }),
      ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
    },
  );

  it("a short affirmative with no pending offer does not propose or search", () => {
    expect(partSearchDecision({ message: "yes", candidate: CANDIDATE, previousEvidence: [] }).action).toBe("none");
  });

  it("an unquoted confirmation naming a part that was never offered is still refused", () => {
    expect(
      partSearchDecision({
        message: `Search the web for "OTHER-123"`,
        candidate: CANDIDATE,
        previousEvidence: proposed(),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
    expect(
      partSearchDecision({
        message: `search the web for OTHER-123`,
        candidate: CANDIDATE,
        previousEvidence: proposed(),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });

  it("a non-matching reply re-shows the offer instead of expiring it", () => {
    // #4193 Codex round 2 F3+F6: the re-show anchors its origin to the turn
    // the legacy fixture currently sits on (`previousTurnId`).
    expect(
      partSearchDecision({
        message: "What is the warranty on this?",
        candidate: CANDIDATE,
        previousEvidence: proposed(1),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "propose", candidate: CANDIDATE, age: 2, originTurnId: PREV_TURN_ID });
  });

  it("the offer stays valid for up to 3 subsequent turns — a late confirmation still searches", () => {
    // age:3 means this is the 3rd subsequent turn the offer has survived.
    expect(
      partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: CANDIDATE,
        previousEvidence: proposed(3),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
    expect(
      partSearchDecision({ message: "yes", candidate: CANDIDATE, previousEvidence: proposed(3), previousTurnId: PREV_TURN_ID }),
    ).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: PREV_TURN_ID });
  });

  it("the offer does not survive a 4th subsequent turn — neither confirms nor re-shows", () => {
    expect(
      partSearchDecision({
        message: partSearchConfirmation(CANDIDATE),
        candidate: CANDIDATE,
        previousEvidence: proposed(4),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
    expect(
      partSearchDecision({
        message: "What is the warranty on this?",
        candidate: CANDIDATE,
        previousEvidence: proposed(4),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "none" });
  });

  // #4193 Codex round 1 F2: the FIRST shipped version re-showed one more
  // time at the age limit, minting an age: 4 offer that
  // `pendingPartSearchProposal()` would never again treat as valid — an
  // offer the route rendered as actionable (a chip, "reply exactly: ...")
  // that the very next turn could not confirm. The fix stops one turn
  // earlier: no further proposal, just a plain statement that it expired.
  it("a non-matching reply AT the age limit ends the offer instead of re-proposing an unconfirmable one", () => {
    expect(
      partSearchDecision({
        message: "What is the warranty on this?",
        candidate: CANDIDATE,
        previousEvidence: proposed(3),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "expired", candidate: CANDIDATE });
  });

  // #4193 Codex round 2 F3+F6: every propose/re-show this function emits
  // must still be confirmable on the immediately following turn (never
  // minting an offer the app renders as actionable but the next turn cannot
  // act on), and every re-show must carry the SAME origin turn forward — NOT
  // the turn the re-shown COPY happens to live on — so the route's atomic
  // claim (part-search-claim.ts) locks and marks consumed on one canonical
  // row no matter which copy a later confirmation reads.
  it("every propose/re-show is confirmable on the immediately following turn, under one stable origin", () => {
    // Turn A: a fresh lookup request. No origin yet — the caller (here,
    // simulating route.ts) assigns one: THIS turn's own id.
    const ORIGIN = "33333333-0000-0000-0000-00000000000a";
    const fresh = partSearchDecision({ message: "Look up the PDF manual", candidate: CANDIDATE, previousEvidence: [] });
    expect(fresh).toEqual({ action: "propose", candidate: CANDIDATE, age: 1 });

    // Turn B: an unrelated reply re-shows it. The persisted copy from turn A
    // already carries `originTurnId: ORIGIN`; the re-show reads it off turn
    // A (previousTurnId = ORIGIN here, but that's irrelevant — the pending
    // entry's own originTurnId wins) and persists a NEW copy on turn B.
    const reshown = partSearchDecision({
      message: "What is the warranty on this?",
      candidate: CANDIDATE,
      previousEvidence: [{ kind: "part_search_proposal", candidate: CANDIDATE, age: 1, originTurnId: ORIGIN }],
      previousTurnId: ORIGIN,
    });
    expect(reshown).toEqual({ action: "propose", candidate: CANDIDATE, age: 2, originTurnId: ORIGIN });

    // Turn C: confirming the re-shown copy. Critically, `previousTurnId`
    // here is turn B (where the COPY lives) — a DIFFERENT turn from ORIGIN —
    // yet the resolved `originTurnId` must still be ORIGIN, because the
    // pending entry's own `originTurnId` always wins over `previousTurnId`.
    // This is the exact property that makes claiming correct: the claim
    // locks turn A regardless of which copy's turn id route.ts last read.
    const TURN_B = "33333333-0000-0000-0000-00000000000b";
    const confirmed = partSearchDecision({
      message: partSearchConfirmation(CANDIDATE),
      candidate: CANDIDATE,
      previousEvidence: [{ kind: "part_search_proposal", candidate: CANDIDATE, age: 2, originTurnId: ORIGIN }],
      previousTurnId: TURN_B,
    });
    expect(confirmed).toEqual({ action: "search", candidate: CANDIDATE, originTurnId: ORIGIN });
  });

  it("a legacy proposal with no origin anchors to the turn it currently sits on, on re-show", () => {
    const reshown = partSearchDecision({
      message: "What is the warranty on this?",
      candidate: CANDIDATE,
      previousEvidence: proposed(1),
      previousTurnId: PREV_TURN_ID,
    });
    expect(reshown).toEqual({ action: "propose", candidate: CANDIDATE, age: 2, originTurnId: PREV_TURN_ID });
  });

  // #4193 Codex round 2 F3: fail closed when the origin cannot be resolved
  // at all — a search with nothing to atomically claim against must never
  // run, even when the three-way candidate/maker match otherwise holds.
  it("a matching confirmation with no resolvable origin at all does not search", () => {
    expect(
      partSearchDecision({ message: partSearchConfirmation(CANDIDATE), candidate: CANDIDATE, previousEvidence: proposed() }).action,
    ).toBe("mismatch");
  });

  it("cancelling and confirming both still require the photo to still yield the offered candidate", () => {
    expect(
      partSearchDecision({
        message: "search the web for " + CANDIDATE,
        candidate: "OTHER-123",
        previousEvidence: proposed(),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
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
  // #4193 Codex round 2 F3+F6: these legacy fixtures carry no `originTurnId`,
  // so a resolvable search needs `previousTurnId` — the turn they sit on.
  const PREV_TURN_ID = "44444444-0000-0000-0000-000000004171";
  const proposal = (manufacturer: string | null | undefined) => [
    { kind: "part_search_proposal", candidate: "SS5Y3-DUW01302", ...(manufacturer === undefined ? {} : { manufacturer }) },
  ];

  it("searches when part AND maker match the proposal", () => {
    expect(
      partSearchDecision({
        message: confirm,
        candidate: "SS5Y3-DUW01302",
        manufacturer: "SMC",
        previousEvidence: proposal("SMC"),
        previousTurnId: PREV_TURN_ID,
      }),
    ).toEqual({ action: "search", candidate: "SS5Y3-DUW01302", originTurnId: PREV_TURN_ID });
  });

  it("does not search when the maker appeared after a part-only proposal", () => {
    expect(
      partSearchDecision({
        message: confirm,
        candidate: "SS5Y3-DUW01302",
        manufacturer: "SMC",
        previousEvidence: proposal(null),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });

  it("does not search when the maker changed", () => {
    expect(
      partSearchDecision({
        message: confirm,
        candidate: "SS5Y3-DUW01302",
        manufacturer: "FESTO",
        previousEvidence: proposal("SMC"),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });

  it("a legacy proposal without a maker field binds a maker-less search only", () => {
    expect(
      partSearchDecision({
        message: confirm,
        candidate: "SS5Y3-DUW01302",
        manufacturer: null,
        previousEvidence: proposal(undefined),
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("search");
  });

  it("a consumed proposal authorizes nothing", () => {
    const consumed = [...proposal("SMC"), { kind: "part_search_proposal_consumed" }];
    expect(
      partSearchDecision({
        message: confirm,
        candidate: "SS5Y3-DUW01302",
        manufacturer: "SMC",
        previousEvidence: consumed,
        previousTurnId: PREV_TURN_ID,
      }).action,
    ).toBe("mismatch");
  });
});

// Codex r3 F6 (#4172): the OEM retrieval parser is not a search-egress
// authority — any serial label on the text must be detectable by the route.
describe("mentionsSerialLabel", () => {
  it("detects S/N, serial number and serial no. labels", () => {
    expect(mentionsSerialLabel("Siemens S/N: 6AV2124-0GC01-0AX0")).toBe(true);
    expect(mentionsSerialLabel("Serial number is AB-1234567")).toBe(true);
    expect(mentionsSerialLabel("serial no. 12345678")).toBe(true);
  });
  it("is false for a plain model or labelled part", () => {
    expect(mentionsSerialLabel("Siemens TP700 Comfort panel, 24 VDC")).toBe(false);
    expect(mentionsSerialLabel("Siemens P/N: 6ES7214-1AG40-0XB0")).toBe(false);
  });
  it("premise: the real OEM parser does read a serial-labelled order number as a model", () => {
    expect(resolveModelFromObservationText("Siemens S/N: 6AV2124-0GC01-0AX0").model).not.toBeNull();
    expect(unambiguousPartNumber("Siemens S/N: 6AV2124-0GC01-0AX0")).toBeNull();
  });
});

// Codex post-cap 7 F12 (#4172): abbreviated serial labels are serial labels too.
describe("abbreviated serial labels", () => {
  const spellings = ["SMC SER: AB-1234567", "SMC Ser. No. AB-1234567", "SMC Ser# AB-1234567", "SMC SER NO AB-1234567", "SMC Ser.Nr. AB-1234567", "SMC SER AB-1234567", "AB-1234567 (SER)", "SMC SER. AB-1234567", "SMC Ser.: AB-1234567", "SMC SER.# AB-1234567", "SMC AB-1234567 (SER.)", "SMC Ser.AB-1234567", "SMC Ser-No AB-1234567", "SMC Sr. No. AB-1234567", "SMC SER - AB-1234567", "SMC SER. - AB-1234567", "SMC Sr# AB-1234567", "SMC SER \u2013 AB-1234567", "SMC Serial - AB-1234567", "SMC SER.-AB-1234567", "SMC SER/AB-1234567", "AB-1234567 SER.", "AB-1234567 SR, 24VDC", "SMC SER\u2116 AB-1234567", "SMC Serial \u2116 AB-1234567", "SMC SER \u2014 AB-1234567", "SMC SER: (AB-1234567)", "SMC SER [AB-1234567]", "SMC SER\u2192AB-1234567", "SMC SER {AB-1234567}", "SMC S/N \u2014 (AB-1234567)", "AB-1234567 SER \u2014 24VDC", "SMC S\u2044N AB-1234567", "SMC Ser\u00adial AB-1234567", "SMC S-N: AB-1234567", "SMC S / N: AB-1234567", "SMC S. N.: AB-1234567", "SMC S /N AB-1234567", "SMC S.No. AB-1234567", "SMC S N AB-1234567", "SMC Ser ial AB-1234567", "SMC SNO: AB-1234567", "SMC Ser. Num. AB-1234567", "SMC SER NUM: AB-1234567", "SMC Ser. N\u00b0 AB-1234567", "SMC Serial Num AB-1234567", "SMC S/Num AB-1234567", "SMC Ser. Numero AB-1234567", "SMC Ser.-Nummer AB-1234567", "SMC Sr Nmbr AB-1234567", "SMC Ser. Nbr. AB-1234567", "SMC SerialNumber: AB-1234567", "SMC SERIALNO AB-1234567", "SMC SerNo AB-1234567", "SMC S/Nbr AB-1234567", "SMC SrNum AB-1234567"];
  it.each(spellings)("%s is a serial label, and its value is never a part number", (text) => {
    expect(mentionsSerialLabel(text)).toBe(true);
    expect(unambiguousPartNumber(text)).toBeNull();
  });
  it("a prefix label never marks the labelled part printed before it as the serial", () => {
    expect(unambiguousPartNumber("P/N: SY3120-5LZD Serial AB-1234567")).toBe("SY3120-5LZD");
    expect(unambiguousPartNumber("P/N: SY3120-5LZD SER: AB-1234567")).toBe("SY3120-5LZD");
    // Whereas a bare suffix label with no value after it marks the code before it.
    expect(unambiguousPartNumber("P/N: SY3120-5LZD AB-1234567 SER.")).toBe("SY3120-5LZD");
  });
  it.each(["SMC Series SY valve SY3120-5LZD", "Service manual for SY3120-5LZD", "Server rack SY3120-5LZD", "SY3120-5LZD ser. valve body", "Sr. technician note: SY3120-5LZD", "Senior technician SY3120-5LZD", "SR latch for SY3120-5LZD", "snap ring SY3120-5LZD", "SY3120-5LZD, 24 VDC, SER.", "This is not the SY3120-5LZD", "Bus N 5 feeds SY3120-5LZD", "snow chains for SY3120-5LZD", "Phase S not needed on SY3120-5LZD", "sensors nearby: SY3120-5LZD"])(
    "control: %s is not a serial label",
    (text) => {
      expect(mentionsSerialLabel(text)).toBe(false);
      expect(unambiguousPartNumber(text)).toBe("SY3120-5LZD");
    },
  );
});

// Codex post-cap 14 F14 (#4172): a customer-assigned identifier (asset tag,
// asset/equipment/unit id, inventory or work-order number) is never a part
// and never leaves (ADR-0036) — the same fail-closed rule as a serial label.
describe("asset-tag labels", () => {
  it.each([
    "SMC Asset tag: VALVE-1234",
    "SMC Asset ID: AB-1234567",
    "Tag No. 12-3456 SY3120-5LZD",
    "Equipment ID: EQ-00123 SY3120-5LZD",
    "Inventory # 44-1234 SY3120-5LZD",
    "Unit No: U-1234 SY3120-5LZD",
    "WO 123456 SY3120-5LZD",
    "Fixed asset 7788-01 SY3120-5LZD",
    "SMC SY3120-5LZD (asset tag)",
    "SMC Asset identifier: VALVE-1234",
    "SMC VALVE-1234 asset tag",
    "SMC Asset tag is VALVE-1234",
    "SMC asset ref VALVE-1234",
    "VALVE-1234 tag",
    "SMC Tag ID — VALVE-1234",
    "Equipment identifier: EQ-00123 SY3120-5LZD",
    "SMC INV: VALVE-1234",
    "SMC Inv. No. VALVE-1234",
    "SMC Inventory tag VALVE-1234",
  ])("%s carries an asset label; no unlabelled code survives it", (text) => {
    expect(mentionsAssetLabel(text)).toBe(true);
    expect(unambiguousPartNumber(text)).toBeNull();
  });
  it("an explicitly labelled part survives beside an asset tag, and the tag itself is never the part", () => {
    expect(unambiguousPartNumber("SMC P/N: SY3120-5LZD Asset tag: VALVE-1234")).toBe("SY3120-5LZD");
    expect(unambiguousPartNumber("Asset tag: VALVE-1234 P/N: SY3120-5LZD")).toBe("SY3120-5LZD");
  });
  it.each(["tag the valve SY3120-5LZD", "the line stopped on SY3120-5LZD", "unit cooler SY3120-5LZD", "site visit for SY3120-5LZD", "SMC SY3120-5LZD assets list", "tagged for SY3120-5LZD", "SY3120-5LZD tagline", "inverter drive SY3120-5LZD", "invalid reading on SY3120-5LZD"])(
    "control: %s is ordinary prose",
    (text) => {
      expect(mentionsAssetLabel(text)).toBe(false);
      expect(unambiguousPartNumber(text)).toBe("SY3120-5LZD");
    },
  );
});
