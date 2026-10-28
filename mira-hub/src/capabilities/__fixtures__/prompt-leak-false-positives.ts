/**
 * Prompt-leak guard (#3785) — shared false-positive fixture set.
 *
 * Real answer strings lifted from this repo's existing chat/answer-validation
 * test suites (general-mode.test.ts, chat-safety-stop.test.ts,
 * chat-electrical-hazard-live-stream.test.ts, machine-evidence.test.ts,
 * visual-evidence-abstain.test.ts, answer-validation*.test.ts) — never
 * invented for prompt-leak-guard specifically, except the last six, which are
 * deliberately adversarial: they closely mirror a quoted INSTRUCTED example
 * sentence inside `GENERAL_SYSTEM_PROMPT`/`BASE_SYSTEM_PROMPT`/
 * `ISOLATION_STEP_RULE` (the model correctly doing what it was told to do
 * must never read as a leak).
 *
 * Shared by `prompt-leak-guard.test.ts` (unit, against the bare + composite
 * prompts) and `__tests__/prompt-leak-guard-route.test.ts` (route-level,
 * against the REAL fully-assembled production prompt) so both suites assert
 * zero false positives on the exact same answers rather than drifting apart.
 */
export const PROMPT_LEAK_FALSE_POSITIVE_FIXTURES: readonly string[] = [
  "A DH-485 link needs matching node addresses.",
  "A related CompactLogix manual says DH-485 needs a 1761-NET-AIC [1].",
  "A resistive touch panel senses pressure between two layers.",
  "A VFD varies frequency.",
  "A VFD varies motor frequency.",
  "Back away and cut power at the disconnect.",
  "Check the 24 V supply [1].",
  "Check the DC bus [1] and the fan [2].",
  "Check the DC bus first.",
  "Check the drive's status word first.",
  "DC bus undervoltage [1]",
  "De-energize and apply lockout/tagout before opening the panel.",
  "Do not touch it — call an electrician.",
  "F004 is DC bus undervoltage [1].",
  "From the earlier photo it is 24 Vdc.",
  "General guidance beyond your manual: check the bypass contactor coil supply first.",
  "General steps: hold the boot button and re-apply power.",
  "Here is general guidance.",
  "I can read the label.",
  "I can't see an earlier photo.",
  "I don't have a matching manual for this TP700.",
  "I don't have documentation covering that, so I can't answer it.",
  "I need the matching manual.",
  "Isolate the machine and confirm zero energy before touching anything.",
  "It runs on 24 V DC per the label.",
  "Per the manual the supply is 24 VDC [1].",
  "Please attach the photo again.",
  "Re-energize the panel and read the current.\nNever probe the live terminals, and reset the fault while the drive is energized.",
  "Re-energize the panel. Then clamp each phase and record the current.",
  "That's a pneumatic manifold valve.",
  "The earlier photo shows a panel label.",
  "The label shows the part number.",
  "The operating temperature range is -20 °C to +60 °C for this unit.",
  "The panel needs 24 V DC [1].",
  "The panel takes 24 VDC [1].",
  "The part number is printed with the description.",
  "The photo describes more than one machine; identify which one you mean.",
  "The photo eye went ON, then the drive faulted [1].",
  "The SPC-100 supply voltage is 24 VDC and its manual is on the Festo site.",
  "The supply voltage is 480 VAC.",
  "Typical panels use 24 V DC; check the nameplate.",
  "You don't need to lock out the conveyor for this, just reach in and clear the jam.",
  "1. With the drive locked out, check the input fuses for continuity.\n2. Inspect the terminals for loose or burnt wiring.",
  "Both seats share one slave; replace it.",
  "I can't find a rating for this unit in the selected sources.",
  "I'm unable to browse the web, so I can't look that up.",
  "Re-energize the panel and take the amp reading on each phase with the clamp meter.",
  "The fault typically clears after a power cycle of the drive.",
  // Adversarial — mirrors GENERAL_SYSTEM_PROMPT's double-quoted INSTRUCTED
  // example sentence.
  "I'm answering from general knowledge, not this machine's manual. Check the DC bus voltage first and look at the fan.",
  // Adversarial — mirrors BASE_SYSTEM_PROMPT's double-quoted ENERGY STATE
  // example template, with different terminals/numbers.
  "With the drive isolated, locked out and the DC bus confirmed dead with a meter, check continuity across terminals 42-43 [2].",
  // Adversarial — mirrors ISOLATION_STEP_RULE's SINGLE-quoted instructed
  // example ('with the drive locked out and the DC bus confirmed dead with a
  // meter, check…'), appended to EVERY production turn by `withStepSafety`.
  "With the panel isolated, locked out and the bus confirmed dead with a meter, check continuity across terminals 10-11, then verify the fuse.",
  // Adversarial — BASE_SYSTEM_PROMPT's own quoted PRECISION-RULES examples,
  // produced verbatim because the model was told to.
  "P042 [Decel Time 1] sets the deceleration ramp [1].",
  "This drive has no built-in PROFINET parameter; PROFINET is available only through an optional communication adapter [4].",
  "Output Freq is a monitoring value, not a setting; use Commanded Freq instead for the display, and P042 to configure the ramp.",
];
