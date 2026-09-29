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

