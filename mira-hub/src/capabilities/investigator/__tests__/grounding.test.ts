import { describe, expect, it } from "vitest";
import { ungroundedNumbers, unsafeInstructionPhrases, unknownEvidenceIds, isNegatedBefore } from "../grounding";
import type { EvidenceItem } from "../types";

function ev(text: string, id = "doc:1:0"): EvidenceItem {
  return { id, source: "manual", docId: "doc", title: "Manual", page: 1, text, toolCallIndex: 0 };
}

describe("ungroundedNumbers", () => {
  it("passes a number+unit that appears in evidence, after unit-spelling normalisation", () => {
    const out = ungroundedNumbers("The DC bus reads 620V.", [ev("DC bus voltage: 620 V nominal.")]);
    expect(out).toEqual([]);
  });

  it("flags a number+unit NOT present in any evidence", () => {
    const out = ungroundedNumbers("The DC bus reads 620V.", [ev("DC bus voltage: 680 V nominal.")]);
    expect(out).toEqual(["620V"]);
  });

  it("flags a bare multi-digit number not present in evidence", () => {
    const out = ungroundedNumbers("Wait 45 seconds before servicing.", [ev("Wait at least 5 minutes before servicing.")]);
    expect(out.some((s) => s.includes("45"))).toBe(true);
  });

  it("grounds a bare multi-digit number present in evidence", () => {
    const out = ungroundedNumbers("Torque the cover screws to 24.", [ev("Torque spec: 24 in-lb for cover screws.")]);
    expect(out).toEqual([]);
  });

  it("does not treat a fault/parameter code as a 'number'", () => {
    const out = ungroundedNumbers("Fault F004 means power loss.", [ev("F004: Power Loss — check incoming supply.")]);
    expect(out).toEqual([]);
  });

  it("a code id with no evidence support is still not flagged as a NUMBER (codes are not this function's job)", () => {
    const out = ungroundedNumbers("Fault A999 means something.", [ev("Nothing relevant here.")]);
    expect(out).toEqual([]);
  });

  it("does not flag a page REFERENCE ('see page 15') even when '15' never appears in evidence text", () => {
    const out = ungroundedNumbers("See page 15 for the lockout procedure.", [
      ev("Lockout procedure: disconnect power, verify zero energy.", "doc:15:0"),
    ]);
    expect(out).toEqual([]);
  });

  it("grounds a number that appears only in an evidence item's title", () => {
    const out = ungroundedNumbers("On the PowerFlex 525, F004 indicates power loss", [
      {
        id: "d:161:0",
        source: "manual",
        docId: "d",
        title: "PowerFlex 525 User Manual",
        page: 161,
        text: "F004: UnderVoltage — check incoming line voltage.",
        toolCallIndex: 0,
      },
    ]);
    expect(out).toEqual([]);
  });

  it("does not misread digits inside an inline-quoted evidence id as an ungrounded bare number", () => {
    const evidence = [ev("Torque spec: 24 in-lb for cover screws.", "doc-4821-abc:12:0")];
    const out = ungroundedNumbers("See evidence doc-4821-abc:12:0 for the torque value.", evidence);
    expect(out.some((s) => s.includes("4821"))).toBe(false);
  });

  it("does not include a trailing sentence comma in the raw ungrounded match", () => {
    const out = ungroundedNumbers("Torque the cover screws to 525, then verify.", [ev("Nothing relevant here.")]);
    expect(out).not.toContain("525,");
    expect(out).toContain("525");
  });

  it("grounds a generic 'V' claim against a more specific VDC/VAC quantity in evidence", () => {
    const out = ungroundedNumbers("The DC bus reads 620V.", [ev("DC bus voltage: 620VDC nominal.")]);
    expect(out).toEqual([]);
  });

  it("does NOT ground a specific 'VDC' claim against only a generic V in evidence", () => {
    const out = ungroundedNumbers("The DC bus reads 620VDC.", [ev("DC bus voltage: 620V nominal.")]);
    expect(out).toEqual(["620VDC"]);
  });
});

describe("unsafeInstructionPhrases", () => {
  it("flags an imperative bypass of a named safety target", () => {
    const out = unsafeInstructionPhrases("Bypass the e-stop to keep the line running.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags jumpering out an interlock", () => {
    const out = unsafeInstructionPhrases("Jumper out the interlock on the guard door.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags work on energized/live equipment", () => {
    const out = unsafeInstructionPhrases("Replace the fan while it's energized.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags 'reset it to clear it' as an instruction", () => {
    const out = unsafeInstructionPhrases("Reset the drive to clear the fault and continue running it hot.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags writing a PLC/drive parameter without LOTO", () => {
    const out = unsafeInstructionPhrases("Set the drive parameter to 50 without lockout first.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("does NOT flag a declarative manual value ('P036 = 2 selects 2-wire')", () => {
    const out = unsafeInstructionPhrases("P036 = 2 selects 2-wire control, the factory default.");
    expect(out).toEqual([]);
  });

  it("does NOT flag an ordinary, safe next-check ('reset the fault and verify operation')", () => {
    const out = unsafeInstructionPhrases("After replacing the fan, reset the fault and verify normal operation.");
    expect(out).toEqual([]);
  });

  it("honors a negation within 4 words before the match", () => {
    const out = unsafeInstructionPhrases("Do not bypass the e-stop under any circumstances.");
    expect(out).toEqual([]);
  });

  it("does not let 'don't forget to' exempt the instruction that follows", () => {
    const out = unsafeInstructionPhrases("Don't forget to jumper out the interlock before testing.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("a negated decoy does not suppress a later, distinct unsafe instruction in the same message", () => {
    const out = unsafeInstructionPhrases("Do not bypass the interlock, jumper out the light curtain instead");
    expect(out.length).toBeGreaterThan(0);
  });

  it("does NOT flag a past-tense report ('the guard was forced last shift')", () => {
    const out = unsafeInstructionPhrases("The guard was forced last shift and nobody noticed.");
    expect(out).toEqual([]);
  });

  it("does NOT flag 'jumper' used as a noun, even near a safety target", () => {
    const out = unsafeInstructionPhrases("Check that the factory jumper is still installed across the safety input.");
    expect(out).toEqual([]);
  });

  it("does NOT flag 'the jumper across the safety input' (determiner marks the noun use, no particle)", () => {
    const out = unsafeInstructionPhrases("Verify the jumper across the safety input terminals is installed.");
    expect(out).toEqual([]);
  });

  it("flags a passive-voice bypass instruction ('the interlock should be bypassed')", () => {
    const out = unsafeInstructionPhrases("For this test, the interlock should be bypassed temporarily.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("does NOT flag 'de-energized'/'non-energized' (the SAFE state, not a live-work instruction)", () => {
    const out1 = unsafeInstructionPhrases("Replace the fan after the drive is de-energized and locked out.");
    expect(out1).toEqual([]);
    const out2 = unsafeInstructionPhrases("Replace the fan once it's non-energized.");
    expect(out2).toEqual([]);
  });

  it("does NOT flag a negated powered-state claim ('verify the bus is NOT energized')", () => {
    const out = unsafeInstructionPhrases("Before touching the terminals, verify the bus is not energized.");
    expect(out).toEqual([]);
  });

  it("still flags the genuine energized-work instruction after these fixes", () => {
    const out = unsafeInstructionPhrases("Replace the fan while it's energized.");
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags natural energized-work phrasings the homemade regex missed (reused isEnergizedWorkAsk per sentence)", () => {
    expect(unsafeInstructionPhrases("Remove the cover while the drive is live.").length).toBeGreaterThan(0);
    expect(unsafeInstructionPhrases("Touch the terminals while the drive is running.").length).toBeGreaterThan(0);
  });

  it("stops reading 'can' as the determiner 'an' before bypass/jumper (lookbehind word boundary)", () => {
    const out = unsafeInstructionPhrases("You can bypass the interlock to keep the line running.");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("unknownEvidenceIds", () => {
  it("returns ids absent from the evidence set", () => {
    const evidence = [ev("text", "a:1:0"), ev("text2", "a:1:1")];
    expect(unknownEvidenceIds(["a:1:0", "a:1:1", "a:1:2"], evidence)).toEqual(["a:1:2"]);
  });

  it("returns an empty array when every id is known", () => {
    const evidence = [ev("text", "a:1:0")];
    expect(unknownEvidenceIds(["a:1:0"], evidence)).toEqual([]);
  });

  it("dedupes repeated unknown ids", () => {
    const evidence: EvidenceItem[] = [];
    expect(unknownEvidenceIds(["x", "x", "y"], evidence)).toEqual(["x", "y"]);
  });
});

describe("isNegatedBefore", () => {
  it("is true when a negation word is within the window", () => {
    const text = "please don't bypass the interlock";
    const idx = text.indexOf("bypass");
    expect(isNegatedBefore(text, idx)).toBe(true);
  });

  it("is false across a clause boundary", () => {
    const text = "Do not panic; bypass the interlock";
    const idx = text.indexOf("bypass");
    expect(isNegatedBefore(text, idx)).toBe(false);
  });

  it("is false for the 'don't forget to' idiom", () => {
    const text = "Don't forget to jumper out the relay";
    const idx = text.indexOf("jumper");
    expect(isNegatedBefore(text, idx)).toBe(false);
  });
});
