# Emulator recovery checkpoint — 2026-09-25

## Start here — plain-language summary

This is the newer test on a simulated Android phone. We improved sideways-photo handling and kept photo-accuracy rules active when manuals were used. Some label readings and component associations are still wrong.

[Read the complete plain-language report on GitHub](https://github.com/Mikecranesync/MIRA/pull/3999#issuecomment-5841521419). It separates what works, what still fails, and what has actually been published.

<details>
<summary>Technical test record for developers</summary>

## Identity and scope

Recovered worktree: `/Users/charlienode/.codex/worktrees/fireplace-repair-loop/MIRA`, branch `codex/fireplace-repair-loop`, HEAD `c50f7ba9ca9c83523eee4b947db6d0f98a95fc1c` plus preserved uncommitted work. Draft PR #3999 remains at that HEAD; new changes have not been committed or pushed. Main was fetched and HEAD had no missing main commits at the time of the check.

Emulator `emulator-5554`, staging APK 1.2.1-fireplace-local/build 13, SHA256 `446d56c55a645ff1a4317deef8835ce6b32e8e460f6a236d0c9077740109555a`. Local HTTPS Hub at 127.0.0.1:4443; `/api/version/` identifies `fireplace-emulator-recovery` / `c50f7ba9ca9c83523eee4b947db6d0f98a95fc1c-dirty`. Doppler staging configuration, synthetic QA account, opt-in OpenAI LOOK and image preprocessing. Emulator adbd was restarted as root to permit reverse tcp:443 -> tcp:4443. No device-global CA, production deployment, shared-staging configuration change or equipment action.

The physical Pixel was absent. These are local emulator checkpoints, not physical-device or release acceptance. Source changes occurred between fresh projects D/E/F/G, never treated as one frozen passing run. Final code file SHA256 manifest is in the ignored private evidence directory.

## Demonstrated failures and bounded repairs

1. **Orientation port did not match the earlier Python success.** The actual Node pipeline gave the sideways drawing OSD rotation 270/confidence 0.81, below the unchanged 1.0 gate. It stayed sideways; run D misread AB SAFETY MODULE and 440R. The returned original from the app was 4000x3000. Uploaded bytes differ from the source JPEG, but both produce the same 0.81 result, so native re-encoding was not the demonstrated cause.
   - One-off real-image assertion failed before repair: expected rotation 270, got 0.
   - Changed only the 1000px OSD probe resize kernel from default lanczos3 to linear; full working-view rendering is unchanged. Uploaded image now scores 1.76 and rotates 270. Four rotated JPEG controls and four upright-photo controls passed. No confidence threshold was weakened. Original bytes remain parked unchanged by server preprocessing.
2. **Label/object association was lost.** Run E raw LOOK produced a flat list of component labels; the answer assigned the current relay model to the gray power supply and assigned a lower-module brand to the relay. Existing LOOK prompt now requires labels to remain attached to their visible component or location, leaving uncertain associations unknown. Run F raw LOOK correctly associated those labels, but the answer independently invented a PowerFlex cabinet identity and inferred live voltage from an indicator.
3. **Document-backed photo answers dropped visual rules.** `docGrounded` selected BASE_SYSTEM_PROMPT, which lacked the existing visual uncertainty and indicator rules in GENERAL_SYSTEM_PROMPT. New provider-message regression failed before repair (1 failed / 13 passed). Extracted those existing rules into a shared constant and append them to document-backed answers only when LOOK context exists; general answers retain them. Added explicit separation between retrieved-manual identity and photographed identity. Document-only negative control retains its prior prompt. Regression and control now pass.

## Fresh checks

- Full Hub suite: **298 files / 3921 tests passed**, after all source changes.
- TypeScript: **33 diagnostics**, same normalized file/error multiset as retained prior checkpoint `/tmp/fireplace-round2-final-tsc.log`; no new diagnostics. This is not a clean typecheck.
- `git diff --check`: passed.
- Native photo picker, attachment chip, exact textarea value and immediate preparation status were observed. Neutral prompts only; held-out diagnosis was never supplied.
- Run E cold restart: initial view was empty, but opening the saved sidebar conversation restored both photo cards and the follow-up. Persistence/reachability passed; automatic last-thread restoration was not claimed.
- Original-photo viewer fetched and displayed 4000x3000 original. Raw transcripts, images, screenshots and model readings remain local under ignored `private-backend-diagnostic/emulator-recovery/`.

## Final replay and unresolved gate

Run G starts with the hardware photo, then the schematic (opposite order to E), then asks what both establish and what remains uncertain. Hardware answer no longer claims a PowerFlex cabinet or measured supply voltage. Schematic retains AB SAFETY MODULE/440R/CURRENT SENSOR but still emits unreliable small-print text (`120VAC ISOLTRAL`). Follow-up retains both photos but incorrectly groups ACUAMP/OONO components as Allen-Bradley. **Answer quality remains FAIL.** Prompt repair is not deterministic factual validation, and one improved turn is not a pass.

The complete five-photo conversation, fresh-order independent controls, physical Pixel replay, web continuity and release acceptance remain outstanding. No issue is cleared; #3984 stays open. Best next step: retain these raw LOOK-vs-answer mismatches as regression cases and repair the existing answer validation/attribution boundary before another clean acceptance replay. Do not add more case-specific prompt hints or encode the held-out diagnosis.

</details>
