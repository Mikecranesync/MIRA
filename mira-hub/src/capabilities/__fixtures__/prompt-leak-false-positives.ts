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

/**
 * Codex round 1 F2 — `FIELD_OBSERVATION_DIRECTIVE` (route.ts) rides EVERY
 * turn's prompt (both modes), and it is domain GUIDANCE phrased close to the
 * ideal answer itself, not a secret meta-instruction like HONESTY/SAFETY — a
 * technician answer correctly applying it legitimately echoes its wording.
 * Codex's exact reproduction: a correct answer to "does a green indicator
 * prove the mechanical lock is engaged?" shared a 12-word run with the
 * directive's first bullet and was wrongly flagged. Fixture 1 below is that
 * exact example; 2-6 mirror the directive's other bullets (delay/timeout,
 * hypothesis-not-confirmed-cause, HMI-vs-LED question, interlock/release
 * caution, stale-notes caution) the same way the adversarial fixtures above
 * mirror quoted examples. Tested against a prompt that INCLUDES
 * `FIELD_OBSERVATION_DIRECTIVE` with it passed in `detectPromptLeak`'s
 * `exclude` — the same per-turn/restatable-content mechanism as MACHINE
 * CONTEXT, not a new one.
 */
export const PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES: readonly string[] = [
  // Codex's exact reproduction.
  "A color/status change does not prove a physical failure, loss of a mechanical lock, or permission to operate. Check the documented indication mapping.",
  "That delay alone doesn't confirm a configured timeout — I can't invent a timer value or device model without documentation. What's the exact alarm text and device label?",
  "I can't confirm the root cause from this alone. The most likely causes are a loose wiring connection or a failed photo-eye, but both are hypotheses, not confirmed yet.",
  "Is this an HMI indication or a physical LED on the device itself? That determines which failure mode we're chasing.",
  "Don't force the output or bypass the interlock to test it — treat the earlier green indication as unverified, not as permission to proceed. Follow the site's lockout procedure before touching anything.",
  "An old troubleshooting note from last month isn't proof of today's cause — let's confirm with the current alarm and timestamp before assuming it's the same fault.",
];

/**
 * Codex #4891 F5 — `ISOLATION_STEP_RULE` (`src/capabilities/answer-shape.ts`)
 * rides EVERY turn's prompt in all three chat routes (asset, quickstart,
 * notebook) via `withStepSafety`, and — like `FIELD_OBSERVATION_DIRECTIVE` —
 * it is shared safety GUIDANCE the model is INSTRUCTED to apply, not a
 * secret meta-instruction: a correct LOTO/isolation answer legitimately
 * shares its wording. Codex's exact reproduction: a technician asks whether
 * power should be restored to verify absence of voltage; the correct answer
 * ("verify de-energized, still locked out, with a meter — never by
 * re-energizing") shares a 12-word run with the rule's own unquoted prose
 * (distinct from the ALREADY-covered single-quoted instructed EXAMPLE inside
 * the same rule — see the adversarial fixture above, "With the panel
 * isolated, locked out and the bus confirmed dead..."). Fixture 1 is Codex's
 * exact example; 2-6 mirror the rule's other clauses (meter-proven-on-a-
 * known-source, never-both-isolated-and-energized, a later de-energized-vs-
 * energized step split, no-voltage-number-in-the-verification, general LOTO
 * before opening an enclosure) the same way the FIELD_OBSERVATION fixtures
 * mirror that directive's bullets. Tested against a prompt that INCLUDES
 * `ISOLATION_STEP_RULE` with it passed in `detectPromptLeak`'s `exclude` —
 * the same mechanism as FIELD_OBSERVATION_DIRECTIVE, not a new one.
 */
export const PROMPT_LEAK_ISOLATION_FIXTURES: readonly string[] = [
  // Codex's exact reproduction (F5 finding body, verbatim).
  "Absence of voltage is verified with the equipment still locked out, using a meter proven on a known source — never by re-energizing.",
  "Before touching the terminals, lock out the disconnect and prove your meter on a known live source first, then confirm zero volts across L1-L2 with the drive still isolated.",
  "Don't restore power to take that reading — keep the lockout in place for the whole check. If you genuinely need it energized, that has to be its own later step with the lockout removed by a qualified person under the energized-work procedure.",
  "This step opens the enclosure, so state the isolation up front: with the main breaker locked out, inspect the terminals for scorching before going any further.",
  "A step is either isolated or it's energized — never write both into one step. Finish the de-energized inspection first; the live amp-draw reading is a separate step after power is properly restored.",
  "Keep the voltage check itself free of a specific number here — just confirm zero energy with a meter while locked out; the manual's parameter table is where the actual rated voltage lives.",
];

/**
 * Codex #4891 F8 — a systematic audit (not just the one string Codex found)
 * of every conditional directive/note any of the three routes can append
 * whose content a correct answer may legitimately restate. Five new
 * restatable spans, each confirmed a real false positive by a throwaway
 * repro BEFORE being added to its route's `exclude`, then fixed: Codex's
 * exact example + 3 realistic answers each (F8's quota — narrower than the
 * 5-realistic quota used for ISOLATION_STEP_RULE two rounds ago).
 */

/** `PHOTO_PROVENANCE_NOTE` (`src/capabilities/photo-provenance.ts`,
 *  appended by `withPhotoProvenance` in the notebook route only when a photo
 *  observation is in this turn's context). */
export const PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES: readonly string[] = [
  // Codex's exact reproduction.
  "I cannot confirm that these two part numbers are compatible without a cited source that establishes the match.",
  "The label appears to read \"6AV2124-0GC01-0AX0\" — that's an unconfirmed transcription, so treat it as what's printed, not a confirmed part number yet.",
  "I can't infer the device type from the shape or wiring in the photo; it has to be explicitly printed on the label or confirmed by a cited source.",
  "I won't claim those two part numbers are interchangeable without a manual or cited source that actually establishes the match — that's a guess, not a confirmed fact.",
];

/** `RESTART_DIRECTIVE` (`src/capabilities/restart-advisory.ts`, appended in
 *  the notebook route only on a fault-reset/restart-type question, mutually
 *  exclusive with the hazard-flag/electrical-hazard branches). */
export const PROMPT_LEAK_RESTART_FIXTURES: readonly string[] = [
  // Codex's exact reproduction.
  "Before resetting, identify and correct the cause before resetting; confirm people are clear before anything can move; lockout/tagout before any hands-in work.",
  "Don't just power-cycle it — find what actually tripped it first, or it'll just fault again.",
  "Before you clear that alarm, make sure everyone is clear of the conveyor; a reset can restart motion without warning.",
  "A firmware update or a project reload isn't a fault reset — if the alarm's still active after that, the underlying cause is still there.",
];

/** `GENERAL_NFPA_CAUTION` (notebook, `GENERAL_SYSTEM_PROMPT`'s own SAFETY
 *  line — general mode, no manual loaded). */
export const PROMPT_LEAK_GENERAL_NFPA_FIXTURES: readonly string[] = [
  // Codex's exact reproduction.
  "That is qualified-person work under NFPA 70E (arc-flash boundary/PPE, live-work permit). De-energize and lock out before inspecting it.",
  "I can't walk you through an energized measurement on 480 V gear — that needs a qualified electrician with arc-flash PPE and a live-work permit.",
  "Lock it out and de-energize before touching that panel; if the reading genuinely has to be taken live, that's a job for a qualified person under NFPA 70E.",
  "Escalate this one — 480-volt class work energized is qualified-electrician territory, not something to do from a chat answer.",
];

/** `BASE_NFPA_CAUTION` (notebook, `BASE_SYSTEM_PROMPT`'s own ENERGY STATE
 *  paragraph — grounded mode, manual loaded). */
export const PROMPT_LEAK_BASE_NFPA_FIXTURES: readonly string[] = [
  // Codex's exact reproduction (BASE_SYSTEM_PROMPT's own phrasing, not
  // GENERAL's — "arc-flash boundary and PPE determination").
  "That is qualified-person work under NFPA 70E (arc-flash boundary and PPE determination, live-work permit). Redirect to the de-energize and lockout/tagout path.",
  "This drive runs at 480 V, so probing it live is qualified-electrician work under NFPA 70E — de-energize and lock it out first [2].",
  "Per the manual, confirm zero energy before opening that enclosure; anything beyond that at 480 V needs a qualified person with the right PPE [1].",
  "I won't hand you a live-measurement procedure on this cabinet — that's a lockout/tagout job, and if it genuinely has to be done energized, a qualified electrician needs to do it.",
];

/** `GENERAL_COMPATIBILITY_CAUTION` (notebook, `GENERAL_SYSTEM_PROMPT`'s own
 *  HONESTY section — general mode, no manual loaded). Codex #4891 F9. */
export const PROMPT_LEAK_GENERAL_COMPATIBILITY_FIXTURES: readonly string[] = [
  // Codex's exact reproduction (F9).
  "I won't state compatibility or interchangeability as fact without a source that explicitly supports it — it's unverified, so I'd ask to search the exact label text or check the manufacturer's documentation.",
  "That substitution isn't confirmed — without a source that explicitly supports it, I can't call them interchangeable. Check the label or the manufacturer's documentation first.",
  "I won't say those two drives are compatible as fact — that needs a source. Search the label text or check with the manufacturer before swapping it in.",
  "Treat that as unverified compatibility until a source backs it up; the safest path is to check the manufacturer's documentation or the printed label.",
];

/** `GENERAL_SITE_RECORDS_CAUTION` (notebook, `GENERAL_SYSTEM_PROMPT`'s own
 *  HONESTY section — general mode, no manual loaded). Codex #4891 F9. */
export const PROMPT_LEAK_GENERAL_SITE_RECORDS_FIXTURES: readonly string[] = [
  // Codex's exact reproduction (F9).
  "That's a plant-specific value — relief valve setpoint, motor baseline current, pump suction lift limit, compressor pressure — so I'll abstain plainly. Your site configuration is not in my training; nameplate data or maintenance records are required.",
  "That compressor's pressure setting is specific to your plant's configuration, which I don't have — pull the nameplate or check your maintenance records.",
  "I don't have your site's pump suction lift limit; that's a plant-specific value I'd need nameplate data or maintenance history to answer accurately.",
  "Your plant's configuration isn't something I was trained on, so I can't state a specific motor baseline current — that needs to come from nameplate data or your own records.",
];

/** `BASE_SITE_RECORDS_CAUTION` (notebook, `BASE_SYSTEM_PROMPT`'s own
 *  PLANT-SPECIFIC VALUES section — grounded mode, manual loaded). Codex
 *  #4891 F9. */
export const PROMPT_LEAK_BASE_SITE_RECORDS_FIXTURES: readonly string[] = [
  // Codex's exact reproduction (F9).
  "That's one of those values the excerpts don't cover — examples include relief valve setpoints, motor inrush baseline, pump suction lift limits, compressor pressure settings, and it needs your site's own nameplate data or maintenance history.",
  "The manual doesn't give that pump's suction lift limit; it's one of those facility-specific values — relief valve setpoints, motor inrush baseline, compressor pressure settings — that only your site's records would have [1].",
  "I can't give you the compressor pressure setting from this manual — that's facility configuration only your site has on record, same as a relief valve setpoint or motor inrush baseline.",
  "This excerpt covers the general procedure but not your site's specific baseline history; values like that come from your own nameplate data or maintenance logs, not the manual [2].",
];

/** `ASSET_SAFETY_STOP_CAUTION` (asset chat, the fixed Instructions block's
 *  own lockout/arc-flash/confined-space safety-stop bullet — unconditional). */
export const PROMPT_LEAK_ASSET_SAFETY_STOP_FIXTURES: readonly string[] = [
  // Codex-style exact reproduction of the bullet's own wording.
  "Since this involves arc flash exposure, I will stop and instruct the tech to follow site safety procedures before proceeding with any work here.",
  "This is a confined-space entry, so stop here — check with your site's confined-space procedure before anyone goes in.",
  "That's a lockout/tagout situation. Stop and verify your site's LOTO procedure is in place before touching the breaker.",
  "This question is about electrical safety around a live panel — stop and follow your site's electrical safety procedure before proceeding any further.",
];
