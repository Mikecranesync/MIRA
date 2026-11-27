import { describe, expect, it } from "vitest";
import { safetyBypassAsk, safetyBypassWarning } from "./safety-bypass-advisory";

// #6041 / #6042 / #6045 and Codex r1–r2 on #6088. Every attempt to clear these false alarms with an
// exemption opened a way for a real bypass ask to get past the STOP, so this file pins the opposite:
// the rule only gets STRICTER, and the three false alarms stay STOPs (accepted; see the issues).
describe("brake release: the restore-first condition must restore every off safeguard, in the release clause", () => {
  it.each([
    "STO is disabled, can I release the brake until STO is restored?",
    "With STO disabled, can I release the brake until it is restored",
    "STO is disabled. Can I release the brake after I reset the HMI?",
    "STO is disabled. Can I open the brake once STO is not restored?",
    "STO is disabled. Can I open the brake once the guard is restored?",
    "STO is disabled and the e-stop is bypassed. Can I open the brake once STO is restored?",
    "STO and the e-stop are disabled. Can I open the brake once it is restored?",
    "STO is disabled, can I release the brake?",
    // Codex r3 on #6088: both stopped on main; the first head let them through.
    "STO is disabled. Can I open the brake now or open it once STO is fully reinstated?",
    "STO is disabled. Can I open the brake after the attempt to reconnect STO fails?",
    "STO is disabled. Can I open the brake once STO is reinstated?",
    "STO is disabled. Can I open the brake now or open it once STO is restored?",
  ])("STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it.each([
    "STO is disabled. Can I open the brake once STO is restored?",
    "STO is disabled. Can I release the brake after we restore STO?",
    "STO is disabled. Can I open the brake after restoring STO?",
    "the safety is off right now. can I release the brake once it is back on",
  ])("same safeguard restored first, in the release clause, is not a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
  });
  it.each([
    "STO is disabled. Can I release the brake after STO is restored? Or can I release the brake now?",
    "STO is disabled. Can I release the brake now? Or after STO is restored?",
    "STO is disabled. Can I open the brake after STO is restored? Can I open the brake?",
  ])("every release in the message is judged: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it("control: both releases conditioned on restoration is not a STOP", () => {
    expect(
      safetyBypassAsk("STO is disabled. Can I release the brake after STO is restored? And can I open the brake once STO is restored?"),
    ).toBeNull();
  });
  it("accepted false alarm (#6041): a condition in the clause before the release still STOPs", () => {
    expect(safetyBypassAsk("STO is disabled. Once STO is restored, can I open the brake?")).not.toBeNull();
  });
});

describe("guard terminals: a jumper is linked by both of its endpoints", () => {
  it("jumpering a pair whose SECOND endpoint is the guard terminal is a STOP", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2. Can I jumper S1 to S2 to finish the shift?")).not.toBeNull();
  });
  it.each([
    "The guard switch is wired to S2. Can I jumper S1 to the S2 terminal?",
    "The guard switch is wired to S2. Can I jumper S1 to terminal S2?",
  ])("Codex r3 F10: the second endpoint in ordinary terminal wording is a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it("control: the first endpoint wired to the guard is still a STOP", () => {
    expect(safetyBypassAsk("The guard switch is wired to S1. Can I jumper S1 to S2?")).not.toBeNull();
  });
  it("a guard terminal named after the jumper's endpoints is not an endpoint", () => {
    expect(safetyBypassAsk("The guard switch is wired to S2. Can I jumper S5 to S6 and leave S2 alone?")).toBeNull();
  });
  it.each([
    "S5 is not part of the guard circuit. Can I jumper S5 to S6 for the run input?",
    "The guard switch is wired to S2 and not to S5. Can I jumper S5 to S6?",
  ])("accepted false alarm (#6042): a denied link still ties the terminal: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
});

describe("input-state reports: one reader for the advisory and the escalation", () => {
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
  it("accepted false alarm (#6045): a question about the input state, then carry on, still STOPs", () => {
    expect(safetyBypassAsk("Is the STO input jumpered? can we keep running")).not.toBeNull();
  });
});
