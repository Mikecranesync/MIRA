/**
 * gs10-display tests — display formatting + PARITY PIN against the divisor
 * source of truth, ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py
 * (LEAF_MAP). If the Python map changes a divisor, this test fails until the
 * hub map is mirrored.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatTagValue } from "./gs10-display";

describe("formatTagValue — scaling", () => {
  it("scales the raw V2.1 registers into engineering units", () => {
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_dc_bus", "3286")).toEqual({
      display: "328.6 V",
      numeric: 328.6,
      unit: "V",
    });
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_freq_sp", "3000").display).toBe("30 Hz");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_frequency", 0).display).toBe("0 Hz");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_current", "125").display).toBe("1.25 A");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_power", "1500").display).toBe("1.5 kW");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_torque", "55").display).toBe("5.5 %");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_motor_rpm", "1750").display).toBe("1750 rpm");
  });

  it("decodes status/cmd/fault words instead of scaling", () => {
    // 9472 = 0x2500: op_status 0 (Stopped), direction 0 (FWD), bit10 run-from-comms
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_status_word", 9472).display).toBe(
      "Stopped · FWD · comms",
    );
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_cmd_word", 1).display).toBe("STOP");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_cmd_word", 18).display).toBe("RUN FWD");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_fault_code", 0).display).toBe("OK");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_warn_code", 5).display).toBe("code 5");
  });

  it("passes booleans/strings/null through", () => {
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/pe_latched", true).display).toBe("true");
    expect(formatTagValue("[default]MIRA_IOCheck/Inputs/DI_02", "false").display).toBe("false");
    expect(formatTagValue("[default]MIRA_IOCheck/VFD/vfd_dc_bus", null).display).toBe("—");
  });
});

describe("parity with tag_topic_map.py LEAF_MAP", () => {
  // Divisors the hub map must mirror for the raw MIRA_IOCheck leaves.
  const EXPECTED: Record<string, number> = {
    vfd_current: 100.0,
    vfd_dc_bus: 10.0,
    vfd_frequency: 100.0,
    vfd_freq_cmd: 100.0,
  };

  it("hub divisors match the Python source of truth", () => {
    const py = readFileSync(
      join(__dirname, "../../..", "ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py"),
      "utf-8",
    );
    for (const [leaf, divisor] of Object.entries(EXPECTED)) {
      // e.g.  "vfd_dc_bus": (_DCBUS, 10.0),
      const re = new RegExp(`"${leaf}":\\s*\\([^,]+,\\s*([0-9.]+)\\)`);
      const m = py.match(re);
      expect(m, `LEAF_MAP entry for ${leaf} not found in tag_topic_map.py`).not.toBeNull();
      expect(Number(m![1]), `divisor drift for ${leaf}`).toBe(divisor);
      // and the hub map applies exactly that divisor:
      const scaled = formatTagValue(`x/${leaf}`, 1000).numeric;
      expect(scaled, `hub divisor for ${leaf}`).toBe(1000 / divisor);
    }
  });
});
