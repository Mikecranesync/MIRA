# Sensor v0 — overnight Pixel run report (2026-08-28 → 08-29)

**Device:** Pixel 9a `55081JEBF07026` · **Build:** FactoryLM 1.1.0 / vc9, release cert `23:95:B9:60`, installed bytes SHA-256 `679397da…cdcdc9b` (verified) · **Prod:** mira-hub 3.308.0 `751f5a94a` · **Budget used:** 16 / 40 chat turns, 2 / 15 LOOK uploads, 2 / 6 REPLAY asks.

## Verdict: **PIXEL-PROVEN with defects** (no crash, no data corruption, no duplicate; 5 product issues filed)

| Phase | Result | Key evidence |
|---|---|---|
| 0 Preflight / artifact | PASS | sha match, vc9/1.1.0, not debuggable, prod ok |
| 1 Daytime pass (BACK ladder, Q1) | BACK PASS · **Q1 FAIL on sourced notebook** | rungs p1-07-*; refusals p1-10/11/17 → **#3468 (P0)** |
| 2 Real camera | PASS (limited) | QR viewfinder: camera HAL open + released (dumpsys); "Photograph a nameplate" = **picker** on hardware (#3436); LOOK card + answer p2-17/19 |
| 3 Real-machine REPLAY (G1) | LIMITED | CV-101 bound; timeline `0 recorded observations`, label **Live** with empty window (**#3470**); Ask MIRA → 412 approved-context (**#3469**); LOOK card + binding persist across force-stop |
| 4 Soak | **10/10 clean cycles**, cycle 11 aborted by USB disconnect (guard worked) | phase4.json: every cycle open ✓ REPLAY ✓ honest ✓ BACK×2 ✓ answered ✓ turn +1 ✓ Photos (1) ✓; PSS 192–214 MB flat; 0 FATAL/ANR; prod ok; battery 100 % |
| 5 Morning regression | pending phone reconnect | — |
| 6 Restore | pending phone reconnect (rotation lock + stay-awake still applied) | — |

## Truthfulness sweep (hardware)
Live vs recorded: honest everywhere except #3470 (Live label on an empty anchored window). Stale/fresh: n/a (no rows). Requested window: header mirrors the request (−60/+10, −120/+10). Machine identity: bind persisted; banner copy broken (#3472). Provenance: LOOK card names phone photo; nameplate source cites the plate. Persistence: LOOK card, caption, binding survive force-stop; failed REPLAY ask correctly not persisted.

## Issues filed
- **#3468 P0** — sourced notebooks confirmed before #3440 refuse every question on prod (0 chunks under approved retrieval; #3437 boundary). Mike's call: backfill `verified` for user_confirmed sources.
- #3469 — REPLAY "Ask MIRA" offered on an empty window → 412.
- #3470 — "Live" with 0 observations; `_stale_s` tag leak in the header.
- #3471 — Sensor sheet footer under the nav bar (backgrounds the app); header link over the status bar.
- #3472 — lows: nameplate fields blank, evidence-card time mismatch (#3465), bind banner copy, source-count mismatch.

## Harness notes (for the skill)
`tap-text` needs content-desc matching for LOOK/READ/REPLAY and the Sensor door ("Open Sensor"); the composer is the only EditText; "answered" = Send button back (the word "stop" appears in answers); screencap shows the camera viewfinder black — use `dumpsys media.camera`; the app restores the last notebook on relaunch.

## Phone state at disconnect
Release build + login intact; test notebook `Sensor v0 overnight 2026-08-28` (bound to CV-101, 1 photo, ~13 turns); `/sdcard/Pictures/mira_fixture_gs10.jpg` left; rotation locked (was 1) and stay-awake on — **restore on reconnect** (`device.py restore`).
