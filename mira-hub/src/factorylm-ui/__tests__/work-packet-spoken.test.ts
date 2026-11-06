/**
 * work-packet-spoken.test.ts — what the phone reads aloud never states more than the screen does.
 * Fictional values only.
 */
import { describe, expect, it } from "vitest";
import type { Field } from "@/capabilities/work-packet/types";
import { spokenPacketText } from "../work-packet-spoken";

const f = (value: string | null, label: Field["label"], extra: Partial<Field> = {}): Field => ({ value, label, source: null, basis: "fictional", ...extra });
const base = {
  scope: [f("Loose torque stripe at C3-B1: replace hardware and re-torque", "proposed")],
  parts: [{ kit: null, item: 5, partNumber: f("700101", "verified"), description: f("Bolt M12 x 60 10.9", "verified"), qty: f("2", "verified") }],
  measurements: [{ name: f("C3-B1 tightening torque", "proposed"), value: f("95 Nm", "verified"), tool: f(null, "unknown") }],
  blockers: [] as Field[],
  steps: [{ section: "", topic: "other" as const, text: f("Tighten to the torque in the table", "proposed") }],
  safety: { cautions: [], siteIsolation: f(null, "unknown"), hazardFlags: [] },
};

describe("spokenPacketText", () => {
  it("reads hardware, torque and steps with units spoken", () => {
    const t = spokenPacketText(base);
    expect(t).toContain("Bolt M12 by 60 10.9");
    expect(t).toContain("95 newton metres");
    expect(t).toContain("Step 1: Tighten to the torque in the table, proposed, check it.");
    expect(t).toContain("Site isolation: set by your site");
  });
  it("an unknown or unreadable torque is spoken as unknown, never as a number", () => {
    const t = spokenPacketText({ ...base, measurements: [{ ...base.measurements[0], value: f(null, "unknown") }] });
    expect(t).toMatch(/tightening torque: unknown, do not use/);
    expect(t).not.toMatch(/95/);
  });
  it("a struck value is spoken as excluded", () => {
    const parts = [{ ...base.parts[0], partNumber: f("700101", "verified", { struck: true }) }];
    expect(spokenPacketText({ ...base, parts })).toMatch(/Article number excluded, struck by a technician, do not use/);
  });
  it("open questions are read before the hardware", () => {
    const t = spokenPacketText({ ...base, blockers: [f(null, "unknown", { basis: "The drawing marks this torque Ma*=6 Nm; the asterisk is not explained." })] });
    expect(t.indexOf("open question")).toBeLessThan(t.indexOf("Hardware."));
    expect(t).toContain("M A star equals 6 newton metres");
  });
  it("a proposed value says so", () => {
    const parts = [{ ...base.parts[0], qty: f("2", "proposed") }];
    expect(spokenPacketText({ ...base, parts })).toContain("Quantity 2, proposed, check it.");
  });
});
