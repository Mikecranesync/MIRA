/**
 * #4095 — blank-chat identity proposals (propose, never bind).
 *
 * Run: npx vitest run src/capabilities/__tests__/identity-proposal.test.ts
 */
import { describe, expect, it } from "vitest";
import { modelAfterManufacturer, namesOnlyThisMachine, proposeIdentityFromText, unconfirmedMachineDirective } from "../identity-proposal";

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

  // #4160 S6 — PRD R16-lite: the candidate-basis acquisition status rides this
  // SAME directive as a verbatim-relay instruction (no new SSE frame).
  describe("acquisitionStatus (#4160 S6)", () => {
    const p = { manufacturer: "SMC", model: "SS5Y3-DUW01302" };

    it("omitted or null/empty leaves the directive byte-identical to before", () => {
      const base = unconfirmedMachineDirective(p);
      expect(unconfirmedMachineDirective(p, null)).toBe(base);
      expect(unconfirmedMachineDirective(p, "")).toBe(base);
      expect(unconfirmedMachineDirective(p, undefined)).toBe(base);
    });

    it("when present, is appended as a verbatim-relay instruction, after the base directive", () => {
      const status = "I'm looking for the official SMC SS5Y3-DUW01302 manual now.";
      const d = unconfirmedMachineDirective(p, status);
      expect(d.startsWith(unconfirmedMachineDirective(p))).toBe(true);
      expect(d).toContain(status);
      expect(d).toMatch(/in your own words/i);
    });
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

describe("Codex #4120 r14", () => {
  it.each(["Siemens MODBUS 40001 is not responding", "Siemens NEMA 4 enclosure leaks", "Siemens PROFINET 2 drops"])(
    "F18: a technology word is never the proposed model: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F18 control: an all-caps product family is still proposed", () => {
    expect(proposeIdentityFromText("Allen-Bradley SLC 5/03 is down", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r15", () => {
  it.each(["Siemens SN: 123456 is on the label", "Siemens SERIAL 123456 is on the label", "Siemens REV 3 board"])(
    "F19: a nameplate label + number is never the proposed model: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F19: a serial label is not a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley SLC 5/03 SN 123456 is on the label", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "SLC 5/03",
    });
  });
});

describe("Codex #4120 r16", () => {
  it("F19: a serial VALUE after a label is never a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley SLC 5/03 SN: AB1234 is on the label", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "SLC 5/03",
    });
  });
  it("F19: a label right after the manufacturer yields no model, even a parser-known one", () => {
    expect(proposeIdentityFromText("Siemens SN: PF525 is on the label", CORPUS)).toBeNull();
  });
  it.each(["Siemens S7-1200,TP700 comparison", "Siemens S7-1200/S7-1500 comparison", "Siemens S7-1200;TP700 comparison"])(
    "F20: punctuation-joined models are two machines: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F20 control: a family number with a slash is still one model", () => {
    expect(proposeIdentityFromText("The Allen-Bradley SLC 5/03 is down", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r17", () => {
  it.each(["Siemens PLC SN: PF525 is on the label", "Siemens SN:PF525 is on the label", "Siemens serial# PF525 on the plate"])(
    "F19: a serial value never becomes the model, wherever the label sits: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F19: a serial value is not a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley PF525 SN: PF753 is on the label", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "525",
    });
  });
  it("F19 control: lowercase prose words are not labels", () => {
    expect(proposeIdentityFromText("Compare Siemens S7-1200 and no S7-1500", CORPUS)).toBeNull();
    expect(proposeIdentityFromText("The Allen-Bradley SLC 5/03 has no power", CORPUS)).toEqual({ manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });
});

describe("Codex #4120 r18", () => {
  it.each([
    "Siemens Serial Number: PF525 is on the label",
    "Siemens SERIAL NUMBER: PF525 is on the label",
    "Siemens S/N No. PF525 is on the label",
    "Siemens part no. PF525 on the plate",
  ])("F19: a compound label's value is never the model: %s", (text) => {
    expect(proposeIdentityFromText(text, CORPUS)).toBeNull();
  });
  it("F19: a compound label's value is not a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley PF525 Serial Number: PF753 is on the label", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "525",
    });
  });
});

describe("Codex #4120 r19", () => {
  it.each(["Siemens Serial PF525 is on the label", "Siemens serial PF525 is on the label", "Siemens SN=PF525", "Siemens sn PF525 on it"])(
    "F19: a strong label takes its value in any case and separator: %s",
    (text) => expect(proposeIdentityFromText(text, CORPUS)).toBeNull(),
  );
  it("F19: a strong label's value is not a second machine", () => {
    expect(proposeIdentityFromText("Allen-Bradley PF525 Serial PF753 is on the label", CORPUS)).toEqual({
      manufacturer: "Allen-Bradley",
      model: "525",
    });
  });
  it("F19 control: weak everyday words still do not swallow a model", () => {
    expect(proposeIdentityFromText("Compare Siemens S7-1200 and no S7-1500", CORPUS)).toBeNull();
  });
});

// Codex r3 F5 (#4172): the corpus-independent fallback must keep the existing
// multi-machine rejection, not resurrect one machine from a comparison.
describe("namesOnlyThisMachine", () => {
  it("rejects a comparison that names a second model", () => {
    expect(namesOnlyThisMachine("Compare the manuals for Siemens 6ES7214-1AG40-0XB0 and TP700", "6ES7214-1AG40-0XB0")).toBe(false);
  });
  it("rejects a slash-joined second model", () => {
    expect(namesOnlyThisMachine("SS5Y3-DUW01302 or S7-1200 manual", "SS5Y3-DUW01302")).toBe(false);
  });
  it("accepts a message that names only the chosen part", () => {
    expect(namesOnlyThisMachine("Find the manual for the SMC SS5Y3-DUW01302", "SS5Y3-DUW01302")).toBe(true);
  });
  it("accepts a message that names no model at all", () => {
    expect(namesOnlyThisMachine("Find the manual for this", "6ES7214-1AG40-0XB0")).toBe(true);
  });
});

// Golden Walk baseline (2026-10-04): a series name between maker and model
// ("Siemens SINAMICS G120C") left 4 of 10 real machines with no proposal.
describe("Golden Walk — a product-series name before the model", () => {
  const MAKERS = [...CORPUS, "Schneider Electric", "Danfoss"];
  it("skips a series name to the model", () => {
    expect(proposeIdentityFromText("I'm at a Siemens SINAMICS G120C drive and need its manual", MAKERS)).toEqual({ manufacturer: "Siemens", model: "G120C" });
    expect(proposeIdentityFromText("Schneider Electric Altivar ATV320 tripped", MAKERS)).toEqual({ manufacturer: "Schneider Electric", model: "ATV320" });
  });
  it("skips two series names to a family-code model", () => {
    expect(proposeIdentityFromText("Danfoss VLT AutomationDrive FC 302 alarm", MAKERS)).toEqual({ manufacturer: "Danfoss", model: "FC 302" });
  });
  it("control: a span the plain parse already finds is not re-read ('VLT 5000')", () => {
    expect(proposeIdentityFromText("Danfoss VLT 5000 alarm", MAKERS)).toEqual({ manufacturer: "Danfoss", model: "VLT 5000" });
  });
  it("control: an unknown capitalised word is never skipped", () => {
    expect(proposeIdentityFromText("Siemens Please G120C", MAKERS)).toBeNull();
  });
  it("control: a series name with no model after it proposes nothing", () => {
    expect(proposeIdentityFromText("Siemens SINAMICS drive keeps tripping", MAKERS)).toBeNull();
  });
  it("control: a serial label after a series name is still never a model", () => {
    expect(proposeIdentityFromText("Siemens SINAMICS SN12345678 keeps faulting", MAKERS)).toBeNull();
  });
  it("control: two machines behind series names stay ambiguous", () => {
    expect(proposeIdentityFromText("Compare Siemens SINAMICS G120C and SINAMICS G120X", MAKERS)).toBeNull();
  });
  it("Codex #4228 F1: a rating after two series names keeps its unit in view and is never a model", () => {
    expect(proposeIdentityFromText("Danfoss VLT AutomationDrive DC 24 V supply failed", MAKERS)).toBeNull();
    expect(proposeIdentityFromText("Danfoss VLT AutomationDrive AC 230 volts supply failed", MAKERS)).toBeNull();
    expect(proposeIdentityFromText("Danfoss VLT AutomationDrive FC 302 alarm", MAKERS)).toEqual({ manufacturer: "Danfoss", model: "FC 302" });
  });
  it("control: at most two series words are skipped", () => {
    expect(proposeIdentityFromText("Danfoss VLT AutomationDrive AquaDrive FC 302", MAKERS)).toBeNull();
  });
});

// Golden Walk 2026-10-05 (staging a9795440): "I'm at an ABB ACS580 drive" was
// proposed as model "580". The manual search then could not confirm the ACS580
// manual covered "580", left it off, and ABB flipped between PASS and FAIL. The
// parser narrows ACS to its digits on purpose (model_number substring scoping),
// but the identity a technician confirms is the manufacturer's model name.
describe("an ACS model keeps its series in the proposal", () => {
  const ABB = ["ABB", "Rockwell Automation", "Siemens"];
  it("proposes ACS580 for a joined ACS580", () => {
    expect(proposeIdentityFromText("I'm at an ABB ACS580 drive and need its manual", ABB)).toEqual({ manufacturer: "ABB", model: "ACS580" });
  });
  it("proposes ACS355 for a spaced 'ACS 355'", () => {
    expect(proposeIdentityFromText("ABB ACS 355 trips on overvoltage", ABB)).toEqual({ manufacturer: "ABB", model: "ACS355" });
  });
  it("is the same machine when the model is repeated in either spelling", () => {
    expect(proposeIdentityFromText("ABB ACS580 faulted. What does fault 3210 mean on the ACS580?", ABB)).toEqual({ manufacturer: "ABB", model: "ACS580" });
  });
  it("control: PowerFlex and Micro aliases still narrow to the family number", () => {
    expect(proposeIdentityFromText("Rockwell Automation PF525 trips on startup", ABB)).toEqual({ manufacturer: "Rockwell Automation", model: "525" });
    expect(proposeIdentityFromText("Rockwell Automation Micro820 lost its program", ABB)).toEqual({ manufacturer: "Rockwell Automation", model: "820" });
  });
  it("control: two different ACS models are still two machines", () => {
    expect(proposeIdentityFromText("Compare ABB ACS580 and ACS880", ABB)).toBeNull();
  });
});

// Golden Walk 2026-10-05: "I'm at an SEW-Eurodrive MOVITRAC LTE-B drive" got no
// proposal. SEW-Eurodrive is in the library; the variant "LTE-B" carries no digit,
// so it never parsed as a model. After a KNOWN series name, a hyphenated
// all-caps variant code is the model, and the series stays in it — "LTE-B"
// alone names nothing a manual search can confirm.
describe("a digitless variant code after a known series name", () => {
  const SEW = ["SEW-Eurodrive", "Siemens", "Rockwell Automation"];
  it("proposes MOVITRAC LTE-B", () => {
    expect(proposeIdentityFromText("I'm at an SEW-Eurodrive MOVITRAC LTE-B drive and need its manual", SEW)).toEqual({
      manufacturer: "SEW-Eurodrive",
      model: "MOVITRAC LTE-B",
    });
  });
  it("proposes MOVITRAC LTP-B", () => {
    expect(proposeIdentityFromText("SEW-Eurodrive MOVITRAC LTP-B shows O-Volt", SEW)).toEqual({
      manufacturer: "SEW-Eurodrive",
      model: "MOVITRAC LTP-B",
    });
  });
  it("control: without a series name a digitless code is never a model", () => {
    expect(proposeIdentityFromText("SEW-Eurodrive LTE-B drive faulted", SEW)).toBeNull();
  });
  it("control: an ordinary capitalised word after a series name is never a model", () => {
    expect(proposeIdentityFromText("Siemens SINAMICS FAULT on the line", SEW)).toBeNull();
    expect(proposeIdentityFromText("Siemens SINAMICS VFD keeps tripping", SEW)).toBeNull();
  });
  it("control: an interface or label code after a series name is never a model", () => {
    expect(proposeIdentityFromText("SEW-Eurodrive MOVITRAC RS-485 link down", SEW)).toBeNull();
    expect(proposeIdentityFromText("SEW-Eurodrive MOVITRAC SN-AB serial", SEW)).toBeNull();
  });
  it("control: two variants are two machines", () => {
    expect(proposeIdentityFromText("Compare SEW-Eurodrive MOVITRAC LTE-B and MOVITRAC LTP-B", SEW)).toBeNull();
  });
  it("control: a digit-bearing model after a series name keeps its existing form", () => {
    expect(proposeIdentityFromText("Siemens SINAMICS G120C trips on overvoltage", SEW)).toEqual({ manufacturer: "Siemens", model: "G120C" });
  });
});
