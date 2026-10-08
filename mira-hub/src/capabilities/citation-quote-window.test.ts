// The citation quote must show the claim the question names (2026-10-07 Pixel acceptance).
//
// On staging (turn caf50e49) the technician asked "What does fault F004 mean on this drive".
// The cited chunk is the PowerFlex 525 fault table from 520-PC001 p.2. The F007 row matched
// "does" and "drive" and outscored the F004 row, so the persisted quote never showed F004 and
// the technician who opened the proof saw text that does not support the answer.
import { describe, it, expect } from "vitest";
import { claimIdentifiers, relevantQuoteWindow } from "../lib/quote-window";

// The persisted chunk text, verbatim from the staging turn's evidence.
const PF525_FAULT_TABLE =
  "ional fault.\nF003 Power Loss Monitor the incoming AC line for low voltage or line power interruption. Check\n" +
  "input fuses. Reduce load.\nF004(1) UnderVoltage Monitor the incoming AC line for low voltage or line power interruption.\n" +
  "F005(1) OverVoltage Monitor the AC line for high line voltage or transient conditions. Motor\n" +
  "regeneration can also cause bus overvoltage. Extend the decel time or install\ndynamic brake resistor.\n" +
  "F006(1) Motor Stalled Increase P041, A442, A444, or A446 [Accel Time x] or reduce load so drive output\n" +
  "current does not exceed the current set by parameter A484 or A485 [Current\nLimit x]. Check for overhauling load.\n" +
  "F007(1) Motor Overload An excessive motor load exists. Reduce load so drive output current does not\n" +
  "exceed the current set by parameter P033 [Motor OL Current]. Verify A530 [Boost\nSelect] setting.\n" +
  "F008(1) Heatsink OvrTmp Check for blocked or dirty heatsink fins. Verify that ambient temperature has not\n" +
  "exceeded the rated ambient temperature.\n";

describe("citation quote window — the named identifier wins", () => {
  it("the quote contains the fault code the question names, not the row with the most common words", () => {
    const q = relevantQuoteWindow(PF525_FAULT_TABLE, "What does fault F004 mean on this drive");
    expect(q).toContain("F004(1) UnderVoltage");
  });

  it("an identifier in the question outweighs any number of plain words", () => {
    // The F006 row also matches "drive", "does" and "current".
    const q = relevantQuoteWindow(PF525_FAULT_TABLE, "Why does the drive current trip with F005");
    expect(q).toContain("F005(1) OverVoltage");
  });

  it("control: plain-word questions still pick the best plain-word segment", () => {
    const q = relevantQuoteWindow(PF525_FAULT_TABLE, "heatsink fins ambient temperature");
    expect(q).toContain("Heatsink OvrTmp");
  });

  it("a fault code still wins when the question also names the model", () => {
    const q = relevantQuoteWindow(PF525_FAULT_TABLE, "What does fault F004 mean on PowerFlex 525");
    expect(q).toContain("F004(1) UnderVoltage");
  });

  it("a code the question calls 'the … fault' is still the claim", () => {
    const q = relevantQuoteWindow(PF525_FAULT_TABLE, "What does the F004 fault mean on this drive");
    expect(q).toContain("F004(1) UnderVoltage");
  });
});

// The model a question is asked ABOUT names the machine, not the claim (Codex review of #4307).
// A chunk's heading or page header often carries the model, so a model number given claim
// priority drags the quote onto the heading. Every claim below sits more than 240 characters
// past the heading, so a head-of-chunk window cannot pass these by accident.
const MINI_REFERENCE = [
  "PowerFlex 525 Mini Reference.",
  "Fault F004 (UnderVoltage) indicates the DC bus voltage fell below the minimum threshold.",
  "Check incoming line power, verify input fuses, and confirm supply voltage is within tolerance before resetting.",
  "Terminal torque: control I/O terminal block screw torque specification is 0.71 N-m (6.2 lb-in).",
  "Fault F005 (OverVoltage) indicates the DC bus exceeded the maximum.",
  "Check for high line voltage or a deceleration time that is too short.",
].join(" ");

// The same text with a letter-bearing model in the heading (the GS10 is the bench drive).
const GS10_REFERENCE = MINI_REFERENCE.replace("PowerFlex 525", "GS10");

// Numbered (not letter-prefixed) fault codes, where every row shares "fault" and "drive".
const NUMBERED_FAULTS = [
  "Drive fault list.",
  "Fault 12: drive output current exceeded the limit. Check the drive load and the motor cable.",
  "Fault 13: the drive detected a ground current. Check the motor cable insulation and the drive output wiring.",
  "Fault 14: the DC bus voltage rose above the trip level. Extend the decel time.",
  "Fault 15: the drive heatsink is too hot. Check the drive fan and the ambient temperature.",
].join(" ");

describe("citation quote window — an equipment number does not outrank the claim", () => {
  it("a model-qualified torque question keeps the torque value, not the model heading", () => {
    const q = relevantQuoteWindow(MINI_REFERENCE, "What is the terminal block screw torque on PowerFlex 525?");
    expect(q).toContain("0.71");
  });

  it("a letter-bearing model after 'the' is the machine, not the claim", () => {
    const q = relevantQuoteWindow(GS10_REFERENCE, "What is the terminal block screw torque on the GS10?");
    expect(q).toContain("0.71");
  });

  it("a model-qualified fault question keeps the fault row, not the model heading", () => {
    const q = relevantQuoteWindow(MINI_REFERENCE, "What does fault F005 mean on PowerFlex 525?");
    expect(q).toContain("F005 (OverVoltage)");
  });

  it("a bare number the question labels as a fault is the claim", () => {
    const q = relevantQuoteWindow(NUMBERED_FAULTS, "What does fault 15 mean on this drive");
    expect(q).toContain("Fault 15: the drive heatsink");
  });
});

describe("claimIdentifiers — which numbers the question marks as the claim", () => {
  const ids = (q: string) => [...claimIdentifiers(q)].sort();
  it("letter-and-digit codes are claims, wherever the question puts them", () => {
    expect(ids("What does F004 mean")).toEqual(["f004"]);
    expect(ids("My drive tripped on F004")).toEqual(["f004"]);
    expect(ids("How do I set P041 on PowerFlex 525")).toEqual(["p041"]);
  });
  it("a bare integer is a model or quantity unless a claim noun labels it", () => {
    expect(ids("torque on PowerFlex 525")).toEqual([]);
    expect(ids("What does fault 2310 mean")).toEqual(["2310"]);
    expect(ids("What is parameter 41")).toEqual(["41"]);
  });
  it("a determiner marks an equipment phrase unless a claim noun follows", () => {
    expect(ids("torque on the GS10")).toEqual([]);
    expect(ids("What does CE10 mean on my GS10")).toEqual(["ce10"]);
    expect(ids("What does the F004 fault mean")).toEqual(["f004"]);
  });
  it("known limit: a letter-bearing model with no determiner still reads as a code", () => {
    expect(ids("torque on PF525")).toEqual(["pf525"]);
  });
});
