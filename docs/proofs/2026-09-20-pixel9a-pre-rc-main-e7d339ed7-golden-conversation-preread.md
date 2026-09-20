# Pixel 9a pre-RC pre-read — main `e7d339ed7` (debuggable variant) — #3851 real-device disposition + Golden Conversation phone side

**Label: PRE-RC, main `e7d339ed7`, DEBUGGABLE variant. This is component evidence, NOT the #3881 / #3882 release acceptance.** The
release acceptance is still owed on the exact RC/OTA artifact per the customer-ready ledger's gate split.

**Date:** 2026-09-20 02:45Z → 03:13Z · **Session:** Claude Code on CHARLIE (`mira-2b`, Device/ADB captain per #3626
issuecomment-5746666773) · **Device:** Pixel 9a `55081JEBF07026`, Android 16, 1080x2424, Mike's real tenant
(`e88bd0e8…`), AC powered · **Production at run time:** `app.factorylm.com` `/api/health/` = `recovery-0178b1b07`
(`0178b1b0776f30cccde42c8d255031254b882a38`, 20+ merges behind main; #3874 LOOK-observation persistence NOT deployed)
· **main at run time:** `e7d339ed7` (#3891); `f4ef32cad` (#3892, Hub-only) landed during the run.

## Artifact identity table (the #3881 RC needs the same)

| artifact | head | versionCode / versionName | signer SHA-256 | debuggable | apk sha256 |
|---|---|---|---|---|---|
| **stock on the phone before + after** (sideloaded 2026-09-19 07:30Z) | PR #3845 `93dddf10f` (RC candidate) | 12 / `1.2.1` | `2395b96050c510a5c787465b83256f381b1ff5e4833d2fa88db73579293f92a9` (CN=FactoryLM) | no | `f1b047a59614968ce39cea3acc1f4738132c00a5f02bce17166cf5850d498efc` |
| **pre-read build** (this run) | `origin/main` `e7d339ed7d8a79ce01eeed4b84f43de655fa13a1` | 12 / `1.2.1-main-e7d339ed7-dbg` (worktree-local, never committed) | same upload key, from Doppler `factorylm/prd` `ANDROID_KEYSTORE_*` | **yes** | `4dfc0efd699ce6052b388ea76fee9f6f3c32a361f7dc832c8441b6281825da46` |

Identity was proven by pulling the installed `base.apk` via `pm path` after each install and hashing it: `4dfc0efd…` while the
pre-read build was on the phone, `f1b047a5…` after the restore (`run-as` → "package not debuggable" confirms the restore is the
release build). `adb install -r` both ways — the phone's session, cookies and Preferences survived (no uninstall at any point).

## Method

- Build: `bun install --frozen-lockfile` → `bun run build` → `bunx cap sync android` → `assembleDebug` with a worktree-local
  `buildTypes.debug { signingConfig signingConfigs.release }` (same recipe as `2026-09-19-pixel9a-pr-device-acceptance.md`).
- Driving: uiautomator a11y tree (`uiautomator dump`) for taps/asserts; CDP over `webview_devtools_remote_<pid>` only on the
  debuggable build, for (a) `scrollIntoView` of off-screen drawer rows and (b) an in-page hook on `window.fetch` and the
  `androidBridge.postMessage` → `Capacitor.fromNative` pair recording method, path, top-level body keys, `sourceDocIds`
  count, `mode`, `threadId` and `visualEvidence.fileId` — never headers, cookies or bodies. The stock (release) build was driven
  by a11y only.
- Cold restart = `am force-stop` + `am start -n com.factorylm.mira/.MainActivity`; the app cold-boots in ~12 s on this phone.
- Fixture manual: `Robot_Arms_Electrical_Drawing_Package_Rev_3_0.pdf` (23 pages, sha256 `ab1a5c3280faa60d…`), NOT previously in
  the tenant (`/api/documents/` listed only the sibling build document). Expected page read out of the PDF **before** asking:
  p. 9 "XAP / ARM A STAR DISTRIBUTION / 7 fused branches". Pushed to `/sdcard/Download/`, removed after the run.
- Camera step used the real Google Camera (`CaptureActivity`), not the photopicker.

## Result 1 — #3851 (cold restart resumes the wrong thread): CONFIRMED on the RC, FIXED on main — on the real device

Same steps on both builds, project `Sensor v0 overnight 2026-08-28` (`8e329a9c…`, 7 threads): open the **non-latest** thread
"What is this component" (`thrd_71ce4a2d…`, 2026-09-19 10:58Z; the newest is "what should I check first" `thrd_a08b46cb…`, 8
turns, 11:29Z) → cold restart → lands on HOME → drawer → tap the project.

| build | after cold restart the project opens on | persisted pointer | verdict |
|---|---|---|---|
| stock RC `93dddf10f` (pre-#3891) | **"what should I check first"** — the newest thread (first turn "Verify the Modbus communication link first by reading register 0x2103…", CV-101 print-set citations) | not readable (release build) | **#3851 CONFIRMED on hardware** |
| main `e7d339ed7` (#3891) | **"What is this component"** — the last-viewed thread (Micro820 v4.1.9 answer, `Micro820_v4.1.9_Modbus_Map.pdf p. 1`) | `flm.unified.thread.v1.8e329a9c…` = `thrd_71ce4a2d…` before AND after the restart+open (not rewritten to the newest) | **FIXED** |

Screens: `2026-09-20_3851-rc-93dddf10f-last-viewed-non-latest-thread_android.png`,
`2026-09-20_3851-rc-93dddf10f-cold-restart-opens-newest-thread_android.png`,
`2026-09-20_3851-main-e7d339ed7-cold-restart-resumes-last-viewed-thread_android.png`. Emulator pre-read (before/after) is in
the `2026-09-20_3851-cold-restart-*` pair archived by #3891.

Note for the ledger: on both builds a cold launch lands on **HOME** ("What can I help you with?", the selected project shown in
the context strip) — the thread restore is exercised when the project is opened from the drawer, which is the #3851 case as filed.

## Result 2 — Golden Conversation (#3882 steps) phone side vs prod `0178b1b07` — pre-read

Project `PIXEL PRE-READ 2026-09-20 main-e7d339ed7` = notebook `2d806a43-9dc8-4e0b-8e7a-8a5568c1fa9a` (unbound: no manufacturer /
model / asset — the #3862 shape), thread `legacy` (a fresh notebook's first thread id), namespace node `4f78552c…`.

| # | step | result | evidence |
|---|---|---|---|
| 1 | sign in, create a Project (New project form, name only) | **PASS** — `POST /api/equipment-notebooks/` 201, opens on the project home | `…step1-unbound-project-created_android.png` |
| 2 | upload the new manual, wait until searchable | **PASS** — `POST /api/namespace/node/4f78552c…/files/` 201 → `POST …/sources/` → "Source added. Ask away." → Sources list shows **Searchable source**, ~65 s | `…step2-manual-searchable-source_android.png` |
| 3 | manual-specific question → citation → opens the right passage | **PASS** — Q "How many fused branches does the ARM A star distribution XAP have" → "The ARM A star distribution (XAP) has 7 fused branches [2]", chip `RA_Electrical_Drawing_Package_Rev_3_0.pdf p. 9`, badge "Grounded in this notebook's sources."; the chip opens the p. 9 passage containing "XAP / ARM A STAR DISTRIBUTION / 7 fused branches" with "Open original at cited page 9". Request body: `sourceDocIds: 1`, **no `mode: "general"`** — #3862's fix observed on hardware (turn `fa4bd796…`, `basis: oem_documentation`) | `…step3-cited-answer-p9_android.png`, `…step3-citation-opens-passage-p9_android.png` |
| 4 | camera photo → photo-specific follow-up uses the persisted observation | **client PASS / prod behind main** — Google Camera → Done → returned to the same thread in the foreground (same pid, no kill) with chip `photo.jpeg · captured for …`, no upload before Send; Send: `POST …/look/` 200 → `POST …/chat/` with `visualEvidence.fileId == cfafc0bc-4cfa-4522-bda0-7d36b2290452` → `IMG · PHOTO OBSERVATION` card with the same fileId, server `capturedAt 2026-09-20T03:06:29.206Z`, Provenance "phone photo". **The answer is blind** ("I can't identify the photo … without seeing the image") and still badged "Grounded in this notebook's sources." — that is the #3866 finding, fixed by #3874 on main and **not deployed** (prod `0178b1b07`). Recorded as **blocked on the OVH deploy (#3879)**, not as a client defect | `…step4-camera-return-chip_android.png`, `…step4-photo-card-blind-answer-prod-behind_android.png` |
| 5 | cold restart → same Project/thread/messages | **PASS** — HOME → drawer lists the project with its thread "How many fused branches does the ARM A…" + Sources (1) → open → both turns, the p. 9 chip and the photo card (same fileId) restore; pointer `flm.unified.thread.v1.2d806a43… = legacy` | `…step5-cold-restart-restores-thread_android.png` |
| 6 | web: open the same Project + thread | **PASS on the legacy Hub notebook page** `/equipment/2d806a43…/` (prod has no shared-shell `/v3` yet — that half stays owed to #3882 after the deploy) — both phone turns, the citation and "Visual observation · Photo captured · 23:06:29" render | `…step6-7-hub-legacy-notebook-web-followup_desktop.png` |
| 7 | web follow-up → persisted turn id | **PASS** — "WEB FOLLOW-UP: which drawing sheet does the ARM B star distribution XBP feed and how many fused branches does it have" → "…shown on drawing sheet 9 and it contains 7 fused branches [4]" (p. 9). Thread `legacy` turnCount 3; turn ids `fa4bd796-70f8-4b57-9f03-bc0d9c51bfea` (phone), `f38c93bc-8346-4292-827a-170e56859e04` (phone, photo), **`534a980c-518c-4aa3-92ea-752bd9277383` (web)** | same |
| 8 | phone relaunch → the web follow-up appears once in the same thread | **PASS** — after `force-stop` + relaunch + open project, the WEB FOLLOW-UP turn renders exactly once (`innerText` match count 1) with its p. 9 chip, in order after the two phone turns | `…step8-phone-sees-web-followup-once_android.png` |

Timestamps (UTC): project 02:58 · upload 03:00:01 · searchable 03:03 · Q1 03:04:12→:25 · photo 03:05:22 · Q2 03:06:28→:49 ·
restart 03:07 · web follow-up 03:08:40→03:09 · phone relaunch 03:10.

## New findings on main (not on the RC's known list)

1. **Drawer "New project" is disabled whenever a conversation is open** — it renders "Not available in this workspace yet."
   Only the HOME `UnifiedChat` passes `onCreateProject` (`UnifiedRoot.tsx` ~L386); `NotebookScreen`'s `UnifiedChat` never does,
   so the shell's honest-disabled branch (`packages/factorylm-ui/src/Sidebar.tsx` ~L145) shows. The only way to create a second
   project is a cold relaunch (lands on HOME). `2026-09-20_defect-new-project-disabled-in-conversation_android.png`.
2. **A project created from the New-project form is missing from the drawer until relaunch** — `UnifiedRoot.onCreated`
   (`~L314`) calls `open(nb.id)` but never adds `nb` to `notebooks`, so `notebookProjects()` doesn't list it and its Sources
   entry is unreachable (the HOME-send path does add the created notebook). Worked around tonight with a relaunch.
   `2026-09-20_defect-created-project-missing-from-drawer_android.png`.
3. **Reloaded turns show the raw basis key** — live turns are badged "Grounded in this notebook's sources."; after a restart the
   same turns are badged `oem_documentation` (visible in step 5/8 shots). Twin of the Hub "General badge copy" gap already on the
   #3875 list; presentation, shared-core lane.
4. Cosmetic: the citation sheet's Close button sits under the Android navigation bar (step 3 shot).

Items 1–2 are mobile-product-context lane (mine): filed as #3896 (New project disabled in a conversation, P1) and #3895 (created project missing from the drawer, P0). Item 3 needs the shared-core claim.

## Restore + cleanup

Original `1.2.1` vc12 reinstalled with `adb install -r` and byte-verified (`f1b047a5…`); not debuggable; fixture PDF removed from
`/sdcard/Download/` and re-scanned; `adb forward --remove-all`; launcher in focus; PHONE RELEASED announced on the peer hub at
03:13Z. `emulator-5554` untouched. The captured photo lives in the app's private `Pictures/` (part of the thread) and the
pre-read project remains in the tenant as the durable record of turns `fa4bd796…` / `f38c93bc…` / `534a980c…`.
