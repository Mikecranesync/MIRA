import { describe, expect, it } from "vitest";

import { declineKind, declineText } from "./decline-next-step";

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
