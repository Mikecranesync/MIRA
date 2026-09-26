import { describe, expect, it } from "vitest";
import { asksForDocumentedValue } from "./documented-value-question";

describe("#4004 asksForDocumentedValue", () => {
  it.each([
    "what supply voltage does the TP700 Comfort panel need and what is its operating temperature range",
    "what is the rated current of this drive",
    "what's the IP rating",
    "give me the wiring for the encoder",
    "which parameter sets the accel time",
    "what are the dimensions",
  ])("documented value: %s", (q) => expect(asksForDocumentedValue(q)).toBe(true));

  it.each([
    "it keeps rebooting, what do I check first",
    "how does a touch panel work",
    "what is MQTT",
    "why would a contactor chatter",
    "what does fault code F004 mean on this unit", // E10's floor owns code meanings
    // #4010 review (mira-f1's probe set) — teaching questions keep answering.
    "what is voltage?",
    "what's the difference between rated and nominal current?",
    "tell me what a parameter is",
    "what does IP rating mean in general?",
    "what is a catalog number used for?",
    "how do I read a wiring diagram?",
    "why would a panel lose power?",
    "",
  ])("not a documented-value question: %s", (q) => expect(asksForDocumentedValue(q)).toBe(false));
});
