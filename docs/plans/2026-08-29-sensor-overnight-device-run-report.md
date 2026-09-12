# Sensor v0 — overnight Pixel run report (2026-08-28 → 08-29)

**Device:** Pixel 9a `55081JEBF07026` · **Build:** FactoryLM 1.1.0 / vc9, release cert `23:95:B9:60`, installed bytes SHA-256 `679397da…cdcdc9b` (verified) · **Prod:** mira-hub 3.308.0 `751f5a94a` · **Budget used:** 16 / 40 chat turns, 2 / 15 LOOK uploads, 2 / 6 REPLAY asks.

## Verdict: **PIXEL-PROVEN with defects** (no crash, no data corruption, no duplicate; 5 product issues filed)

| Phase | Result | Key evidence |
|---|---|---|
| 0 Preflight / artifact | PASS | sha match, vc9/1.1.0, not debuggable, prod ok |
| 1 Daytime pass (BACK ladder, Q1) | BACK PASS · **Q1 FAIL on sourced notebook** | rungs p1-07-*; refusals p1-10/11/17 → **#3468 (P0)** |
| 2 Real camera | PASS (limited) | QR viewfinder: camera HAL open + released (dumpsys); "Photograph a nameplate" = **picker** on hardware (#3436); LOOK card + answer p2-17/19 |
| 3 Real-machine REPLAY (G1) | LIMITED | CV-101 bound; timeline `0 recorded observations`, label **Live** with empty window (**#3470**); Ask MIRA → 412 approved-context (**#3469**); LOOK card + binding persist across force-stop |
| 4 Soak | **10 cycles clean on the checks that were real**; cycle 11 aborted by USB disconnect (guard worked) | phase4.json: every cycle relaunch ✓ REPLAY ✓ honest copy ✓ BACK×2 ✓ Photos (1) ✓ (dedup held all night); PSS 192–214 MB flat; 0 FATAL/ANR; prod ok. **CORRECTION (Phase 5):** the soak's chat asks never sent — `Send` bounds moved when the IME opened and the tap missed; the `answered` and `turn +1` probes were vacuous (Send always visible; the composer text matched the count). Persistence is still proven: the Phase-2 LOOK turn survived all 10 force-stop/relaunch cycles. Real chat turns used overnight ≈7, not 16. |
| 5 Morning regression | PASS (5/6; the 1 fail = the soak harness bug above, not the app) | markdown table + general caption; REPLAY view unchanged (0 rows, Live label, `_stale_s` leak = #3470); BACK ladder; Photos (1); list loads; logcat 0 FATAL/ANR; p5-*.png |
| 6 Restore | DONE | accelerometer_rotation=1 (saved value), stay_on_while_plugged_in=0, HOME, release build + login intact (p5-14) |

## Truthfulness sweep (hardware)
Live vs recorded: honest everywhere except #3470 (Live label on an empty anchored window). Stale/fresh: n/a (no rows). Requested window: header mirrors the request (−60/+10, −120/+10). Machine identity: bind persisted; banner copy broken (#3472). Provenance: LOOK card names phone photo; nameplate source cites the plate. Persistence: LOOK card, caption, binding survive force-stop; failed REPLAY ask correctly not persisted.

## Issues filed
- **#3468 P0** — sourced notebooks confirmed before #3440 refuse every question on prod (0 chunks under approved retrieval; #3437 boundary). Mike's call: backfill `verified` for user_confirmed sources.
- #3469 — REPLAY "Ask MIRA" offered on an empty window → 412.
- #3470 — "Live" with 0 observations; `_stale_s` tag leak in the header.
- #3471 — Sensor sheet footer under the nav bar (backgrounds the app); header link over the status bar.
- #3472 — lows: nameplate fields blank, evidence-card time mismatch (#3465), bind banner copy, source-count mismatch.

## Harness notes (for the skill)
- **Soak bug:** re-find the `Send` node AFTER typing (IME shifts layout); count turns from rendered assistant bubbles, never from nodes containing the question text (the composer matches). The app does NOT always restore the last notebook on relaunch (it landed on the list in the morning).
`tap-text` needs content-desc matching for LOOK/READ/REPLAY and the Sensor door ("Open Sensor"); the composer is the only EditText; "answered" = Send button back (the word "stop" appears in answers); screencap shows the camera viewfinder black — use `dumpsys media.camera`; the app restores the last notebook on relaunch.

## Phone state at disconnect
Release build + login intact; test notebook `Sensor v0 overnight 2026-08-28` (bound to CV-101, 1 photo, ~13 turns); `/sdcard/Pictures/mira_fixture_gs10.jpg` left; rotation locked (was 1) and stay-awake on — **restore on reconnect** (`device.py restore`).
