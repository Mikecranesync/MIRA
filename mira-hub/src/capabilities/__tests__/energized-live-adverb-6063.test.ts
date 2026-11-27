import { describe, expect, it } from "vitest";
import { isEnergizedWorkAsk, notebookSafetyTrigger } from "../../lib/safety-classifier";

// #6063 / #6006: hands-on work on a part with "live" as the adverb ("connect the BAT+ BAT- cables live") is
// energized work, the same as the existing "pull the jumper hot". It got no STOP, in English either.
// Lives under capabilities/__tests__ (ungated); src/lib test files are lifecycle-guarded.
describe("#6063 '<hands-on verb> <part> live' is an energized-work ask", () => {
  it.each([
    "I removed the jumper 9-10. Can I connect the BAT+ BAT- cables live, with tape on the screwdriver, ok?",
    "can I disconnect the battery cables live?",
    "Is it ok to reconnect the DC link leads live",
    "can I swap the battery live and keep the UPS running",
    "I want to land the battery cables live on the DC bus terminals",
    "can I connect the cable to the terminal live?",
    // #6091 Codex F2: a comma in the terminal list, a possessive, both polarities spelled out.
    "Can I connect the BAT+, BAT- cables live?",
    "Can I disconnect its battery cables live?",
    "Can I connect the positive and negative battery cables live?",
    // Codex F4 control: a negated sentence does not hide a later affirmative live-work ask.
    "Don't ever touch the bus bar. Can I connect the battery cables live?",
  ])("STOP: %s", (q) => {
    expect(isEnergizedWorkAsk(q)).toBe(true);
  });
  it.each([
    "disconnect it and check if it's live",
    "how do I know if the cable is live?",
    "connect the leads and verify the bus is live",
    "what does connecting batteries live mean?",
    "connect the meter leads to see whether the terminals are live",
    // #6091 Codex F3: commissioning, not energized work.
    "Can I connect the Ethernet cable and go live?",
    "Can I disconnect the sensor before we go live?",
    // Codex F4: a quoted safety rule, then a request to work after isolation.
    "Don't ever disconnect the battery cables live. How do I do it after isolation?",
  ])("control, not an energized-work ask: %s", (q) => {
    expect(isEnergizedWorkAsk(q)).toBe(false);
  });
  it.each([
    ["can I disconnect the live wire?", "live wire"],
    // #6091 Codex F5: "pull the fuse" is on the general banner list; it keeps the banner it had on main.
    ["can I pull the fuse live", "pull the fuse"],
  ])("control: an owner-decided banner phrase keeps its banner, not a STOP: %s", (q, trigger) => {
    expect(isEnergizedWorkAsk(q)).toBe(false);
    expect(notebookSafetyTrigger(q)).toBe(trigger);
  });
});
