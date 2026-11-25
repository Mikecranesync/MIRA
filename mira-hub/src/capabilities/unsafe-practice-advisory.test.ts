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
    // #5905 Codex r1 F1: a "what is" opener, and a report of the running line in its own sentence.
    "What is the safest way to wipe the touch screen while the line runs?",
    "The line is running. Can I wipe the HMI now?",
    "explain how to wipe the hmi while it's on",
    "the conveyor is running, the operators clean the touch screen anyway",
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
    // #5905 Codex r1 F3: the live state belongs to other equipment.
    "I turn off the HMI before wiping the touch screen. Should I leave the exhaust fan on?",
    "wipe the hmi while the exhaust fan runs",
    // "on" as a place, and a machine that is stopped.
    "The HMI is on the left side of the panel, how do I clean it?",
    "The machine is off. Can I wipe the screen now?",
    "the line is on break, can I wipe the screen",
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
    // #5905 Codex r1 F1: a direct report of the unsecured cabinet.
    "The electrical cabinet is open and unlocked.",
    "the MCC door was left open all night",
    "the cabinet's been open all night, is that ok",
    "the panel door is ajar",
    "the enclosure lid got left open",
    "the junction box cover is unlatched",
    "close the cabinet door without locking it, ok?",
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
    // #5905 Codex r1 F3: the open door is not the cabinet's.
    "The control cabinet is locked. Can I leave the shop door open for ventilation?",
    "the shop door is propped open, the control cabinet is fine",
    "close the shop door without locking it, the panel cabinet is shut",
    "The cabinet is closed. The door to the shop is open, can I clean the HMI?",
    // A cabinet open for work, a negated report, alarm labels and a definition.
    "the cabinet is open now, I'm replacing the fan filter, LOTO is done",
    "the panel door is not ajar",
    "Is the cabinet unlocked alarm a real fault?",
    "The enclosure door is ajar alarm keeps showing on the HMI",
    "the panel door was left open alarm is latched",
    "What is a cabinet door switch?",
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

/** #5905 Codex r2 F1: the short forms Codex found that no detector caught. */
const R2_SCREEN = "Can I wipe the HMI while powered on?";
const R2_MCC = "Can I leave the MCC open overnight?";
/** #5905 Codex r2 F3: a safe state, and an unrelated door, that were warned on. */
const R2_POWERED_OFF = "The HMI is powered off. Can I wipe the screen?";
const R2_SHOP_DOOR = "The electrical cabinet is locked. The shop door sticks. Can I prop it open?";

describe("#5905 r2 F1: the subject left out, and an enclosure as the thing left open", () => {
  it("precondition: neither message reaches any other notebook safety detector", () => {
    for (const msg of [R2_SCREEN, R2_MCC]) {
      expect(notebookSafetyTrigger(msg)).toBeNull();
      expect(isEnergizedWorkAsk(msg)).toBe(false);
      expect(safetyBypassAsk(msg)).toBeNull();
      expect(safetyBypassWarning(msg)).toBeNull();
    }
  });

  for (const msg of [R2_SCREEN, "Can I clean the touch screen while running?", "ok to wipe the screen while still energized"]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["live-screen-cleaning"]));
  }
  for (const msg of [
    R2_MCC,
    "Can I leave the electrical panel open?",
    "Can I leave the switchgear unlocked tonight?",
    "leave the motor control center open over the weekend?",
    "can I prop open the MCC",
  ]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["open-electrical-enclosure"]));
  }
  for (const msg of ["Can I wipe the HMI while powered off?", "wipe the hmi while on shift?"]) {
    it(`quiet: ${msg}`, () => expect(unsafePractices(msg)).toEqual([]));
  }
});

describe("#5905 r2 F3: a full power state, and a pronoun read against the door it follows", () => {
  for (const msg of [
    R2_POWERED_OFF,
    "The HMI is powered down, can I clean the display?",
    R2_SHOP_DOOR,
    "The electrical cabinet is locked. The drain valve is stuck, can I leave it open?",
  ]) {
    it(`quiet: ${msg}`, () => expect(unsafePractices(msg)).toEqual([]));
  }
  // Controls: the same shapes, about the live screen and the cabinet, still warn.
  for (const msg of ["The HMI is powered on. Can I wipe the screen?", "The HMI is on. Can I wipe the screen?"]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["live-screen-cleaning"]));
  }
  for (const msg of [
    "The electrical cabinet door won't latch. Can I prop it open?",
    "The electrical cabinet won't close, can I just tape it open?",
    // An unqualified door, with a cabinet named, may be the cabinet's own: warn.
    "The electrical cabinet is locked. The door sticks. Can I prop it open?",
    // Nothing named before the pronoun: it points ahead, to the cabinet.
    "can I prop it open? the electrical cabinet key is lost",
  ]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["open-electrical-enclosure"]));
  }
});

describe("#5905 r2: a switching device left open is the safe state, and a power source is not a power state", () => {
  for (const msg of [
    "Can I leave the MCC breaker open and lock it out?",
    "leave the MCC disconnect open",
    "Can I leave the switchgear disconnect open?",
    "leave the electrical panel breaker open",
    "The MCC is locked out. The breaker tripped, can I leave it open?",
  ]) {
    it(`quiet: ${msg}`, () => expect(unsafePractices(msg)).not.toContain("open-electrical-enclosure"));
  }
  for (const msg of [
    "The HMI is powered by 24 V. Can I wipe the screen?",
    "The HMI is powered from the panel. can I wipe the screen",
    "Can I wipe the HMI while powered by the UPS?",
  ]) {
    it(`quiet: ${msg}`, () => expect(unsafePractices(msg)).not.toContain("live-screen-cleaning"));
  }
  // Controls: an enclosure named by its switching device, and a bare powered state, still warn.
  for (const msg of [
    "Can I leave the breaker box open?",
    "The breaker tripped. The MCC door won't close, can I prop it open?",
  ]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["open-electrical-enclosure"]));
  }
  for (const msg of ["Can I wipe the HMI while powered?", "the hmi is powered and running, can I wipe the screen"]) {
    it(`warns: ${msg}`, () => expect(unsafePractices(msg)).toEqual(["live-screen-cleaning"]));
  }
});
