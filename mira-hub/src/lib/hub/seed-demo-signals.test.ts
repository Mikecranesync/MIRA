import { describe, expect, it } from "vitest";
import {
  DEMO_SIGNAL_ROWS,
  REQUIRED_DEMO_TAGS,
  normalizeSourceTagPath,
  validateDemoSignalRow,
  validateSyntheticTenantId,
} from "../../../scripts/seed-demo-signals";

describe("seed-demo-signals contract", () => {
  it("covers every canonical one-board tag exactly once", () => {
    const tags = DEMO_SIGNAL_ROWS.map((row) => row.plcTag).sort();

    expect(tags).toEqual([...REQUIRED_DEMO_TAGS].sort());
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("keeps every row ltree-safe and non-null for live_signal_cache", () => {
    for (const row of DEMO_SIGNAL_ROWS) {
      expect(row.unsPath).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      expect(row.value).not.toBeNull();
      expect(row.value).not.toBeUndefined();
    }
  });

  it("normalizes source tag paths the same way approved_tags expects", () => {
    expect(normalizeSourceTagPath("Stardust/Launch 1/Block Occupied")).toBe(
      "stardust_launch_1_block_occupied",
    );
    expect(normalizeSourceTagPath("conv_simple.vfd_current_amps")).toBe(
      "conv_simple_vfd_current_amps",
    );
    expect(() => normalizeSourceTagPath("")).toThrow("sourceTagPath must be a non-empty string");
  });

  it("validates seeded rows before touching the database", () => {
    expect(validateDemoSignalRow(DEMO_SIGNAL_ROWS[0])).toEqual(DEMO_SIGNAL_ROWS[0]);
    expect(() => validateDemoSignalRow(null)).toThrow("demo signal row must be an object");
    expect(() =>
      validateDemoSignalRow({
        plcTag: "",
        value: true,
        unsPath: "enterprise.demo.conveyor.motor_run",
      }),
    ).toThrow("plcTag must be a non-empty string");
    expect(() =>
      validateDemoSignalRow({
        plcTag: "conv_simple.motor_run",
        value: Number.NaN,
        unsPath: "enterprise.demo.conveyor.motor_run",
      }),
    ).toThrow("numeric value must be finite");
    expect(() =>
      validateDemoSignalRow({
        plcTag: "conv_simple.motor_run",
        value: true,
        unsPath: "enterprise.demo.conveyor.motor-run",
      }),
    ).toThrow("unsPath must be ltree-safe");
  });

  it("validates the synthetic tenant id override as a UUID", () => {
    expect(() => validateSyntheticTenantId("00000000-0000-0000-0000-000000000099")).not.toThrow();
    expect(() => validateSyntheticTenantId("demo")).toThrow("SYNTH_TENANT_ID must be a UUID");
  });
});
