import { describe, expect, it } from "vitest";
import { asksAboutThisEquipment, asksForDocumentedValue } from "./documented-value-question";

describe("#4004 asksForDocumentedValue", () => {
  it.each([
    "what supply voltage does the TP700 Comfort panel need and what is its operating temperature range",
    "what is the rated current of this drive",
    "what's the IP rating",
    "give me the wiring for the encoder",
    "which parameter sets the accel time",
    "what are the dimensions",
    // #4010 round 2 — the binding lands AFTER the value word; must still abstain.
    "what is voltage rating for this panel?",
    "what is supply voltage on the TP700?",
    "what is operating temperature for my panel?",
    // #4015 — drive-tuning quantities a technician asks about on a bound VFD.
    "what carrier frequency should this drive not exceed above 20hp",
    "what is the max frequency for this drive",
    "what accel time should I use on my GS10",
    "what's the decel time default on this drive",
    "what fuse size does this drive need",
    "what wire size do I need for this drive",
    "what is the overload rating of this motor",
  ])("documented value: %s", (q) => expect(asksForDocumentedValue(q)).toBe(true));

  it("the bound model's own name binds a bare 'what is' question", () => {
    expect(asksForDocumentedValue("what is supply voltage TP700", "TP700 Comfort")).toBe(true);
    expect(asksForDocumentedValue("what is supply voltage TP700", null)).toBe(false);
  });

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
    // #4010 round 3 — "in the" is idiom, not a binding.
    "what is voltage in the first place?",
    "what is torque, in the general sense?",
    // #4015 — the new drive vocabulary stays conceptual when unbound.
    "what is carrier frequency?",
    "what does carrier frequency mean",
    "why would I lower the carrier frequency",
    "",
  ])("not a documented-value question: %s", (q) => expect(asksForDocumentedValue(q)).toBe(false));
});

// #4068 (owner decision 2026-09-27): a machine-bound notebook whose search found
// nothing citable declines honestly for a question about THIS equipment — but a
// teaching question keeps answering (#4010 over-block guard).
describe("#4068 asksAboutThisEquipment", () => {
  it.each([
    // The Answer Radar seeds, verbatim.
    [
      "An Allen-Bradley SLC 5/03 is on a DH-485 network. A technician wants to replace the existing protocol-aware interface with a USR-N540 transparent RS-485-to-Ethernet converter. After the swap the PLC stops communicating. Why does this happen and what should be checked first?",
      "SLC 5/03",
    ],
    [
      "An AUMA AC 01.2 actuator controller lost power during a firmware update and is now stuck in bootloader mode. How do I recover it?",
      "AC 01.2",
    ],
    ["the drive trips on overcurrent every morning, what should I check", "PowerFlex 525"],
    ["how do I reset the pass code on the hoist", "Lodestar"],
    ["it stopped communicating after we replaced the module", "PLX32"],
    ["why does my GS10 fault when the conveyor starts", "GS10"],
    ["how do I connect this indicator to the PLC over Modbus TCP", "BX11-EN"],
    // Codex #4069 F1: teaching phrasing wrapped around a problem on THIS machine.
    ["How does my drive work when it trips on F005, and what should I check first?", "PowerFlex 525"],
    ["what does F005 mean on my drive and how do I clear it", "PowerFlex 525"],
    ["How do I wire this drive?", "PowerFlex 525"],
    ["What should I check when this drive trips?", "PowerFlex 525"],
    // Codex #4069 pass 8: an incidental "a power outage" is not a class subject.
    ["The drive trips after a power outage; what should I check first?", "PowerFlex 525"],
    // Codex #4069 pass 9 F1: an incidental "a contactor" does not make a
    // symptom on THE drive a class question.
    ["The drive trips after we replaced a contactor; what should I check first?", "PowerFlex 525"],
    ["the conveyor motor faults whenever a sensor is blocked", "GS10"],
    // Codex #4069 pass 10: a pronoun on THIS drive still binds; a mixed
    // code-meaning + symptom question is troubleshooting.
    ["Why does my drive trip when it overheats?", "PowerFlex 525"],
    ["What does F005 mean on my drive, and why does it keep tripping?", "PowerFlex 525"],
    // Codex #4069 pass 11 F1: any second clause ends the pure code-meaning exception.
    ["What does F005 mean on my drive, and why is it overheating?", "PowerFlex 525"],
    ["what does F005 mean on my drive? how do I stop it", "PowerFlex 525"],
    // Codex #4069 pass 12: a condition on THIS machine ends the "how does X work" teaching read.
    ["How does my drive work when it overheats?", "PowerFlex 525"],
    ["how does this drive work if the fan is blocked", "PowerFlex 525"],
    ["the drive is overheating, what should I look at", "PowerFlex 525"],
    // Codex #4069 pass 13: a symptom declines unless the question is explicitly general.
    ["What is causing the drive to trip every morning?", "PowerFlex 525"],
    ["what is making the conveyor stop randomly", "GS10"],
    // Codex #4069 pass 14: "what is …" teaches only as a concept definition.
    ["What is wrong with the drive?", "PowerFlex 525"],
    ["what's going on with the conveyor", "GS10"],
    ["what is the problem with the hoist", "Lodestar"],
    ["what are the settings for the drive", "PowerFlex 525"],
    // Codex #4069 pass 15: the code-meaning exception needs an actual fault code.
    ["What does the flashing red light mean on my drive?", "PowerFlex 525"],
    ["what does it mean when the drive beeps twice", "PowerFlex 525"],
    // Codex #4069 pass 16: a code-shaped MODEL name is not a fault code.
    ["What does the flashing red light mean on my TP700?", "TP700 Comfort"],
    ["what does the ERR light mean on the PLX32", "PLX32"],
    // Codex #4069 pass 17: an explicit tie to THIS machine outranks a general marker.
    ["Explain the wiring diagram for my TP700", "TP700 Comfort"],
    ["Explain what voltage my TP700 needs", "TP700 Comfort"],
    ["what is this drive's DIP switch used for", "PowerFlex 525"],
    ["how does the reset procedure on my TP700 work", "TP700 Comfort"],
    ["how does the backup battery in this drive work", "PowerFlex 525"],
    // Codex #4069 pass 18 F1: "explain" does not outrank a described symptom.
    ["Explain why the drive trips", "PowerFlex 525"],
    ["explain the wiring for the drive", "PowerFlex 525"],
    ["Explain the drive's wiring", "PowerFlex 525"],
    // Codex #4069 pass 19: a symptom or condition INSIDE the meaning clause
    // ends the pure code-meaning exception.
    ["What does F005 on my drive when it trips mean?", "PowerFlex 525"],
    ["what does F005 on my drive tripping mean", "PowerFlex 525"],
    ["what does F005 while the conveyor is running mean", "GS10"],
    ["what does F005 after the drive overheats mean", "PowerFlex 525"],
    // Codex #4069 pass 20: only the words naming the code are code vocabulary.
    ["What does F005 on my drive with repeated faults mean?", "PowerFlex 525"],
    ["what does F005 on my drive with an active alarm mean", "PowerFlex 525"],
    ["what does F005 on the drive showing errors mean", "PowerFlex 525"],
    // Codex #4069 pass 21: the pure code-meaning exception is an allowlist —
    // any word beyond the code, its name, a location and "mean" declines.
    ["What does F005 on my drive with no output mean?", "PowerFlex 525"],
    ["What does F005 mean on my drive with no output?", "PowerFlex 525"],
    ["what does F005 mean on the conveyor that is running slow", "GS10"],
    ["what does F005 mean on my drive right now", "PowerFlex 525"],
    // …and a code question naming a machine other than the bound one declines too.
    ["What does fault code ZX-9987 mean on my S7-1500?", "ThermoSeal TS-440"],
    // Codex #4069 pass 22: a second code-shaped token is another machine's model.
    ["What does F005 mean on my GS10?", "PowerFlex 525"],
    ["what does F005 on the PLX32 mean", "PowerFlex 525"],
    // Codex #4069 pass 24 F1: a "why" about this machine is diagnostic, even
    // behind "explain" and even when bound only by "it".
    ["Explain why it keeps rebooting", "PowerFlex 525"],
    ["why does it keep restarting", "TP700 Comfort"],
    ["explain why my panel reboots", "TP700 Comfort"],
    ["why is it so slow today", "GS10"],
    // Owner decision 2026-09-27 ("lean to declining"): in a machine-bound
    // notebook with nothing citable, anything outside the narrow teaching list
    // declines — including generic-class and procedure questions that earlier
    // passes routed to the general lane.
    ["What does this machine do?", "PowerFlex 525"],
    ["How do I wire a VFD?", "PowerFlex 525"],
    ["how do I configure a Modbus TCP client", "FX5U"],
    ["What should I check when a VFD trips on overload?", "PowerFlex 525"],
    ["Why does a VFD trip on overload?", "PowerFlex 525"],
    ["why do VFDs trip on overvoltage during decel", "GS10"],
    ["What should I check when a contactor trips?", "PowerFlex 525"],
    ["Why does a VFD trip when it overheats?", "PowerFlex 525"],
  ])("about this equipment: %s", (q, model) => expect(asksAboutThisEquipment(q, model)).toBe(true));

  it.each([
    // Teaching questions — must never get "upload the manual".
    ["how does a VFD work", "PowerFlex 525"],
    ["how does this drive work", "PowerFlex 525"],
    ["what is DH-485", "SLC 5/03"],
    ["what does PNP mean", "GS10"],
    ["what's the difference between RS-485 and RS-232", "PLX32"],
    ["explain how Modbus TCP works", "PLX32"],
    ["why do VFDs trip on overcurrent in general", "GS10"],
    ["what is a watchdog timer", "SLC 5/03"],
    ["what is an actuator used for", "AC 01.2"],
    ["What does F005 mean?", "PowerFlex 525"],
    ["What does F005 mean on my PowerFlex 525?", "PowerFlex 525"],
    ["What does fault E-12 mean on my TP700?", "TP700 Comfort"],
    ["What does F005 on my PowerFlex 525 mean?", "PowerFlex 525"],
    ["what does error code F005 mean", "PowerFlex 525"],
    ["what does alarm A012 mean", "GS10"],
    ["what does fault F005 on my PowerFlex 525 mean", "PowerFlex 525"],
    ["What does the F005 fault mean?", "PowerFlex 525"],
    ["what does the F005 error code mean on my drive", "PowerFlex 525"],
    // A pure code-meaning question stays with the E10 answer-floor rule (#4004).
    ["What does fault code ZX-9987 mean on my S7-1500?", "S7-1500"],
    ["What does fault code ZX-9987 mean on my TS-440?", "ThermoSeal TS-440"],
    ["what is the difference between a contactor and a relay", "GS10"],
    ["What is a VFD?", "PowerFlex 525"],
    ["what does IGBT stand for", "PowerFlex 525"],
    ["Explain how an HMI works", "TP700 Comfort"],
    ["Explain how a VFD works", "PowerFlex 525"],
    ["in general, why do drives trip on overcurrent", "PowerFlex 525"],
    ["generally, why do drives fault on overvoltage", "PowerFlex 525"],
    ["explain how PNP sensors are wired in general", "GS10"],
  ])("teaching, keeps answering: %s", (q, model) => expect(asksAboutThisEquipment(q, model)).toBe(false));

  it.each(["thanks", "ok, got it", "Thank you!"])("an acknowledgement never declines: %s", (q) => {
    expect(asksAboutThisEquipment(q, "GS10")).toBe(false);
  });

  it("an empty question is not about anything", () => {
    expect(asksAboutThisEquipment("   ", "GS10")).toBe(false);
  });
});
