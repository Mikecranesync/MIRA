// The citation quote must show the claim the question names (2026-10-07 Pixel acceptance).
//
// On staging (turn caf50e49) the technician asked "What does fault F004 mean on this drive".
// The cited chunk is the PowerFlex 525 fault table from 520-PC001 p.2. The F007 row matched
// "does" and "drive" and outscored the F004 row, so the persisted quote never showed F004 and
// the technician who opened the proof saw text that does not support the answer.
import { describe, it, expect } from "vitest";
import { relevantQuoteWindow } from "../lib/quote-window";

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
});
