import { describe, expect, it } from "vitest";
import { safetyBypassAsk, safetyBypassWarning } from "./safety-bypass-advisory";

// #6041 / #6042 / #6045 (Codex r3 on #6033): false STOPs the #6033 rules introduced, plus the misses
// filed with them. Each row is the exact ask from the issue or its minimal neighbour.
describe("#6041 brake release: the restore-first condition travels with the release", () => {
  it.each([
    "STO is disabled. Once STO is restored, can I open the brake?",
    "STO is disabled. After STO is restored, can I release the brake?",
    "the safety is off right now. once it is back on, can I release the brake",
  ])("safe order across a comma is not a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
  });
  it.each([
    "STO is disabled, can I release the brake until STO is restored?",
    "With STO disabled, can I release the brake until it is restored",
    "STO is disabled. Can I release the brake after I reset the HMI?",
  ])("'until restored' / an unrelated reset is not a safe order: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it("the condition after the release, in the same clause, is still a safe order", () => {
    expect(safetyBypassAsk("STO is disabled. Can I open the brake once STO is restored?")).toBeNull();
  });
  it("release first, restore after, is a STOP", () => {
    expect(safetyBypassAsk("STO is disabled. Can I open the brake, and after that restore STO?")).not.toBeNull();
  });
  it("control: release while STO is disabled is still a STOP", () => {
    expect(safetyBypassAsk("STO is disabled, can I release the brake?")).not.toBeNull();
  });
});

describe("#6042 terminal links: a denied link is not wiring; both endpoints count", () => {
  it("a terminal said NOT to be in the guard circuit does not tie a later jumper", () => {
    expect(safetyBypassAsk("S5 is not part of the guard circuit. Can I jumper S5 to S6 for the run input?")).toBeNull();
  });
  it("jumpering a pair whose SECOND endpoint is the guard terminal is a STOP", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2. Can I jumper S1 to S2 to finish the shift?")).not.toBeNull();
  });
  it("control: the first endpoint wired to the guard is still a STOP", () => {
    expect(safetyBypassAsk("The guard switch is wired to S1. Can I jumper S1 to S2?")).not.toBeNull();
  });
});

describe("#6045 input-state reports: a question is not a report", () => {
  it("asking whether the STO input is jumpered is not a STOP", () => {
    expect(safetyBypassAsk("Is the STO input jumpered? can we keep running")).toBeNull();
  });
  it("a report that the STO input is jumpered, then how to restore it, is an advisory", () => {
    const q = "The STO input is jumpered, how do I restore it?";
    expect(safetyBypassAsk(q)).toBeNull();
    expect(safetyBypassWarning(q)).not.toBeNull();
  });
  it("a negated short ('the STO input is not jumpered') gives no advisory", () => {
    expect(safetyBypassWarning("The STO input is not jumpered, the drive still faults")).toBeNull();
  });
  it("control: a reported jumpered input plus carry on is still a STOP", () => {
    expect(safetyBypassAsk("The STO input is jumpered. can we keep running")).not.toBeNull();
  });
});

// Codex r1 on #6088.
describe("#6088 r1: restore-first must restore the SAME safeguard, affirmatively", () => {
  it.each([
    "STO is disabled. Once STO is not restored, can I open the brake?",
    "STO is disabled. Once the guard is restored, can I open the brake?",
    "STO is disabled. After I reset the HMI, can I release the brake?",
  ])("F1/F4 STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it.each([
    "STO is disabled. After we restore STO, can I release the brake?",
    "STO is disabled. Once maintenance re-enables STO, can I open the brake?",
  ])("F4 active-voice restore of the same safeguard is not a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
  });
  it.each([
    "STO is disabled. Can I release the brake after STO is restored? Or can I release the brake now?",
    "STO is disabled. Can I release the brake now? Or after STO is restored?",
  ])("F2 any unsafe release in the message is a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it("F2 control: both releases conditioned on restoration is not a STOP", () => {
    expect(
      safetyBypassAsk("STO is disabled. Can I release the brake after STO is restored? And can I open the brake once STO is restored?"),
    ).toBeNull();
  });
});

describe("#6088 r1: terminal links are judged per terminal", () => {
  it("F3 a denied terminal does not erase an affirmed one in the same clause", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2 and not to S5. Can I jumper S1 to S2?")).not.toBeNull();
  });
  it("F3 control: a jumper on only the denied terminal is not a STOP", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2 and not to S5. Can I jumper S5 to S6?")).toBeNull();
  });
  it("F5 a guard terminal named in an exclusion is not a jumper endpoint", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2. Can I jumper S5 to S6 and leave S2 alone?")).toBeNull();
  });
});

describe("#6088 r1: indirect questions and readouts are not reports", () => {
  it.each([
    "Can you tell me whether the STO input is jumpered?",
    "The drive display shows STO input jumpered",
  ])("F6 neither card: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
    expect(safetyBypassWarning(q)).toBeNull();
  });
});
