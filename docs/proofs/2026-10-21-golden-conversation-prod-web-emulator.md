# Golden Conversation (PRD #3990) — prod web + Android emulator, 2026-10-21/22

**Label: journey PASS on prod web, Android emulator AND the physical Pixel 9a** (Pixel leg added 2026-10-23 after the
owner unlocked the device). Not the #3882 / release acceptance: it proves the shipped prod app + prod hub, not main or an RC.
Production was redeployed between the legs (see identities); both builds served the same thread without loss.

## Identities

| item | value |
|---|---|
| Production hub | web + emulator legs (2026-10-21/22): gitSha `22164415af1a8e28925d096edf6bba44f2100683` (3.410.0, built 2026-10-20T05:30Z). Pixel leg (2026-10-23): gitSha `0e5bb3de7ee6f1ee4d4cd38a32404f3b4a0ecfba`, built 2026-10-22T02:50Z |
| Physical device | Pixel 9a `55081JEBF07026`, Android 16, AC powered, owner-unlocked; installed `base.apk` sha256 `c5f0e7c8…` (same as the emulator), owner's prod session = same user (`02808f0e…`) and tenant as the web/emulator account |
| `origin/main` at run start / at write-up | `d1d1511de` / `7aed87e31` (prod is behind main; this proves prod, not main) |
| Android artifact | `com.factorylm.mira` 1.2.0 (16), pulled from the Pixel 9a `55081JEBF07026` as installed (`base.apk` sha256 `c5f0e7c815dda8480f9918698c34e913ea67efd5958d75940da17154296346ed`), installed byte-identical on emulator `mira35` (API 35, arm64) |
| Live-update bundle | About screen: native fingerprint `6263470a0205fa6b`, active bundle **packaged**, channel production |
| Account | Doppler `factorylm/dev` `MOBILE_E2E_*` — tenant `e88bd0e8…`, role owner. Same tenant as the Pixel's 9-20 proof; it sees the Pixel's own threads (e.g. `thrd_71ce4a2d…`), so threads are tenant-visible |
| Web driver | headless Chromium (Playwright 1.x from `mira-hub/node_modules`), 1440×900, `/v3` shared shell |
| Android driver | uiautomator accessibility tree + `adb input` (release build, no CDP) |

## Fixture and pre-registered expectation

- Manual: ABB ACS150 user manual (`abb-acs150.pdf`, 172 pages, sha256 `b2d7011f41ef2c6987a986c615587967ef87652396bed2bfe64c2d4f8cac52c8`),
  public OEM document, not previously in this project.
- Read out of the PDF **before asking**: printed page 130 = PDF page 130, fault table — `F0003 DEV OVERTEMP … Fault trip
  limit is 135 °C … Check ambient conditions … Check air flow and fan operation … Check motor power against drive power`;
  `F0002 DC OVERVOLT … 840 V for 400 V drives`; `F0001 OVERCURRENT … 325% of drive nominal current`; `F0006 DC UNDERVOLT`
  causes.
- Photo: real bench photo of the garage AutomationDirect GS10 (`plc/conv_simple_electrical/review/photos/gs10_full.jpg`),
  display `H0.00`. Deliberately NOT the manual's drive, to check that the photo is analyzed before use and that ABB
  citations are not misapplied.

## Result by step

Project `GC 2026-10-21 ABB ACS150` = notebook `175411fb-7d36-48c0-a8e3-06ef6e393c56`, thread `4a6d18d5-e4d6-400e-a832-433d7b96fd23`.

| # | step | surface | result | evidence |
|---|---|---|---|---|
| 1 | New project | web | **PASS** — `POST /api/equipment-notebooks/` 201 (New project uses `window.prompt`; the harness accepts it) | `web-03-created.png` |
| 2 | attach real manual | web | **PASS** — File → `POST …/node/00a7b01d…/files/` 201 → `POST …/sources/` 201 | `web-06-answer1.png` |
| 3 | known-answer question | web | **PASS** in 30 s incl. ingest — "F0003 DEV OVERTEMP trips at 135 °C. Check ambient conditions, air flow and fan operation, and motor power against drive power." | `web-06-answer1.png` |
| 4 | grounded + cited | web | **PASS** — chip `abb-acs150.pdf p. 130`, "Grounded in this notebook's sources." | same |
| 5 | citation opens the real passage | web | **PASS** — in headed Chrome the source viewer renders the PDF at **page 130 / 172** (fault table visible), and its "Open document in a new tab" opens `/api/namespace/files/5ac80027-be74-40f2-a280-bfb7fc869d90/#page=130`, where page 130 visibly reads "F0003 DEV OVERTEMP … Fault trip limit is 135 °C … Check air flow and fan operation". The served file is byte-identical to the upload (same sha256). The first run's headless capture was blank (headless Chromium has no PDF viewer), so it is not the evidence | `web-cite-headed-viewer.png`, `web-cite-headed-newtab.png` |
| 6 | follow-up | web | **PASS** — "F0002 DC OVERVOLT trips at 840 V on a 400 V drive", p. 130 | `web-08-followup.png` |
| 7 | persistence | web | **PASS** — fresh browser context on bare `/v3/` → sidebar row → both turns + chips restore; server turn ids `8de44841…`, `06561775…` | `web-09-persist-reopen.png` |
| 8 | same thread on Android | emulator | **PASS** — drawer lists the project and thread; both web turns render with p. 130 chips | `emu-03-thread-from-web.png` |
| 9 | citation on Android | emulator | **PASS** — passage sheet "…F0003 DEV OVERTEMP Drive IGBT temperature is excessive. Fault trip limit is 135 °C. Check ambient conditions.…", "Open original at cited page 130" | `emu-04-citation-open.png` |
| 10 | follow-up on Android | emulator | **PASS** — "F0001 OVERCURRENT trips at 325% of the drive nominal current", p. 130 (turn `3fefee82…`) | `emu-06-android-followup-answer.png` |
| 11 | cold restart | emulator | **PASS** — `am force-stop` (no pid) → relaunch lands on HOME → drawer → thread: all three turns and their citations restore | `emu-07…`, `emu-08…`, `emu-09-restored-top.png` |
| 12 | continue on web | web | **PASS** — the Android turn and WEB FOLLOW-UP 2 (F0006 causes, p. 130, turn `3089d6e2…`) each render exactly once in the thread's DOM | `web-ev-step12_android.png`, `web-ev-step12_web2.png`, `web-dom-assertions.json` |
| 13 | return to Android | emulator | **PASS** — after relaunch, WEB FOLLOW-UP 2 is in the thread with its p. 130 chip | `emu-10-android-sees-web-followup2.png` |
| 14 | photo analyzed before evidence | web → emulator | **PASS** — `POST …/look/` before `POST …/chat/`; answer "AutomationDirect … display reads H0.00 … unconfirmed photo reading", **no ABB citation applied**, "Grounded in workspace evidence", one observation card (photo thumbnail, Verified **no**); the same card on Android | `web-ev-step14_photo.png`, `emu-11-photo-turn-on-android.png`, `web-dom-assertions.json` |
| 15 | open the same thread on the phone | Pixel 9a | **PASS** — drawer → thread; every turn renders in server order (web, emulator, web, photo turn + observation card) | `px-02-thread.png` |
| 16 | citation on the phone | Pixel 9a | **PASS** — passage sheet "…F0003 DEV OVERTEMP Drive IGBT temperature is excessive. Fault trip limit is 135 °C. Check ambient conditions.…", "Open original at cited page 130" | `px-04-citation-passage.png` |
| 17 | follow-up on the phone | Pixel 9a | **PASS** in 9 s — "F0004 SHORT CIRC means a short circuit in the motor cable(s) or motor. Check the motor and motor cable", p. 130 (turn `d76ca61f…`) | `px-06-pixel-followup-answer.png` |
| 18 | cold restart on the phone | Pixel 9a | **PASS** — `am force-stop` (pidof empty) → relaunch (new pid 8602) lands on HOME in 6 s → drawer → thread: the phone turn, its answer and the p. 130 chip restore | `px-07…`, `px-08-cold-restart-thread-restored.png` |
| 19 | phone → web | web | **PASS** — PIXEL GC FOLLOW-UP renders exactly once; "WEB AFTER PIXEL" answered (F0007 AI1 LOSS, cited p. 130 + p. 111, both checked against the PDF), turn `8d08335b…` | `web-ev-step19_pixel.png`, `web-ev-step19_web3.png`, `web-dom-assertions.json` |
| 20 | web → phone | Pixel 9a | **PASS** — after force-stop + relaunch the web turn appears exactly once with both chips | `px-09-pixel-sees-web-after-pixel.png` |

`web-dom-assertions.json` (captured 2026-10-23) saves the per-question DOM counts (each later turn = 1), the photo-card count, and the server's turn ids and timestamps.

Server truth at the end: 5 turns in thread `4a6d18d5…` with unique ids `8de44841`, `06561775`, `3fefee82`, `3089d6e2`, plus
the photo turn. "Exactly once" relies on those unique ids plus the web count; the Android scan confirmed order and presence.

## Findings (filed, not fixed — #4618)

1. The photo card says **Provenance: phone photo** for a desktop file-picker upload. The shared type allows only `phone_photo`
   and the server stores no capture origin.
2. The same saved turn is captioned "Grounded in this notebook's sources." on web and "Grounded in the cited documentation."
   on a reloaded Android turn. Android is the conservative one (#4025 / Codex #4301 F1); this is parity, not safety.

## Foreign turns in the test thread

Two turns not written by this run appear at 2026-10-23 05:25Z and 05:30Z ("PIXEL RESUME CHECK…", "PIXEL PHONE TURN…"),
same user id. No Claude/Codex transcript on CHARLIE contains them; origin unattributed. They were left untouched and render
correctly on every surface. Final server truth: 9 unique turn ids in thread `4a6d18d5…`.

## Not done / owed

- Phone **camera** capture was not exercised on hardware in this run (the photo turn came from a web upload and rendered on
  the phone). The 9-20 pre-read covered camera → chip → photo card on this phone.
- "Open original at cited page 130" was not tapped on the phone (Android opens PDFs via download → Files/Drive, owner-accepted).
- No code change: the journey exposed no failing step on any surface. Two P3 parity items are filed as #4618.
