# Sensor v0 — overnight Pixel device run (plan)

**Status:** ready to execute the night Mike leaves the Pixel 9a connected · **Owner:** Mike Crane ·
**Written:** 2026-08-28 · **Build under test:** mobile 1.1.0 / vc9 (`0688dd13f`, SHA-256 `679397da…cdcdc9b`,
already installed on the Pixel with Mike's login) against prod mira-hub 3.307.2.
**Skill:** `mobile-device-acceptance` (driver `tools/mobile-e2e/device.py`, `cdp.mjs`).
**Why:** the daytime Pixel pass was cut short at P3 (Mike needed the phone). Everything below the
emulator could not prove — real camera, real machine memory, a full night of relaunch/persistence
cycles — only the phone can.

## 0. Ground rules (non-negotiable)
- **Read-only toward equipment; bounded writes on Mike's real tenant.** One test notebook
  (`Sensor v0 overnight 2026-08-28`), never delete anything, never create/modify work orders.
  REPLAY asks go only to the dogfood machine notebook (CV-101 / garage conveyor).
- **Inference budget declared up front** (paid-inference rule): **≤ 40 chat turns, ≤ 15 LOOK
  uploads, ≤ 6 REPLAY asks** for the whole night. The driver counts and stops at the cap.
- **Phone etiquette:** focus guard before every tap batch; a call/notification shade/other app in
  front → wait 60 s, retry ×3, then skip the step (never tap through). Rotation locked and
  restored; `svc power stayon usb` on and restored; battery < 20 % → skip the soak phase.
- **Abort conditions:** app not foreground after 3 relaunches; adb device gone; prod
  `/api/health/` not ok for 5 min; any crash/ANR in `logcat` for our package → stop, capture, report.
- **No code changes overnight.** Defects are filed as issues with evidence; fixes are a daytime job.
- Evidence: `scratchpad/overnight-<date>/` + copies to `docs/promo-screenshots/` as
  `2026-08-29_sensor-overnight-<step>_android.png`; a single `report.md` at the end.

## 1. Phases (sequential; each phase writes its own `phaseN.json`)

| # | Phase | What it proves | Steps (all screenshot + JSON) | Budget |
|---|---|---|---|---|
| 0 | **Preflight** (5 min) | right artifact, right device, right prod | `device.py preflight` → version 1.1.0/vc9, cert `23:95:B9:60`, no DEBUGGABLE, `pm path`+sha256 == `679397da…`; prod health sha `0688dd13f`; battery; logcat clear (`logcat -c`) | 0 turns |
| 1 | **Finish the daytime pass** (P4–P5) | BACK ladder + Q1 on hardware | LOOK card → BACK → picker → BACK → notebook → BACK → list; grounded ask on a sourced notebook → citation chip → sheet → ✕; markdown table; Stop visible; streaming growth profile (expect one buffered jump — #3453) | 3 turns |
| 2 | **Real camera** (the emulator's SKIP) | camera path actually works on hardware | READ → "Scan FactoryLM QR" → viewfinder opens (permission prompt handled once) → BACK; READ → "Photograph a nameplate" → if the app offers the camera, capture the desk; else gallery (report which — this is the #3436/#3353 state on hardware); LOOK → same intake → evidence card | 2 turns, 2 uploads |
| 3 | **Real-machine REPLAY (G1 on hardware)** | Machine Memory → timeline → Ask MIRA on a live-connected machine | open CV-101 notebook → Sensor → REPLAY: record header (`N recorded observations in −60 s … +10 s`), freshness label/banner (**Live** if the gateway is posting; **Stale** otherwise — both honest, record which and the `ingested_at` clocks), widen to 120 s; "Ask MIRA what happened" → answer audit: no "live" for recorded rows, no values absent from the window; card + caption (`machine_history` vs `live_machine_evidence` per freshness); force-stop → relaunch → card persists; API cross-check via web harness (turn `basis`, `evidence[]`) | 2 REPLAY asks |
| 4 | **Soak** (the night) | no leaks, no duplicates, persistence across 8 h | every 30 min for up to 12 cycles: relaunch → open test notebook → Sensor → LOOK (same fixture from gallery) → Ask MIRA (short) → Sources → Photos (N) — N must stay 1 (dedup) → BACK ladder → force-stop; record `dumpsys meminfo` PSS, turn count (+1 per cycle exactly), photos count (=1), logcat crash/ANR grep, prod health. Stop early at the turn cap. | ≤ 12 turns, 12 uploads (deduped) |
| 5 | **Morning regression** (10 min) | nothing rotted overnight | repeat Phase 1's Q1 checks + one REPLAY view (no ask) + Notebook list loads; compare screenshots to Phase 1 | 2 turns |
| 6 | **Report + restore** | Mike wakes up to one page | `restore` (rotation, stay-awake), HOME; `report.md`: table per phase, budget used, defects (product vs harness), issues filed, screenshot index; docs PR for screenshots (auto-merge) | — |

Total worst case: ~21 turns, 14 uploads — inside the declared budget.

## 2. Decision points the driver must make (pre-decided here)
- **Freshness on CV-101:** if the gateway is posting overnight, REPLAY will label **Live** and the
  ask will carry `live_machine_evidence`; that is correct and is the first live-basis proof — capture
  it. If stale, the Stale banner + `machine_history` is the expected result. Either passes; a
  mismatch between the label and the basis caption is a defect.
- **Camera path:** the Sensor LOOK button invokes the gallery picker by design (v0); a camera
  option only exists where the app offers it. Record the observed path; do not treat "picker, not
  camera" as a defect (it is #3436's HELD scope).
- **Permission prompts** (camera/photos): accept once via uiautomator; if a prompt cannot be found
  in the dump, screenshot and skip the step (Android 15 photo-picker sheets are not always in the
  a11y tree).
- **Duplicate detection:** Photos (N) growing past 1 with the same fixture bytes = product defect
  (dedup broke); turn count growing by ≠ 1 per cycle = duplicate/lost turn — both are blockers
  for the next release, filed immediately.
- **Answer-hijack check** (from the critic): before each ask, ensure the previous turn is answered;
  if a turn is stuck unanswered, note it and continue (pre-existing history semantics, #3455-adjacent).

## 3. Execution mechanics
- Runner: one agent session using the `mobile-device-acceptance` skill, invoked as
  `/loop 30m` over the soak step after Phases 0–3 complete in the foreground; or a single agent
  with `sleep` between cycles (simpler; the machine stays on). Prefer the single agent — fewer
  moving parts overnight.
- Start command (when the phone is plugged in and unlocked): "run the overnight plan
  `docs/plans/2026-08-28-sensor-overnight-device-run.md`".
- The laptop must not sleep (Windows power plan) and the USB cable must stay in; the phone's
  screen stays on via `svc power stayon usb` (restored in the morning).
- Nothing in this plan requires Mike's interaction after plugging in; the permission prompts in
  Phase 2 are handled by the driver, and if they can't be, the step is skipped, not blocked on.

## 4. What this run does NOT do
No prod ingest, no staging changes, no work orders, no app reinstall (the certified artifact is
already on the phone), no LISTEN/VIBRATION, no fixes. If a real defect shows, it becomes a
daytime PR with its own tests.

## 5. Morning deliverables
1. `report.md` with the six phase tables, the budget ledger, and a verdict:
   **PIXEL-PROVEN** (all phases pass or documented-limit) / **PIXEL-DEFECT** (list).
2. Issues for any product defect (evidence links, product vs harness).
3. Docs PR with the night's screenshots (auto-merge).
4. Phone left: rotation restored, stay-awake off, HOME screen, release build + login intact.
