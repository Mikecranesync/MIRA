import { describe, expect, it } from "vitest";

import { declineKind, declineText, unidentifiedServiceDecline } from "./decline-next-step";

describe("declineKind", () => {
  it.each([
    "what's the default passcode for the hoist pendant",
    "I need the service password to get into the parameter menu",
    "is there a master code to unlock the HMI",
    "what is the PIN code for the operator panel",
    "What is the PIN for this panel?",
    "What is the service PIN on my Demag hoist?",
    "what's the service pin for the drive keypad",
    "What is the PIN for my PLC login? The M12 connector is working.",
    "what is the pin number for the operator keypad",
    // #4094 post-cap r3 F2: a lowercase login pin is still a credential
    "What is the pin for my PLC login, and what should I check first?",
    // #4094 post-cap r3 F3: a numbered cable pin must not hide the login PIN
    "What is the login PIN to unlock my PLC, and what does PIN 4 on its cable do?",
  ])("credential: %s", (m) => expect(declineKind(m)).toBe("credential"));

  it.each([
    "the actuator firmware got corrupted during an update, how do I recover it",
    "how do I reflash the firmware after it bricked",
    "firmware recovery on the AC 01.2",
    "My actuator firmware is corrupted. How do I recover it?",
  ])("service procedure: %s", (m) => expect(declineKind(m)).toBe("service_procedure"));

  it.each([
    "it keeps rebooting, what do I check first",
    "what firmware version supports Modbus TCP",
    "how do I update the parameter set",
    "the drive trips on F005, what should I check",
    "which pin on the M12 connector carries 24 V",
    "pin 3 of the encoder cable reads 0 V, what do I check",
    "Which PIN on my M12 connector carries 24 V?",
    "what does PIN 4 on the terminal block do",
    "What is PIN 4 on my PLC?",
    "what are PINs 3 and 5 for",
    "What does PIN number 4 on my PLC do?",
    "What does PIN 4 on the cable to the login keypad do?",
    // #4094 post-cap r3 F1: plural hardware "pin numbers" is a pinout question
    "Which pin numbers on my PLC connector carry 24 V, and what should I check first?",
    "the pin on the hoist pendant is bent, what do I check",
  ])("control — ordinary questions keep the generic decline: %s", (m) => expect(declineKind(m)).toBeNull());
});

describe("declineText", () => {
  it("credential routes to the owner / OEM, never to a manual upload", () => {
    const t = declineText("credential", "Demag DC-Pro", "Demag");
    expect(t).toContain("Demag service");
    expect(t).toContain("won't unlock");
    expect(t).not.toMatch(/upload (?:the|it|a manual) to this notebook/i);
  });

  it("service procedure names the OEM service channel and keeps the upload as a secondary path", () => {
    const t = declineText("service_procedure", "AUMA AC 01.2", "AUMA");
    expect(t).toContain("AUMA service");
    expect(t).toContain("won't guess");
  });
});

describe("unidentifiedServiceDecline (#4128)", () => {
  it("answers both halves of the #4101 service-only question", () => {
    const t = unidentifiedServiceDecline("How do I recover this actuator firmware by USB, and what is its service password?")!;
    expect(t).toContain("won't give generic steps");
    expect(t).toContain("make and model");
    expect(t).toContain("equipment owner or the manufacturer's service line");
  });

  it.each([
    ["what's the service password for this drive?", "service line", "won't give generic steps"],
    ["My actuator firmware is corrupted. How do I recover it?", "won't give generic steps", "service line"],
    ["The actuator firmware is corrupted. How do I recover it?", "won't give generic steps", "service line"],
    ["What is its service password?", "service line", "won't give generic steps"],
  ])("only the half that was asked: %s", (m, present, absent) => {
    const t = unidentifiedServiceDecline(m)!;
    expect(t).toContain(present);
    expect(t).not.toContain(absent);
  });

  it.each([
    "What does a service password protect on a drive?",
    "What is firmware recovery?",
    "it keeps rebooting, what do I check first",
    "Which pin numbers on my PLC connector carry 24 V?",
    "what firmware version supports Modbus TCP on my drive",
  ])("control — not a credential/recovery question about own equipment: %s", (m) => {
    expect(unidentifiedServiceDecline(m)).toBeNull();
  });

  it("never names a device or a manufacturer it was not given", () => {
    const t = unidentifiedServiceDecline("how do I reflash the firmware on this hoist after it bricked")!;
    expect(t).not.toMatch(/Demag|Siemens|Rockwell|Allen-Bradley|AUMA/);
  });
});
