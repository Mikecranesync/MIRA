/**
 * #4095 — blank-chat identity proposals (propose, never bind).
 *
 * Run: npx vitest run src/capabilities/__tests__/identity-proposal.test.ts
 */
import { describe, expect, it } from "vitest";
import { modelAfterManufacturer, proposeIdentityFromText, unconfirmedMachineDirective } from "../identity-proposal";

// corpusManufacturers() CANONICALIZES (normalizeManufacturer): staging's
// "Allen-Bradley" rows are listed as "Rockwell Automation", "Mitsubishi" as
// "Mitsubishi Electric". AUMA, ProSoft, SMC and StepperOnline were absent
// (read-only staging query, 2026-09-29).
const CORPUS = ["Rockwell Automation", "FESTO", "Mitsubishi Electric", "Siemens", "AutomationDirect", "Columbus McKinnon"];

describe("proposeIdentityFromText — the Answer Radar new_chat seeds (2026-09-27 freeze)", () => {
  it.each([
    ["FIELD-SEED-001", "An Allen-Bradley SLC 5/03 is on a DH-485 network. A technician wants to replace the interface", { manufacturer: "Allen-Bradley", model: "SLC 5/03" }],
    ["FIELD-SEED-002", "A Festo SPC-100-P-F controller throws a positioning error", { manufacturer: "Festo", model: "SPC-100-P-F" }],
    ["FIELD-SEED-004", "A Mitsubishi FX5U reads a Baykon indicator over RS-485", { manufacturer: "Mitsubishi", model: "FX5U" }],
  ])("%s → proposes the named machine", (_id, text, want) => {
    expect(proposeIdentityFromText(text, CORPUS)).toEqual(want);
  });

  it.each([
    ["FIELD-SEED-003 (AUMA not in the library)", "An AUMA AC 01.2 actuator will not respond to the remote command"],
    ["FIELD-SEED-005 (ProSoft not in the library)", "A ProSoft PLX32 gateway drops EtherNet/IP connections"],
    ["FIELD-SEED-006 (no manufacturer named)", "The G+ Mini hoist controller asks for a passcode"],
  ])("%s → no proposal", (_id, text) => {
    expect(proposeIdentityFromText(text, CORPUS)).toBeNull();
  });
});

describe("proposeIdentityFromText — negative controls (#4095 acceptance)", () => {
  it("a teaching question gets no proposal", () => {
    expect(proposeIdentityFromText("How does a VFD work?", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("What is a PLC scan cycle", CORPUS)).toBeNull();
  });
  it("a manufacturer alone never yields a proposal (#3970)", () => {
    expect(proposeIdentityFromText("Our Siemens drive keeps tripping", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Allen-Bradley support said to call back", CORPUS)).toBeNull();
  });
  it("two different models named → ambiguous → no proposal", () => {
    expect(proposeIdentityFromText("Swap the Allen-Bradley PowerFlex 525 for a PowerFlex 753?", CORPUS)).toBeNull();
  });
  it("a fault code after the manufacturer is never taken as the model (UNS rule 4)", () => {
    expect(proposeIdentityFromText("Allen-Bradley F004 on the line drive", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Allen-Bradley fault F004 on the line drive", CORPUS)).toBeNull();
  });
  it("the existing parser still wins when it recognizes the model", () => {
    expect(proposeIdentityFromText("Allen-Bradley PowerFlex 525 shows F004", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "525" });
    expect(proposeIdentityFromText("AutomationDirect GS10 won't start", CORPUS)).toEqual({ manufacturer: "AutomationDirect", model: "GS10" });
  });
  it("a manufacturer the library does not hold gets no proposal", () => {
    expect(proposeIdentityFromText("An SMC VQ1000-FPG-C6C6-D check block", CORPUS)).toBeNull();
  });
});

describe("manufacturerMentionInText — vendor-group spellings, kept as written", () => {
  it("finds Allen-Bradley through its canonical Rockwell Automation", async () => {
    const { manufacturerMentionInText } = await import("../identity-proposal");
    expect(manufacturerMentionInText("the allen-bradley slc", CORPUS)).toBe("allen-bradley");
    expect(manufacturerMentionInText("Rockwell Automation MicroLogix 1400", CORPUS)).toBe("Rockwell Automation");
  });
  it("never matches inside another word", async () => {
    const { manufacturerMentionInText } = await import("../identity-proposal");
    expect(manufacturerMentionInText("the festoon lighting", CORPUS)).toBeNull();
  });
});

describe("modelAfterManufacturer", () => {
  it("strips trailing punctuation and keeps model punctuation", () => {
    expect(modelAfterManufacturer("the Allen-Bradley SLC 5/03, on DH-485", "Allen-Bradley")).toBe("SLC 5/03");
    expect(modelAfterManufacturer("a Festo SPC-100-P-F.", "FESTO")).toBe("SPC-100-P-F");
  });
  it("a lower-case word after the manufacturer is not a model", () => {
    expect(modelAfterManufacturer("Allen-Bradley drives are fine", "Allen-Bradley")).toBeNull();
  });
  it("tries every mention, not just the first", () => {
    expect(modelAfterManufacturer("Siemens told us to check the Siemens S7-1200 first", "Siemens")).toBe("S7-1200");
  });
});

describe("unconfirmedMachineDirective", () => {
  it("names the machine and forbids machine-specific facts and procedures", () => {
    const d = unconfirmedMachineDirective({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
    expect(d).toContain("Allen-Bradley SLC 5/03");
    expect(d).toContain("NOT confirmed");
    expect(d).toMatch(/Do NOT state its ratings, specifications/);
    expect(d).toMatch(/firmware or service procedure/);
  });
});

describe("Codex #4120 review — never a mixed, ambiguous or non-model proposal", () => {
  it("F1: a model is bound to ITS manufacturer; two different machines → no proposal", () => {
    expect(proposeIdentityFromText("A Siemens TP700 is connected to an Allen-Bradley SLC 5/03.", CORPUS)).toBeNull();
  });
  it("F1 control: the same machine named twice is still one proposal", () => {
    expect(proposeIdentityFromText("The Allen-Bradley SLC 5/03 faulted; is the Allen-Bradley SLC 5/03 battery low?", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "SLC 5/03",
    });
  });
  it("F2: a second model of the same family without the manufacturer repeated → no proposal", () => {
    expect(proposeIdentityFromText("Compare the Mitsubishi FX5U and FX3U for this job", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Is an Allen-Bradley SLC 5/03 better than an SLC 5/04 here?", CORPUS)).toBeNull();
  });
  it("F5: an IP address, MAC or serial after the manufacturer is never a model", () => {
    expect(proposeIdentityFromText("The Siemens 192.168.1.100 is unreachable.", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Siemens SN12345678 keeps faulting", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Siemens 1200 won't start", CORPUS)).toBeNull();
  });
  it("F5 control: a real letters+digits model still proposes", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 won't start", CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" });
  });
});

describe("Codex #4120 r2 — other-family models and sensitive free text", () => {
  it("F2: a second model of ANOTHER family → no proposal", () => {
    expect(proposeIdentityFromText("Compare Mitsubishi FX5U and Q03UDECPU", CORPUS)).toBeNull();
  });
  it("F2 control: interface/protocol tokens are not second machines", () => {
    expect(proposeIdentityFromText("A Mitsubishi FX5U reads a Baykon indicator over RS-485 at 24VDC", CORPUS)).toEqual({
      manufacturer: "Mitsubishi",
      model: "FX5U",
    });
    expect(proposeIdentityFromText("An Allen-Bradley SLC 5/03 is on a DH-485 network in an IP65 box", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "SLC 5/03",
    });
  });
  it("F5: serials, usernames and generic words never become a model", () => {
    expect(proposeIdentityFromText("Siemens PLC SN12345678 keeps faulting", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Siemens john.smith123 is my login", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Siemens AB12345678 order number", CORPUS)).toBeNull();
  });
  it("F5 control: a generic device word before a real model is skipped, not joined", () => {
    expect(proposeIdentityFromText("Siemens PLC S7-1200 won't start", CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" });
  });
});

describe("Codex #4120 r3", () => {
  it("F2: a multi-token model of another family ('MicroLogix 1400') → no proposal", () => {
    expect(proposeIdentityFromText("Compare Allen-Bradley SLC 5/03 and MicroLogix 1400", CORPUS)).toBeNull();
  });
  it("F8: a parser-recognized alias of the chosen model is not a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley PF525 trips on startup", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "525" });
    expect(proposeIdentityFromText("Allen-Bradley Micro820 lost its program", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });
  it("F8 control: the r2 other-family case still refuses", () => {
    expect(proposeIdentityFromText("Compare Mitsubishi FX5U and Q03UDECPU", CORPUS)).toBeNull();
  });
});


describe("Codex #4120 r4", () => {
  it.each([
    "Compare Siemens S7-1200 and TP700",
    "Compare Siemens TP700 and S7-1200",
    "Compare Allen-Bradley SLC 5/03 and PLC 5/40",
    "Compare Allen-Bradley PLC 5/40 and SLC 5/03",
  ])("F2: two different machines in a comparison → no proposal: %s", (text) => {
    expect(proposeIdentityFromText(text, CORPUS)).toBeNull();
  });
  it("F9: repeating the chosen model still proposes", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 faults. The S7-1200 is on Ethernet.", CORPUS)).toEqual({
      manufacturer: "Siemens",
      model: "S7-1200",
    });
    expect(proposeIdentityFromText("Allen-Bradley PF525 trips. How do I diagnose PF525?", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "525",
    });
  });
  it("F9 control: a different second model still refuses", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 faults. The S7-1500 is on Ethernet.", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Allen-Bradley PF525 trips. How do I diagnose PF753?", CORPUS)).toBeNull();
  });
});

describe("Codex #4120 r5", () => {
  it.each(["Siemens 4-20mA transmitter is not responding", "Siemens 0-10V sensor stopped working"])(
    "F10: a signal range is never a model: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F10: a signal range is not a second machine", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 reads a 4-20mA sensor", CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" });
  });
  it("F11: a panel's own 6AV catalog number keeps the proposal", () => {
    expect(proposeIdentityFromText("Siemens TP700 Comfort will not boot", CORPUS)).toEqual({ manufacturer: "Siemens", model: "TP700" });
    expect(proposeIdentityFromText("Siemens TP700 Comfort 6AV2124-0GC01-0AX0 will not boot", CORPUS)).toEqual({
      manufacturer: "Siemens",
      model: "TP700",
    });
  });
  it("F11 control: a 6AV number next to a non-panel model, or a second model, still refuses", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 with 6AV2124-0GC01-0AX0 panel", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("Compare Siemens S7-1200 and TP700", CORPUS)).toBeNull();
  });
});

describe("Codex #4120 r6", () => {
  it.each(["Siemens DC 24V power supply is dead", "Siemens AI 4-20mA input is stuck", "Siemens AC 230V motor stopped"])(
    "F10: a family word + rating or range is never a model: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F10 control: a family word + part number still proposes", () => {
    expect(proposeIdentityFromText("The Allen-Bradley SLC 5/03 is down", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r7", () => {
  it.each(["Siemens DC 24 V power supply is dead", "Siemens AC 230 V motor stopped", "Siemens DC 24 volts power supply is dead"])(
    "F10: a spaced rating is never a model: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F10: a spaced rating is not a second machine", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 on a DC 24 V supply keeps faulting", CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" });
  });
  it("F10 control: a family code + number followed by an ordinary word still proposes", () => {
    expect(proposeIdentityFromText("The Allen-Bradley SLC 5/03 processor faulted", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r8", () => {
  it.each(["Compare Mitsubishi FX5U and fx3u", "Compare Siemens S7-1200 and s7-1500", "Compare Siemens s7-1500 and S7-1200"])(
    "F12: a lowercase second model still refuses: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F12 control: the same model repeated in lowercase still proposes", () => {
    expect(proposeIdentityFromText("Siemens S7-1200 faults; the s7-1200 is on Ethernet", CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" });
  });
});

describe("Codex #4120 r9", () => {
  it.each(["Compare Allen-Bradley SLC 5/03 and slc 5/04", "Compare Allen-Bradley SLC 5/03 and micrologix 1400"])(
    "F12: a lowercase multi-word second model still refuses: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it.each([
    "The Allen-Bradley SLC 5/03 faulted for 2 hours",
    "The Allen-Bradley SLC 5/03 shows it on page 12",
    "Allen-Bradley SLC 5/03 lost comms on port 44818",
  ])("F12 control: ordinary prose numbers do not block the proposal: %s", (text) => {
    expect(proposeIdentityFromText(text, CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r10", () => {
  it.each([
    ["Siemens S7-1200 has 100 inputs", { manufacturer: "Siemens", model: "S7-1200" }],
    ["Allen-Bradley SLC 5/03 lost comms at baud 19200", { manufacturer: "Allen-Bradley", model: "SLC 5/03" }],
    ["Allen-Bradley SLC 5/03 ran 100 hours before it faulted", { manufacturer: "Allen-Bradley", model: "SLC 5/03" }],
  ])("F13: an ordinary word before a number does not block the proposal: %s", (text, want) => {
    expect(proposeIdentityFromText(text, CORPUS)).toEqual(want);
  });
  it.each(["Compare Allen-Bradley SLC 5/03 and compactlogix 5380", "Compare Allen-Bradley SLC 5/03 and slc 5/05"])(
    "F13 control: a recognized lowercase family still refuses: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
});

describe("Codex #4120 r11", () => {
  it.each([
    ["Siemens S7-1200 reads Modbus 40001", { manufacturer: "Siemens", model: "S7-1200" }],
    ["Allen-Bradley SLC 5/03 lost comms on Modbus 1", { manufacturer: "Allen-Bradley", model: "SLC 5/03" }],
    ["Siemens S7-1200 uses encoder 1024 pulses per revolution", { manufacturer: "Siemens", model: "S7-1200" }],
  ])("F14: an equipment category before a number is not a second machine: %s", (text, want) => {
    expect(proposeIdentityFromText(text, CORPUS)).toEqual(want);
  });
  it("F15: a lowercase generic device family with a separated number still refuses", () => {
    expect(proposeIdentityFromText("Compare Allen-Bradley SLC 5/03 and plc 5/40", CORPUS)).toBeNull();
  });
});

describe("Codex #4120 r12", () => {
  it.each(["Compare Allen-Bradley SLC 5/03 and kinetix 5500", "Compare Allen-Bradley SLC 5/03 and stratix 5700"])(
    "F16: a servo or network product line is a second machine: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it.each([
    ["Siemens S7-1200 on profinet 2 keeps dropping", { manufacturer: "Siemens", model: "S7-1200" }],
    ["Siemens S7-1200 reads Modbus 40001", { manufacturer: "Siemens", model: "S7-1200" }],
  ])("F16 control: a technology word is still not a machine: %s", (text, want) => {
    expect(proposeIdentityFromText(text, CORPUS)).toEqual(want);
  });
});

describe("Codex #4120 r13", () => {
  it.each(["Siemens S7-1200 reads MODBUS 40001", "Siemens S7-1200 reads ModBus 40001", "Siemens S7-1200 on PROFINET 2"])(
    "F17: a technology word is not a machine in any case: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toEqual({ manufacturer: "Siemens", model: "S7-1200" }),
  );
  it("F17 control: an uppercase product family is still a second machine", () => {
    expect(proposeIdentityFromText("Compare Allen-Bradley SLC 5/03 and SLC 5/04", CORPUS)).toBeNull();
  });
});
