/**
 * Anti-drift guard for the durapulse_gs10 pack loader — TS twin of
 * `mira-bots/tests/test_drive_packs.py`. Asserts the loader's typed tables
 * equal the pack.json values exactly, so a future edit to `pack.json` that
 * silently changes a code/scaling/unit fails loudly here instead of only
 * being caught downstream in `gs10-display.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { GS10_PACK } from "./loader";

describe("GS10_PACK", () => {
  it("loads the durapulse_gs10 pack", () => {
    expect(GS10_PACK.pack_id).toBe("durapulse_gs10");
  });

  it("status_bits match the pack.json values exactly", () => {
    expect(GS10_PACK.live_decode.status_bits).toEqual({
      0: "STOPPED",
      1: "DECEL",
      2: "STANDBY",
      3: "RUNNING",
    });
  });

  it("cmd_word matches the pack.json values exactly", () => {
    // REV+RUN is 34 (0x22 = 0x20 REV | 0x02 RUN), bench-verified 2026-06-12 —
    // see plc/conv_simple_anomaly/rules_core.py `run_cmd_values` + commit
    // a882605a. This test previously asserted the stale value 20 (0x14, no
    // RUN bit), which had silently ridden in from a pre-fix source.
    expect(GS10_PACK.live_decode.cmd_word).toEqual({
      1: "STOP",
      18: "FWD+RUN",
      34: "REV+RUN",
    });
  });

  it("fault_codes match the pack.json values exactly", () => {
    expect(GS10_PACK.live_decode.fault_codes).toEqual({
      0: "no active fault",
      4: "GFF ground fault",
      12: "Lvd undervoltage",
      21: "oL overload",
      49: "EF external fault",
      54: "CE1 comm illegal cmd",
      55: "CE2 comm illegal addr",
      56: "CE3 comm illegal data",
      57: "CE4 comm fail",
      58: "CE10 modbus timeout",
    });
  });

  it("registers match the expected scaling and units", () => {
    const registers = GS10_PACK.live_decode.registers;
    expect(Object.keys(registers).sort()).toEqual(
      ["vfd_current", "vfd_dc_bus", "vfd_freq_sp", "vfd_frequency"].sort(),
    );

    expect(registers.vfd_frequency.scaling).toBe(0.01);
    expect(registers.vfd_frequency.unit).toBe("Hz");

    expect(registers.vfd_freq_sp.scaling).toBe(0.01);
    expect(registers.vfd_freq_sp.unit).toBe("Hz");

    expect(registers.vfd_current.scaling).toBe(0.01);
    expect(registers.vfd_current.unit).toBe("A");

    expect(registers.vfd_dc_bus.scaling).toBe(0.1);
    expect(registers.vfd_dc_bus.unit).toBe("V");
  });

  it("envelope.dc_bus matches the expected bench-verified band", () => {
    expect(GS10_PACK.envelope.dc_bus).toEqual({ nominal: 320.0, min: 300.0, max: 340.0, unit: "V" });
  });
});
