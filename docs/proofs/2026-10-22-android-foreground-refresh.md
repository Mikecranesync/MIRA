# Android foreground refresh, Golden Conversation "return to Android" leg (PRD #3990), 2026-10-22

**Label: PARTIAL.** Proven on the Android emulator against **staging**, with before and after builds. Not proven: a physical Pixel, and production (no OTA or deploy was done).

## Gap

#4619 proved the Golden Conversation on production web and the emulator, but its step 13 ("return to Android") relaunched the app. That hides the real leg.
- The leg: the technician has a thread open on the phone, presses Home, continues the same thread on web, and returns to the app.
- `NotebookScreen` loaded the notebook detail only when `id` or `threadId` changed. Nothing listened for resume, so the open thread stayed stale until it was reopened or the app relaunched.

## Identities

| item | value |
|---|---|
| Staging hub | `app-staging.factorylm.com` `/api/health/` gitSha `13d4608d1829b9469d9ab005bcc6b1cc333166ad` |
| Before APK | `com.factorylm.mira.staging` stagingDebug built from main `6bd437aa7`, sha256 `ed7349ccf9656c469871c804e5ed6329cd13ea2f661c230e322964c452881020` |
| After APK | stagingDebug built from `fix/3990-android-foreground-refresh` `3e245cdb6`, sha256 `f011f435fa2e17a4536b6c12704b4e5a3a2bcdff00581d1cb9dd4abdf9da90ed` |
| Emulator | AVD `flm-accept` (API 35, arm64), cold boot, BRAVO |
| Account | `dana@synthetic.test` (Doppler `factorylm/stg` `SYNTHETIC_DANA_PASSWORD`) |
| Thread | notebook `d2897f61-c594-49c7-9ce8-abacc7928963` ("Fireplace phone repair B — Sept 25"), thread `thrd_e2846253a90f4bb791fe9470498a0cd8` |
| Web driver | headless Chromium on `/v3`, 1440×900, typing in the real composer and pressing Send |
| Phone driver | uiautomator + `adb input`. Background is `KEYCODE_HOME`. Return is a launcher tap. The pid is compared to prove a resume, not a relaunch |

## Result

| # | step | build | result | evidence |
|---|---|---|---|---|
| 1 | open thread on phone | before | 2 turns shown | `before-01-thread-open.png` |
| 2 | Home → web follow-up "GC RESUME BEFORE…" → resume | before | **FAIL (reproduced).** The server has turn `9b4e4d14`. pid 4303 is unchanged, so this was a resume. After 5 s and again after 25 s the phone shows no new turn | `web-followup-before_desktop.png`, `before-03-still-stale-25s.png` |
| 3 | open thread on phone | after | 3 turns shown (fresh load) | `after-01-thread-open.png` |
| 4 | Home → web follow-up "GC RESUME AFTER…" → resume | after | **PASS.** pid 5558 is unchanged. Within 5 s the web turn renders, with its OEM citation (QUINT-PS-100 manual p. 15) | `web-followup-after_desktop.png`, `after-02-after-resume.png` |
| 5 | ask on phone ("GC PHONE TURN…") | after | answered and persisted as turn `1e3d5660` | `after-03-phone-turn.png` |
| 6 | Home → web follow-up "GC RESUME AFTER 2…" → resume | after | **PASS.** pid unchanged. The web turn `7a9982c5` renders. The phone turn appears **once** in the whole accessibility tree, not twice (live + persisted) | `after-04-resume-after-phone-turn.png` |
| 7 | cold restart (`am force-stop` → launch → open thread) | after | **PASS.** New pid 7464, and each of the 6 turns appears exactly once | `after-05-cold-restart.png` |

Server order at the end: `729e691b, d31f685f, 9b4e4d14, 47fd1dd6, 1e3d5660, 7a9982c5`. These are one thread, alternating web and phone.

## Not covered here

- **Physical Pixel.** It needs the owner to unlock it.
- **Production.** The fix ships only through a mobile OTA or release, which Mike gates.
- **The manual → citation passage legs.** #4619 already proved them on production and are unaffected by this change.
