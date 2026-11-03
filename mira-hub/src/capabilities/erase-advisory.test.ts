import { describe, expect, it } from "vitest";

import { validateAnswer } from "./answer-validation";
import { BACKUP_BANNER, backupBannerFor, withBackupBanner } from "./erase-advisory";
import { ISOLATION_BANNER } from "./isolation-advisory";

// #5129 — answers from staging (Oct 23 – Nov 2) that told the technician to
// erase settings or a program with no back-up line, plus the shapes that must
// stay silent.
describe("backupBannerFor (#5129)", () => {
  const POSITIVE = [
    // staging PF4: "Reset To Defalts" (the manual's own spelling)
    "Set P041 [Reset To Defalts] to option 1 to reset all parameters [1].",
    // staging GS1
    "Set P9.08 [Restore to Default] to 99 and cycle power.",
    // staging Micro820
    "Use an empty transfer card to delete the password-protected program; this erases the CPU internal load memory.",
    "1. Go to Settings.\n2. Select Factory Reset and confirm.",
    "Perform a factory reset from the boot menu.",
    "To clear it, delete the project data on the panel.",
    "The fix is to restore factory defaults.",
    "If the drive will not accept the setting, reset it to factory defaults.",
    "You can restore the defaults with P053.",
  ];
  for (const answer of POSITIVE) {
    it(`fires: ${answer.slice(0, 60)}`, () => {
      expect(backupBannerFor(answer)).toBe(BACKUP_BANNER);
    });
  }

  const NEGATIVE = [
    // the RESTART_DIRECTIVE's own sentence, echoed back by the model
    "A factory reset is not a fault reset — do not use it to clear F004.",
    "Do not reset the drive to factory defaults.",
    "Never delete the project data to clear an alarm.",
    // the coordinated verb sits inside the prohibition
    "Do not power-cycle or reset to defaults.",
    // descriptive, not an instruction
    "A factory reset deletes all user parameters.",
    "P041 [Reset To Defaults] returns every parameter to its factory value.",
    // the erase sits inside a condition, not in the instruction
    "If you already reset to defaults, re-enter the motor nameplate data.",
    // backup instructed first
    "Back up the parameters first, then set P041 to 1 to reset to defaults.",
    // a fault log is not settings
    "Clear the fault memory from the diagnostics menu.",
    "Save the project to your PC. Then delete the project data on the panel.",
    // a fault reset is not an erase
    "Press Stop/Reset on the keypad to clear the fault.",
    "Clear the alarm from the alarm list.",
    "Set P041 to 0.",
    "",
  ];
  for (const answer of NEGATIVE) {
    it(`silent: ${answer.slice(0, 60) || "(empty)"}`, () => {
      expect(backupBannerFor(answer)).toBeNull();
    });
  }
});

describe("withBackupBanner (#5129)", () => {
  const ERASE = "Set P041 to 1 to reset to defaults.";

  it("puts the notice above the answer", () => {
    expect(withBackupBanner(ERASE)).toBe(`${BACKUP_BANNER}\n\n${ERASE}`);
  });

  it("leaves an answer with no erase step unchanged", () => {
    expect(withBackupBanner("Press Stop/Reset to clear the fault.")).toBe("Press Stop/Reset to clear the fault.");
  });

  it("never adds the notice twice", () => {
    const once = withBackupBanner(ERASE);
    expect(withBackupBanner(once)).toBe(once);
  });
});

describe("back-up notice below the isolation notice (#5129)", () => {
  it("validateAnswer stacks its lockout notice above the back-up notice", () => {
    const answer = withBackupBanner(
      "Replace the input fuse [1]. Then set P041 to 1 to reset all parameters to defaults [1].",
    );
    const v = validateAnswer({
      answerText: answer,
      question: "The drive will not start, what do I do?",
      general: false,
      served: true,
      refused: false,
      evidenceSufficient: true,
      manualSearchRunning: null,
    });
    expect(v.ok).toBe(false);
    const replacement = v.ok ? "" : v.replacement;
    expect(replacement.startsWith(ISOLATION_BANNER)).toBe(true);
    expect(replacement.indexOf(BACKUP_BANNER)).toBeGreaterThan(replacement.indexOf(ISOLATION_BANNER));
  });
});
