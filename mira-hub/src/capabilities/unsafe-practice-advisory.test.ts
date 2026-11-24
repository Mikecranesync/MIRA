/**
 * #5864: the unsafe-practice detector, by class. The two reported asks, other
 * phrasings of the same practice, and the ordinary questions that must stay quiet.
 *
 * Run: npx vitest run src/capabilities/unsafe-practice-advisory.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  LIVE_SCREEN_CLEANING_CARD,
  OPEN_ENCLOSURE_CARD,
  unsafePractices,
  unsafePracticeWarning,
} from "./unsafe-practice-advisory";
import { isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";
import { safetyBypassAsk, safetyBypassWarning } from "./safety-bypass-advisory";

export const ROSA_SCREEN =
  "ops wipe the touch screen while the line runs and it keeps hitting the conveyor start button lol. can they just tape the edge and leave it on while cleaning";
export const ROSA_CABINET =
  "lost the key to the panel cabinet. gonna leave the door propped open so ops can reach the panel, thats fine right";

describe("#5864 preconditions: the reported asks reach no other notebook safety detector", () => {
  for (const msg of [ROSA_SCREEN, ROSA_CABINET]) {
    it(msg.slice(0, 50), () => {
      expect(notebookSafetyTrigger(msg)).toBeNull();
      expect(isEnergizedWorkAsk(msg)).toBe(false);
      expect(safetyBypassAsk(msg)).toBeNull();
      expect(safetyBypassWarning(msg)).toBeNull();
    });
  }
});

describe("live touch screen while cleaning", () => {
  for (const msg of [
    ROSA_SCREEN,
    "Can I wipe down the HMI while the machine is running?",
    "is it ok to clean the touchscreen with it on",
    "ops want to spray the screen with cleaner without switching it off",
    "we usually wash the operator panel while the line runs",
    "the hmi gets cleaned every shift, can we keep it on while we do it? we wipe the screen fast",
    "Can they wipe the screen while it’s still powered up?",
  ]) {
    it(`flags: ${msg}`, () => {
      expect(unsafePractices(msg)).toContain("live-screen-cleaning");
      expect(unsafePracticeWarning(msg)).toContain(LIVE_SCREEN_CLEANING_CARD);
    });
  }

  for (const msg of [
    "Which cleaning agents are approved for the touch screen?",
    "Switch the HMI off before wiping the screen, right?",
    "Don't leave it on while cleaning the screen. What's the cleaning screen function for?",
    "The display flickers while the drive is running, should I clean the contacts on the cable?",
    "What is the cleaning screen on a Basic Panel?",
    "How do I recalibrate the touch screen after an OS update?",
    "the screen is dirty",
  ]) {
    it(`quiet: ${msg}`, () => {
      expect(unsafePractices(msg)).not.toContain("live-screen-cleaning");
    });
  }
});

describe("electrical cabinet left open or unlocked", () => {
  for (const msg of [
    ROSA_CABINET,
    "I'm going to prop the cabinet door open for the night shift",
    "can we leave the control cabinet unlocked so ops can reset it",
    "the MCC door is wedged open, is that ok for a day",
    "Leaving the enclosure door open so it cools down, fine?",
    "we keep the panel door ajar so the operators can get to the breaker",
    "prop open the cabinet so I can see the drive display",
  ]) {
    it(`flags: ${msg}`, () => {
      expect(unsafePractices(msg)).toContain("open-electrical-enclosure");
      expect(unsafePracticeWarning(msg)).toContain(OPEN_ENCLOSURE_CARD);
    });
  }

  for (const msg of [
    "Lost the key to the panel cabinet, who has a spare?",
    "How do I open the cabinet door to replace the fan filter?",
    "The cabinet door is open alarm keeps showing on the HMI",
    "Keep the cabinet door closed and locked, never leave it open. What torque on the latch?",
    "In the breaker panel, leave the breaker open and lock it out before you start",
    "Close the enclosure door before you energize",
    "What is an enclosure rating like IP65?",
    "leave the project open on the tablet",
  ]) {
    it(`quiet: ${msg}`, () => {
      expect(unsafePractices(msg)).not.toContain("open-electrical-enclosure");
    });
  }
});

describe("composition", () => {
  it("both practices in one message give both cards, in a fixed order, once each", () => {
    const msg = `${ROSA_CABINET}. also ${ROSA_SCREEN}`;
    expect(unsafePractices(msg)).toEqual(["live-screen-cleaning", "open-electrical-enclosure"]);
    const card = unsafePracticeWarning(msg)!;
    expect(card).toBe(`${LIVE_SCREEN_CLEANING_CARD}\n\n${OPEN_ENCLOSURE_CARD}`);
  });

  it("an ordinary question gets nothing", () => {
    expect(unsafePracticeWarning("What does fault F004 mean?")).toBeNull();
    expect(unsafePracticeWarning("")).toBeNull();
  });

  it("the cards carry no page citation and no permission", () => {
    for (const c of [LIVE_SCREEN_CLEANING_CARD, OPEN_ENCLOSURE_CARD]) {
      expect(c).not.toMatch(/\bp\.\s?\d|\[\d\]|that'?s fine|is fine|you can\b/i);
    }
  });
});
