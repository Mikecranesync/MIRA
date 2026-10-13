import { describe, it, expect } from "vitest";
import { ALARM_PACKS, BANNED_PATTERNS, SITE_PROCEDURE_LINE, packFor, validatePack, type AlarmPack } from "./loader";
import rtd from "./rtd.v1.json";

const clone = (): AlarmPack => JSON.parse(JSON.stringify(rtd)) as AlarmPack;

// Independent of BANNED_PATTERNS on purpose: deleting a pattern must turn its row red.
const MUST_REJECT: [string, string][] = [
  ["bypass", "Bypass the safety relay to test it."],
  ["jumper", "Jumper the output terminals."],
  ["bridge-out", "Bridge out the wire-break input."],
  ["force", "Force the output on from the engineering software."],
  ["override", "Override the channel."],
  ["substitute", "Substitute a resistor for the RTD."],
  ["simulate", "Simulate the sensor value."],
  ["reset", "Reset the module."],
  ["clear-alarm", "Clear the alarm and watch it."],
  ["acknowledge", "Acknowledge the F-I/O."],
  ["reintegrate", "Reintegrate the channel."],
  ["depassivate", "Depassivate the channel."],
  ["ack-rei", "Set ACK_REI in the safety program."],
  ["disable-diagnostic", "Deactivate wire break detection on that channel."],
  ["parameterize-off", "Parameterize it off in the hardware config."],
  ["change-config", "Change the F-parameters to stop it."],
  ["download", "Download the corrected program."],
  ["load-resistor", "Fit a load resistor across the output."],
  ["run-test", "Run an insulation test on the output wiring."],
  ["restore", "Reactivate the output once the alarm is gone."],
];

describe("alarm packs", () => {
  it("both shipped packs load", () => {
    expect(ALARM_PACKS.map((p) => p.pack_id)).toEqual(["rtd", "fail-safe-output"]);
  });
  it.each([
    "measurement_limit:temperature:high",
    "measurement_limit:temperature:low",
    "io_diagnostic:wire_break:input",
    "io_diagnostic:wire_break:output",
    "safety_passivation",
  ])("has an entry for %s", (key) => {
    const hit = packFor(key);
    expect(hit).not.toBeNull();
    expect(hit!.entry.hypotheses).toHaveLength(2);
    expect(hit!.entry.checks).toHaveLength(3);
  });
  it("returns null for an uncovered key", () => {
    expect(packFor("io_diagnostic:overrange:input")).toBeNull();
  });
  it("every pack carries the exact site-procedure line", () => {
    for (const p of ALARM_PACKS) expect(p.site_procedure_line).toBe(SITE_PROCEDURE_LINE);
  });

  it.each(MUST_REJECT)("rejects banned pattern %s", (id, phrase) => {
    const bad = clone();
    bad.entries[0].checks[2] = phrase;
    expect(() => validatePack(bad)).toThrow(`alarm_pack_banned:${id}:rtd`);
  });
  it("the ban list covers every row of the table above (no silent removals)", () => {
    expect(BANNED_PATTERNS.map((b) => b.id).sort()).toEqual(MUST_REJECT.map(([id]) => id).sort());
  });
  it("control: read-only wording that names the risk without instructing it passes", () => {
    const ok = clone();
    ok.entries[0].checks[2] = "Read the module diagnostics online in the engineering software, in view mode only — do not enter configuration or change any setting in the controller.";
    expect(() => validatePack(ok)).not.toThrow();
  });
  it("rejects structural defects", () => {
    const twoChecks = clone(); twoChecks.entries[0].checks = ["a", "b"] as never;
    expect(() => validatePack(twoChecks)).toThrow("alarm_pack_invalid:checks");
    const badLine = clone(); badLine.site_procedure_line = "Be careful.";
    expect(() => validatePack(badLine)).toThrow("alarm_pack_invalid:site_procedure_line");
    const dup = clone(); dup.entries.push(dup.entries[0]);
    expect(() => validatePack(dup)).toThrow("alarm_pack_invalid:duplicate_key");
  });
});

// rtd v2 (2026-10-13): generic lessons from a real stator-temperature night, approved by Mike
// pending safety review. v1 stays on disk so older cards' packVersions still resolve.
describe("rtd pack v2", () => {
  const shipped = ALARM_PACKS.find((p) => p.pack_id === "rtd")!;
  const high = packFor("measurement_limit:temperature:high")!.entry;
  it("ships version 2, and v1 is kept on disk", () => {
    expect(shipped.version).toBe(2);
    expect(rtd.version).toBe(1);
  });
  it("separates real heat from a bad loop, and says a believable reading is not an open wire", () => {
    expect(high.hypotheses).toEqual([
      "The measured point really is above its limit, for example after heavy use or because its cooling is not working.",
      "The sensor loop has extra resistance at a lead, terminal, or joint. An open loop reads at the top of the input's range, far above any real temperature, so a believable reading is not an open wire.",
    ]);
  });
  it("checks: does it follow load, compare the twin (and the shared input), confirm with a second reading", () => {
    expect(high.checks).toEqual([
      "Read the value and time of each occurrence from the alarm history, and note whether the readings rise after heavy use.",
      "Compare the sensor that does the same work, such as the other side of a left/right pair. If several sensors that share one input alarm together, suspect the shared input; one alone points at that point.",
      "Confirm with a second reading of the same point: its separate over-temperature switch status on the HMI, or an infrared thermometer from a safe position once access is permitted.",
    ]);
  });
  it("control: the low-temperature and wire-break entries are unchanged from v1", () => {
    for (const key of ["measurement_limit:temperature:low", "io_diagnostic:wire_break:input"]) {
      expect(shipped.entries.find((e) => e.key === key)).toEqual(rtd.entries.find((e) => e.key === key));
    }
  });
});
