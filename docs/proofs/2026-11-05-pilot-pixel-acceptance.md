# Physical Pixel acceptance: 2026-11-05 Eastern

**NOT YET ACCEPTED.** Physical capture, offline retry, Atlas creation and finish/readback passed. **Cold restart did not restore the equipment notebook in the UI.** Two real-technician acceptance has not occurred.

## Environment and window

- Pixel 9a, serial `55081JEBF07026`, authorized USB ADB; physical Chrome **156.0.8078.79**. This is the web surface on the physical phone, not the native APK/OTA.
- Hub runtime **`090c8e15bfcbd85f0091103cf5a6f5fc6b221056`**, version **3.444.8**, built **2026-11-05T23:57:57Z**, verified through the phone's actual authenticated page. The cached browser bundle fingerprint was not captured; source/cache/auth bootstrap causality remains unproven.
- Recorded device window: **00:54:07–01:08:10 UTC** (14m03s). All phone operations ended before the recorded 01:09:07 deadline. No further phone access is needed for this report.
- Mike explicitly requested keeping the phone awake. Final power proof: Awake, powered, stay-on true, original all-source value **15** retained. PIN/keyguard/security settings were not disabled.
- A temporary approved QA sign-in was used. Original staging cookies/storage were backed up privately, then restored and verified: original non-QA identity/organization, HTTP200. Task tab and ADB forward9339 were closed/removed. Temporary credentials and session backup were deleted.
- No paid provider/review calls, deployment, migration, sync/dispatch/access changes, production action or unrelated data cleanup.
- One new explicitly labelled fictional QA job/order: job **`0ea9256a-5989-45e7-bba8-19dc81f2c564`**, notebook **`d36d1927-d466-4cb4-8cad-3ce8394c3201`**, bound **PUMP-01 / Goulds 3196**. Atlas **1653**. Existing emulator order1652 is unchanged.

## Results

| Required behavior | Physical evidence/result | Status |
|---|---|---|
| Correct approved fixture/runtime | Phone QA actor091/tenant0099, confirmed PUMP-01; runtime090/v3.444.8 | PASS for fictional fixture |
| Truthful attachment controls | Photo/File available; Camera/Scan QR disabled for browser with mobile-app reason; closing Attach preserves unsent draft | PASS |
| Interrupted note save and duplicate retry | Verified actual Chrome offline fault; durable one-entry queue; reconnect saves once; same event replay200/replayed, seq2 | PASS |
| Camera → real photo route → persisted file | Native Google Camera shutter and Done controls; real photo upload/render; one canonical photo/file | PASS for transport |
| Usable equipment image | Preview was dark/covered. It is not usable equipment evidence and was never interpreted by a model | UNVERIFIED |
| Handover and finish | Persisted note/handover/photo/finish; five distinct canonical events/client IDs; reload after save recovered them | PASS |
| One correct Atlas work order | 1653, exact title/machine/source job/photo reference/safety boundary; create delivery verified_by_readback, attempts1 | PASS |
| Finish and independent no-duplicate readback | Finish delivery verified_by_readback, attempts1; direct Atlas complete2-page scan finds only1653/create marker once; one finish comment after request replay | PASS |
| Actual Chrome cold restart | Same notebook/thread URL and QA login return, but UI shows General question without Job sheet despite notebook API200 | **FAIL** |
| Manual recovery control | Open navigation → select machine/project → Job sheet → physical Pixel005407 job. Existing note, photo, handover and finish recover | PASS |
| Second authorized account on Pixel | Restart failure interrupted this part; prior emulator-account evidence remains separate | UNVERIFIED |
| Native keyboard/Back | Optional harness step did not produce a trustworthy receipt; not counted | UNVERIFIED |
| Two real technicians / representative usefulness | Automated phone control and QA personas do not count as people | UNVERIFIED — mandatory |

Atlas1653 remains **OPEN**. The sheet reports a finish through one Atlas note; no equipment safety release or Atlas COMPLETE transition is asserted.

## Reproducible finding: notebook missing after cold restart

**Observed environment:** physical Pixel Chrome156 + staging Hub090. **Expected:** opening the preserved equipment notebook/thread URL after restart restores the correct equipment context and its Job Sheet control. **Actual:** generic chat renders instead.

1. Sign into the existing approved QA tenant0099, open the fixture notebook and start `STAGING TEST - physical Pixel 005407`.
2. Save a note, handover and camera photo; confirm one Atlas request, then finish the sheet. Existing canonical stream is seq5. No chat/model turn was submitted, so the chat thread is empty while the job is durable.
3. Preserve URL: `/v3/?notebook=d36d1927-d466-4cb4-8cad-3ce8394c3201&thread=1451abea-da56-4d77-beee-2d90e3e1c942`.
4. Force-stop **Chrome only**, then launch its resolved installed activity without supplying a URL.
5. The URL is identical. Authenticated `/api/me/` confirms QA actor091/tenant0099. Direct notebook GET returns200 and the correct notebook ID. Yet the UI shows “General question” and no Job Sheet control; its wait times out after30seconds. A subsequent page reload also initially lacked the control.
6. Manual project reselection recovers the job. It opens a fresh chat thread `5110e257-da27-48ca-8f40-642197bb3ecd`; the five saved job events are intact. This is a recovery control, not a passing restart.

Exact data: [receipt](2026-11-05-pilot-pixel/receipt.json), [failure](2026-11-05-pilot-pixel/restart-failure.json), [manual recovery](2026-11-05-pilot-pixel/manual-recovery.json), [direct Atlas proof](2026-11-05-pilot-pixel/atlas-independent.txt).

Screenshots: [actual Pixel after camera return](2026-11-05-pilot-pixel/native-camera-return.png), [restart failure](2026-11-05-pilot-pixel/restart-failure.png), [manual recovery](2026-11-05-pilot-pixel/manual-recovery.png).

Existing owner lane: Claude / UI continuity under #3882 and #3626; ranked G07 under #5232. #4609 is related list/bootstrap evidence, but its measured7-second delay is not assumed to explain this30-second failure. No new implementation writer was started.

**Smallest next action:** reproduce this exact empty-chat-thread/durable-job link on the current candidate in an unpaid browser test; identify the actual browser bundle/cache and bootstrap response sequence before changing code. Fix the confirmed selection/bootstrap cause in the existing UI lane, then rerun this same physical restart case. Never relax private-thread ownership to make a link open.

Pinned source inspection only: `HubShellHost.loadNotebooks` at `mira-hub/src/factorylm-ui/hub-host.tsx:223` restores URL selection only after the notebook list, via `selectionFromSearch(...) ?? landingSelection(...)`; `loadDetail` runs after selection. This is a relevant entry point, not a proven root cause.

## Remaining acceptance

No complete customer lane is promoted to Level3 or Level4. Correct-manual/cited-answer behavior was not exercised in this unpaid capture/Atlas test. A usable physical equipment photo, corrected physical restart, separate-account phone recovery and two real technicians remain open. #5204 remains HELD; production #5227 stays separate.

Verified entry (authorized QA organization required): <https://app-staging.factorylm.com/v3/?notebook=d36d1927-d466-4cb4-8cad-3ce8394c3201>. Open Job sheet → **STAGING TEST - physical Pixel005407** (actual saved title includes a space before005407).

Raw private test evidence and reproducible scripts are retained at:
`/Users/charlienode/Documents/Codex/2026-11-05/task/codex-pilot-journey-20261105T225657Z-5a2295/pixel15-20261106T005407Z`

Do not rerun create/order scripts: this physical trial's one-order allowance has been consumed. Restore verified runtime/source first for any future test. Keep five-minute human handoff from the emulator report, but do not record acceptance while the restart gate fails.
