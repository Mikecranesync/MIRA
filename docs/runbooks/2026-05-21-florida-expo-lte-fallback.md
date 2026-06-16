# Florida Automation Expo 2026-05-21 — Network Fallback Runbook

**Owner:** Mike Harper
**Demo date:** Thursday 2026-05-21
**Audience:** booth operator (Mike) — single page, glance-able

## Why this exists

Trade-show wifi is unreliable. The demo wedge (`/scan/` camera flow + Hub + Atlas + Telegram bot) is 100% cloud-dependent. A 20-second wifi blackout kills the entire pitch mid-prospect. This runbook is what to do when the network drops.

## Pre-demo (do this once on 2026-05-20 evening)

1. **Two tablets provisioned and tested:**
   - iPad (primary): Safari logged in to `https://app.factorylm.com/feed`. Home-screen shortcuts pinned for `/feed`, `/scan/`, `https://cmms.factorylm.com/`. Telegram app installed, logged in, `@FactoryLMDiagnose_bot` open.
   - Android tablet (backup): Chrome logged in to the same surfaces. Same shortcuts.
   - Both tablets: airplane-mode test → return to normal → confirm camera + chat still work.
2. **Two SIMs / hotspots ready:**
   - Primary: phone-as-hotspot on Mike's personal carrier (Verizon/T-Mobile).
   - Backup: dedicated travel hotspot (one of the GL.iNet pucks) with a fresh data plan, fully charged.
3. **Static fallback assets staged on iPad Photos app:**
   - `nameplate_gs10.jpg` (the demo nameplate)
   - 5 pre-captured screenshots of a successful scan→chat sequence, in order, named `01_scan_open.png` → `05_kb_cite.png`.
   - Three Atlas screenshots: WO list, asset detail, PM calendar.
4. **One paper handout ready** with QR codes pointing at:
   - https://factorylm.com (marketing landing)
   - https://app.factorylm.com/scan/ (live scan)
   - support@factorylm.com (fallback contact)

## At the booth — network state machine

| Symptom (what you observe) | Action (do this immediately) | Recovery time |
|---|---|---|
| Tablet shows wifi connected, /scan/ extracts in ≤5s | Nothing. Demo normally. | — |
| /scan/ spinner past 8s | Pull down to refresh; tap "Upload photo" instead of "Scan plate" (uses gallery, less network jitter). | 5s |
| Two scans in a row stall | Switch tablet to phone-hotspot (toggle wifi off → personal hotspot). | 30s |
| Hotspot too — both networks dead | Switch to **static fallback mode**: walk the prospect through the pre-captured PNGs in Photos. Lead with "let me show you exactly what just happened…" | 15s |
| Live demo back online during static-mode | Finish the static walkthrough, then say "let me show you with your nameplate" and re-engage the live flow. | — |
| Pipeline 502 (chat hangs, `/v1/models` red) | Tell the prospect "the answer engine is reconnecting, here's the same diagnostic on the bot" and switch to Telegram `@FactoryLMDiagnose_bot`. | 60s |

## Live monitoring (during the demo)

A cron probe on the VPS hits the critical surfaces every 5 min and pings the booth Telegram chat on non-200. See `scripts/external_probe.py`.

Surfaces being watched:
- `GET https://app.factorylm.com/v1/models`
- `GET https://app.factorylm.com/api/scanbe/healthz`
- `GET https://app.factorylm.com/feed/` (expect 200 of the login page; 5xx is the alert trigger)
- `GET https://cmms.factorylm.com/`

If Mike's phone vibrates with a "MIRA: SURFACE DOWN" message during a pitch, finish the sentence, hand the prospect the paper handout, and check the alert.

## Post-demo

- Save any Telegram-side scan/chat sessions for the morning brief.
- If Stripe live-mode bumps happened (paid signups), confirm in the dashboard before close-out.

## What's explicitly NOT in this runbook

- Stage manager / co-presenter coordination — single-operator demo by design.
- Power management — booth provides AC; both tablets carry 95%+ at start of day.
- Hardware-level scan fallback (offline nameplate OCR on-device) — out of scope for May 21.
