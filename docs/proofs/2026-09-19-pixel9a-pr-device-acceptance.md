# Pixel 9a device acceptance — PRs #3829, #3837, #3835 (+ #3807, #3664 checks)

**Date:** 2026-09-19 · **Session:** Claude Code on CHARLIE, `d4cc6440` · **Device:** Pixel 9a
`55081JEBF07026`, Android 16, 1080x2424, Mike's real tenant, notebook `Sensor v0 overnight 2026-08-28`
· **Edge of production at run time:** `origin/main` `392b278f2` (#3840).

Companion to `2026-08-21-pixel9a-mobile-production-proof.md`. This run covered only what the
emulator cannot: real camera capture, Android task recovery after the camera, and the retry that had
failed on hardware. Per-PR tables with the same content are posted on each PR
(#3829 comment `5741487655`, #3837 `5741487828`, #3835 `5741488111`, #3807 `5741491639`).

## Method

- Each PR head was built with `assembleDebug` in a detached worktree, **DEBUGGABLE**, signed with the
  release upload key (signer `2395b960…f92a9`) so `adb install -r` replaced the phone's app in place
  and the session survived. The phone carried a sideloaded 1.2.1 **versionCode 12** (ahead of main's
  11), so each build used a worktree-local `versionCode 12` / `versionName "1.2.0-pr<N>"`.
- Artifact proof: installed `base.apk` pulled back via `pm path` and its sha256 compared to the
  built file, for every install and for the restore.
- Network evidence: an in-page hook on `window.fetch` and `CapacitorHttp.request` recording method,
  path, top-level body keys, the `/look/` `fileId` and the SSE `visualEvidence` frames — never
  headers, cookies or bodies. Debug builds only (CDP over `webview_devtools_remote_<pid>`).
- Restore: original 1.2.1 vc12 (sha256 `f1b047a59614968c…`) reinstalled, byte-verified, not
  debuggable, drawer shows the signed-in account; rotation and stay-awake restored; fixture image
  removed from `/sdcard/Pictures`.

| build | head | installed apk sha256 (prefix) |
|---|---|---|
| PR #3829 | `c0181074b80933233d3fb040bec804396615a5e3` | `f7426e0c44209983` |
| PR #3837 | `747c22f8dcc0a0bca24b152f927ae8bbdd79637d` | `13957517661ada86` |
| PR #3835 | `4234b0dd8c04c57bb946d784704d9793dbd764e9` | `c6458419ac6a84e0` |
| stock 1.2.1 vc12 (before + after) | sideloaded 2026-09-18 | `f1b047a59614968c` |

## Results

### Stock 1.2.1 (no install)

| check | result | evidence |
|---|---|---|
| #3664 OTA — About → Check now | **LIMITED**: UI says "Up to date", last checked stamped; the manifest request is not observable on a release build, so a 401 masked as up-to-date is not excluded | `2026-09-19_ota-about-check-now-up-to-date_android.png` |
| #3807 history survives cold restart | **PASS**: `am force-stop` → relaunch → thread reopens with last turn, citation chip and photo card | `2026-09-19_history-survives-cold-restart_android.png` |
| cold-launch landing | note: lands on the project home, not the last thread | — |

### PR #3829 — native attachment flow (`c0181074b`)

| step | result | notes |
|---|---|---|
| B real camera capture → chip | PASS | Google Camera launched; chip `photo.jpeg · captured for … · attached` + `Remove photo.jpeg` |
| D no upload before Send | PASS | netlog empty after every one of six captures |
| C remove pending attachment | PASS | chip gone, thread intact, no request |
| E send in-thread | PASS | `/look/` 200 `fileId d1a170ad…` → `/chat/` `visualEvidence.fileId == d1a170ad…` → SSE frame → card with same id, server-derived `capturedAt` |
| **7 failed upload → Try again** | **PASS** (FAIL at `1382b1c4`) | radios off: `/look/` thrown, banner, question restored; radios on: Try again → `/look/` 200 `62d91341…` → `/chat/` with equal fileId → frame → card |
| A HOME attachment (New chat) | PASS (client) / server refused | first `/chat/` carried `visualEvidence.fileId == 20a18b53…`; server answered "I couldn't find anything about that in your sources", no frame, no card → #3788 |
| #3807 on this build | PASS | thread list + thread survive force-stop |
| anomaly (seen once) | recorded | 2nd of 6 camera returns came back on project home, chip lost; `Capacitor: App restarted`, no kill; not reproduced |

Screenshots: `2026-09-19_pr3829-camera-chip-attached_android.png`,
`2026-09-19_pr3829-photo-answer-card_android.png`, `2026-09-19_pr3829-c7-upload-failed-banner_android.png`,
`2026-09-19_pr3829-c7-retry-with-photo_android.png`.

### PR #3837 — photo answers grounded in the LOOK observation (`747c22f8d`, tested at its own head)

| step | result | notes |
|---|---|---|
| camera → upload at pick → chat | PASS (mechanics) | `/look/` fired on return with the default question; `/chat/` with equal fileId; user turn rewritten to `Visual observation (07:12:26, phone photo): A Siemens SIMATIC S7-1200 …` (1151 chars) |
| **answer to that turn** | **FAIL — SAFETY STOP** | observation contained *"No visible damage, burn marks, or corrosion"*; the safety keyword matcher hit `burn mark` inside a negation → `⛔ SAFETY STOP · Trigger: burn mark`, LOTO steps, no answer, no card |
| gallery pick (fixture image) | PASS | `/look/` 200 `539650d5…` → `/chat/` equal fileId → frame → card + "Grounded in this notebook's sources." |
| no-observation fail-closed | LIMITED | not exercisable from a real camera; copy string present in the bundle |

Defect: prefixing vision prose into the question routes it through the chat-side safety classifier,
which does not parse negation. Screenshots: `2026-09-19_pr3837-observation-prefix-safety-stop_android.png`,
`2026-09-19_pr3837-gallery-grounded-card_android.png`. Caveat: on a build converged with #3829 this
code path is dead (the unified shell holds bytes until Send).

### PR #3835 — camera resume recovery stays in foreground (`4234b0dd8`)

| step | result | notes |
|---|---|---|
| capture → Done ×2 | PASS | foreground in 1 s, same pid |
| camera → Close (cancel) | PASS | foreground in 1 s |
| HOME 60 s → app → capture → Done | PASS | foreground in 1 s; photo turn answered with card |
| logcat, whole window | PASS | `App restarted` + `MiraWebViewRecovery: resume probe ok` on every return; zero `moveTaskToBack`, zero blocked background launches, no app kills except my own installs |

Artifact delta confirmed: `classes12.dex` has `shouldKickSurface`, no `moveTaskToBack`.
Screenshot: `2026-09-19_pr3835-camera-return-after-60s-background_android.png`.

## Process notes

- Another CHARLIE session ran `am start` / `am force-stop` against the phone at 06:58 local while
  the #3829 build was installed; coordinated over claude-peers, that session re-credited its result,
  and the affected steps were re-run with a fresh hook. All sessions on CHARLIE share one adb server:
  announce the phone hold via `set_summary` and message the execution lead before touching it.
- `tools/mobile-e2e/device.py` defaults `ADB` to a Windows path; export `ADB=/opt/homebrew/bin/adb`.
- The Android photopicker on this phone is multi-select: tap the tile, then **Done**; a swipe inside
  the sheet dismisses it.
