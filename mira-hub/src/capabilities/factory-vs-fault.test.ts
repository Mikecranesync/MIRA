import { describe, expect, it } from "vitest";

import {
  BACKUP_BANNER,
  FACTORY_NOT_FAULT_BANNER,
  factoryNotFaultBannerFor,
  withBackupBanner,
  withFactoryNotFaultBanner,
} from "./erase-advisory";

// #5131 — a question about resetting a FAULT answered with FACTORY-reset steps.
// Answers below are staging notebook turns of 2026-10-23 (TP700 notebook).
describe("factoryNotFaultBannerFor (#5131)", () => {
  const FIRES: [string, string][] = [
    [
      "What is the fault reset procedure?",
      "Open the **“OP Properties”** dialog, go to **“Device”**, click **“Reboot”**, then select **“Prepare for Reset”** to reset the HMI device to factory settings [3][6].",
    ],
    [
      "The machine faulted and the HMI shows an error. How do I reset the fault and get it running again?",
      "Open **“OP Properties” > “Device”** and press **“Reboot”** to restart the HMI immediately, or **“Prepare for Reset”** to reset it to factory settings and delete the operating system and project data [6].",
    ],
    ["How do I clear the F004 alarm?", "Set P041 [Reset To Defalts] to option 1 to restore factory defaults [2]."],
  ];
  for (const [q, a] of FIRES) {
    it(`fires: ${q.slice(0, 50)}`, () => {
      expect(factoryNotFaultBannerFor(q, a)).toBe(FACTORY_NOT_FAULT_BANNER);
    });
  }

  const SILENT: [string, string, string][] = [
    [
      "fault reset answered with a fault reset",
      "How do I clear an alarm message on the TP700?",
      "To clear a current alarm indication, acknowledge the alarm; acknowledgment confirms it has been noted [2].",
    ],
    [
      "factory reset only described, not instructed",
      "Can I just reset the fault and restart the machine?",
      "Not enough information in the excerpts; these pages only cover HMI reboot/factory reset, and a factory reset deletes the operating system, project data, user administration, recipes, and license keys [3][4][5].",
    ],
    [
      "the technician asked for the factory reset",
      "The drive faulted. How do I reset it to factory settings?",
      "Open OP Properties > Device > Reboot, then select “Prepare for Reset” to reset the HMI device to factory settings [3].",
    ],
    [
      "factory reset prohibited",
      "How do I reset the fault?",
      "Do not power-cycle or reset to factory defaults. Press Stop/Reset on the keypad to clear the fault [1].",
    ],
    [
      "not a fault question",
      "How do I set the acceleration time?",
      "Set P039 [Accel Time 1]; to start over, reset to defaults with P041 [2].",
    ],
  ];
  for (const [label, q, a] of SILENT) {
    it(`silent: ${label}`, () => {
      expect(factoryNotFaultBannerFor(q, a)).toBeNull();
    });
  }
});

describe("withFactoryNotFaultBanner (#5131)", () => {
  const Q = "What is the fault reset procedure?";
  const A = "Open OP Properties > Device > Reboot, then select “Prepare for Reset” to reset the HMI device to factory settings [3].";

  it("stacks above the back-up notice", () => {
    expect(withFactoryNotFaultBanner(Q, withBackupBanner(A))).toBe(
      `${FACTORY_NOT_FAULT_BANNER}\n\n${BACKUP_BANNER}\n\n${A}`,
    );
  });

  it("is added once", () => {
    const once = withFactoryNotFaultBanner(Q, A);
    expect(withFactoryNotFaultBanner(Q, once)).toBe(once);
  });

  it("leaves an ordinary answer unchanged", () => {
    const a = "Press the acknowledgment key to acknowledge the displayed fault [2].";
    expect(withFactoryNotFaultBanner(Q, a)).toBe(a);
  });
});
