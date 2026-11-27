import { describe, expect, it } from "vitest";
import { isEnergizedWorkAsk, notebookSafetyTrigger } from "./safety-classifier";

// #6063 / #6006: hands-on work on a part with "live" as the adverb ("connect the BAT+ BAT- cables live") is
// energized work, the same as the existing "pull the jumper hot". It got no STOP, in English either.
describe("#6063 '<hands-on verb> <part> live' is an energized-work ask", () => {
  it.each([
    "I removed the jumper 9-10. Can I connect the BAT+ BAT- cables live, with tape on the screwdriver, ok?",
    "can I disconnect the battery cables live?",
    "Is it ok to reconnect the DC link leads live",
    "can I swap the battery live and keep the UPS running",
    "I want to land the battery cables live on the DC bus terminals",
    "can I connect the cable to the terminal live?",
  ])("STOP: %s", (q) => {
    expect(isEnergizedWorkAsk(q)).toBe(true);
  });
  it.each([
    "disconnect it and check if it's live",
    "how do I know if the cable is live?",
    "connect the leads and verify the bus is live",
    "what does connecting batteries live mean?",
    "connect the meter leads to see whether the terminals are live",
  ])("control, not an energized-work ask: %s", (q) => {
    expect(isEnergizedWorkAsk(q)).toBe(false);
  });
  it("control: an owner-decided banner phrase keeps its banner, not a STOP", () => {
    expect(isEnergizedWorkAsk("can I disconnect the live wire?")).toBe(false);
    expect(notebookSafetyTrigger("can I disconnect the live wire?")).toBe("live wire");
  });
});
