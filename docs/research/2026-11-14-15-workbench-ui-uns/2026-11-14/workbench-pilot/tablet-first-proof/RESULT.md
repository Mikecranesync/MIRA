# Physical tablet first proof — MLC

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../../README.md) and [private-evidence policy](../../../PRIVATE-EVIDENCE.md).


Recorded 2026-11-14, approximately 17:41–18:03 Eastern. **Bounded staging proof passed; full workbench pilot is not accepted.** This was an agent-operated physical Samsung SM-X510 in Chrome, using the signed-in user's ordinary interface. It was not independent human acceptance, a hardware operating test, or production verification.

Staging was **3.452.0**, commit **eab62164db37b18c824a47de897e89fa6fce1f01**, both before and after the run. See `version-before.json` and `version-after.json`. No application change, deployment, merge, paid review, PLC command or equipment operation was performed.

One project was created: **Workbench - MLC - tablet proof 2026-11-14**. [Private project link omitted from this public copy.].

The project reuses the existing workspace file **CA3KN22BD-maker.pdf**. This was not a new upload or photograph. The onboarding UI described the document as added by the user and not verified for this model. Its datasheet describes a TeSys K control relay; the local tag MLC does not establish its installed role, wiring or suitability as a main-line contactor.

## Verification receipt

| Case | Result | Observed evidence |
|---|---|---|
| Create a project and select the existing datasheet | PASS, with path change | A new General project was created via the four-step UI, with one selected source. Selecting Conveyor 1 first correctly offered its existing project instead of creating a second machine project. `general-creation.json`, `12-source-ready.png`. |
| Submit a question and get document facts | PASS, with keyboard intervention | Actual chat POST completed. Answer: CA3KN22BD, 24 V DC, 2 NO + 2 NC, citing page 1. `answer-second-tap.json`, `19-answer-result.png`. |
| Open and inspect the supporting page | PASS | Citation opened page 1 in the source viewer and an actual Chrome document tab. The rendered page supports all three facts. `20-citation-open.png`, `22-source-rendered.png`. |
| Add a component without inventing a checked identity | PASS | Added local tag MLC, type control relay. Left manufacturer, family, catalog, serial, revision and raw label text blank. Used **Save, not confirmed**. UI says identity not confirmed. `component-unconfirmed-save.json`, `33-component-unconfirmed.png`. |
| Refuse model-specific answers for an unconfirmed selected component | PASS | Selected MLC and sent a real question. Response: “MLC isn't confirmed yet, so I won't answer from the manuals for it. Check what its label says and tap Confirm, then ask again.” `unconfirmed-question.json`, `34-unconfirmed-question-result.png`. |
| Preserve the answer, source and component selection on reload | PASS, page reload only | Reload restored the two messages, citation and Asking about MLC. A separately opened tab also loaded the same saved state. `reload-persistence.json`, `35-reloaded-proof.png`, `36-second-tab.png`. |
| Reject stale selection from another screen | PASS | Second tablet tab changed MLC to Whole machine. Original tab still showed MLC and sent component ID with selectionVersion 1. Server refused with `selection_changed`; no answer was generated for that send. Streaming transport was HTTP 200 containing an `http_error` event with status 409. UI reloaded selection and retained the exact question. `stale-scope-other-tab.json`, `stale-scope-original-tab.json`, `stale-scope-refusal.json`. |
| Retry using the refreshed selection | PASS for transport/scope, with UI intervention | After scrolling to find Try again, its actual tap sent componentId null / selectionVersion 2 and received a cited datasheet answer. This proves the request used the new Whole machine selection. It does not prove installed MLC identity. `stale-scope-retry.json`, `39-retry-scroll.png`, `40-retry-result.png`. |
| Start a job in this new General project | BLOCKED by machine binding | Start a job requested machine binding. Choosing Conveyor 1 received HTTP 409, “Another notebook is already using that machine,” and a link to its existing notebook. No job was created. The duplicate guard worked; the fresh General-project path does not complete a machine job. `machine-binding-result.json`, `29-machine-binding-result.png`. |
| Read and use the job-sheet interface unaided | FAIL | Text, input contents and secondary controls were nearly white on white. DOM-assisted targeting was needed. `23-job-sheet.png`, `28-existing-machine-picker.png`. |
| Keep floating controls clear of overlays | FAIL | Whole machine / Prepare job / Job sheet controls remained above parts of the source drawer. Related to the already reported overlay class of problem in issue 5546; root cause was not investigated here. `20-citation-open.png`. |
| Make stale-selection recovery immediately visible | FAIL for visibility | Refusal and Try again existed below the viewport. Ordinary chat scrolling did not immediately expose them; an additional outer-page scroll at the right edge did. Controls then worked. `37-stale-scope-refusal.png`, `38-retry-visible.png`, `39-retry-scroll.png`. |

## Limits and interventions

- The first Send tap with the keyboard open dismissed the keyboard and did not submit. The subsequent tap with keyboard closed submitted successfully. This is an observed intervention, not a diagnosed application defect. There were **four actual chat POSTs**: initial datasheet answer, unconfirmed-component refusal, stale-selection refusal, and accepted retry. No billing receipt was obtained; no zero-cost claim is made.
- The retry question still said “selected component” after the selection changed to Whole machine. The response supplied the correct datasheet value for CA3KN22BD without clarifying that no component was selected. Review this ambiguity before claiming installed-component verification. The server scope guard itself passed.
- A failed harness selector followed by an unconditional Android Back temporarily navigated to the prior PLC project. No question or edit was submitted there. The test resumed at the observed test-project URL with explicit notebook checks. This was a harness error, not a product defect.
- Some screenshot filenames describe the intended step, not its result: `08-project-created.png` actually shows the existing-machine guard; `26-job-created.png` shows the unbound-machine block; `17-answer-result.png` shows the first unsent attempt. The case table and accompanying JSON determine the verdict.
- Confirmed physical identity, component-specific approved manual admission, two-component separation, identity correction across screens, photo attachment retention on refusal, notes/photos/jobs surviving restart, offline recovery, second-technician access, drive baseline, graph retirement, live machine truth and production acceptance were **NOT TESTED** in this run.
- A page reload is not an Android cold restart or sign-out test. Two tabs on one physical tablet are not two independently operated devices or tenants.
- Screenshots and raw DOM evidence contain private workspace navigation. Keep them local/private; sanitize before external publication.

## Next executable steps

1. **Mike / physical technician:** the tablet is left in this project's Components panel with MLC selected, **identity not confirmed**, and **Check label** available. Check the actual device label, enter only observed identity fields, and confirm only those observations. Then ask the same coil-voltage/contact-arrangement question and open the source. No physical confirmation was made by the agent.
2. **CHARLIE component/UI owner, through the existing coordinator:** triage the job-sheet contrast, overlay and offscreen-retry findings above; establish expected behavior for “selected component” questions after clearing the selection. Retest the same physical-tablet cases on the repaired build and rerun the passing unconfirmed/stale-selection controls.
3. **CHARLIE Codex integration coordinator:** use the existing Conveyor 1 notebook for the machine-job part of the pilot, after reviewing its current data and scope. Do not manufacture another machine to bypass the duplicate guard. Carry this bounded staging receipt into the established delivery report and Mission Control; do not promote the whole pilot to accepted.

## Handoff state

Created notebook `[private record ID]`, thread `[private record ID]`, component `[private record ID]`. Component remains unconfirmed and selected. No job, note, work order, installed identity confirmation or equipment state was created by this run.

Device returned at approximately **18:03 ET**. Original three browser tabs remain; both temporary tabs were closed. Screen timeout, rotation and keep-awake settings match the saved originals. Only this run's ADB forward, tcp:54972, was removed. See `final-ui.json`, `41-final-handoff.png`, `device-release.json`.

**Mission Control: UNPUBLISHED.** This chat is a verification specialist and does not own the established CHARLIE-CODEX integration report. `MISSION-CONTROL-HANDOFF.md` is a local insertion packet for that owner, not a dashboard update. No competing lane comment or coordinator ownership change was made. Peer availability metadata records that the device is released.
