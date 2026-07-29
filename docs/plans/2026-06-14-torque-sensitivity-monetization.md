# GS10 Torque-Sensitivity Test → How MIRA Monetizes It

**Status:** EVALUATION + MONETIZATION PLAN
**Authored:** 2026-06-14
**Owner:** Mike Harper
**Source data:** `mira-trend-2026-06-14T11-56-28-904Z.csv` (MIRA · Ignition Live Trends export, GS10 — Conv_Simple Drive, 1 s refresh, ~3.5 min)
**Asset chart:** `docs/promo-screenshots/2026-06-14_gs10-torque-sensitivity-hand-on-belt.png`

---

## TL;DR

You ran a conveyor at a steady ~30 Hz and put your **hand on the belt** a few times. The drive's **speed barely moved** (±0.8%) but its **torque estimate swung ~30 percentage points** — and every touch shows up as a clean, distinct bump above a quiet baseline. No torque sensor, no load cell, no new hardware: just the GS10's own torque estimate, streamed and exported by MIRA.

That is a **sensorless load/condition-monitoring sensor you already have on every VFD-driven motor in a plant.** The money is selling that as a per-asset monitoring + anomaly-alert + AI-diagnosis subscription with near-zero hardware cost.

## 1. What the test actually proves (the numbers)

| Metric | Value | Why it matters |
|---|---|---|
| Run window | 11:53:10 → 11:56:19 (~3 min steady) | enough to characterize baseline + events |
| Speed during run | 878.7 rpm mean, **±0.8%** (std 6.8) | **speed is essentially constant** |
| Frequency | ~30.5 Hz | drive holding setpoint |
| Torque baseline (unloaded) | **≈ 67–68%** | the quiet floor |
| Torque peak (hand on belt) | **93.9%** | a *hand* did that |
| Torque swing | **64.6% → 93.9% = 29.3 pts** | huge signal vs a tiny disturbance |
| Distinct load events | **~5** clean bumps in 3 min | repeatable, not noise |
| Baseline noise | a few points | event deltas of 15–26 pts → **high signal-to-noise** |
| Power (kW) channel | ~0.01, flat | **too coarse to see the hand — torque % is the sensitive channel** |

**The key physics:** the VFD is holding speed and **varying torque to compensate the added drag**. So torque% behaves as a live load sensor. Speed-vs-torque correlation during the run is low (~0.35) — i.e. the signal is *load*, not *speed*. A human hand adds only a few newtons of friction, and it's unmistakable in the data. If a hand is visible, so is a jam, a pile-up, a seizing roller, a tightening/again-slack belt, material build-up, a dragging bearing, or an under/over-loaded motor.

## 2. Why this is worth money

Condition monitoring normally means **buying and installing sensors** (vibration pucks, current clamps, torque transducers) on every machine — capital cost, wiring, commissioning. This test shows MIRA can deliver a usable condition signal from **hardware the customer already owns** (their VFD) over a connection you already built (Ignition → `mira-relay` → MIRA). That collapses the cost of monitoring to ~software, which is the whole margin story.

You're not selling "a torque chart." You're selling **"we'll tell you when a motor is working harder than it should — before it fails or stops the line — without you installing anything."**

## 3. The product: **MIRA Load Watch**

A per-asset monitoring tier that sits on the MIRA data foundation:

1. **Baseline** the normal torque signature per asset (per UNS path / component profile), per operating state.
2. **Watch** the live torque (and power, speed, frequency) against that baseline.
3. **Alert** on deviation: sustained over-torque (drag/jam), under-torque (slip/lost load/broken coupling), rising trend (wear), or abnormal variability.
4. **Diagnose** with the existing grounded copilot: an alert opens an Ask MIRA session **already certified to that asset** (direct-connection UNS surface) that explains the likely cause from the manual + work-order history + the live signal, and can auto-draft a CMMS work order in Atlas.

Tiered so you can land cheap and expand:

| Tier | What they get | Sell motion |
|---|---|---|
| **Monitor** | Live trends + history + CSV export (what the screenshot shows) | free / land tier in the PLG funnel |
| **Alert** | Per-asset baseline + anomaly alerts (Slack/Telegram/email) | first paid seat |
| **Diagnose** | Alert → grounded RCA + auto work order | core upsell |
| **Predict** | Trend-to-failure, maintenance scheduling | premium / expansion |

## 4. Monetization model

- **Unit:** price **per monitored drive/motor per month.** Every VFD is a billable asset with zero hardware to ship.
- **Illustrative pricing** (validate against willingness-to-pay — not financial advice): Monitor free, **Alert ~$15–40/drive/mo**, **Diagnose ~$50–100/drive/mo**, Predict higher. A single line might have 10–30 drives; a mid-size plant **hundreds**. 200 drives × $50 = ~$120k ARR from one site, and it's land-and-expand from a handful of drives.
- **Margin:** COGS ≈ the cheap inference cascade (Groq → Cerebras → Gemini, free-tier) + storage. No sensor BOM. High gross margin by construction.
- **Moat / lock-in:** every monitored asset enriches the customer's UNS + knowledge graph and pushes their **readiness level** up (the Hub's L5→L6 flywheel). The longer they run, the better the baselines and the higher the switching cost. This is the same "data foundation → agents" wedge Cognite sells — but you give the monitoring away to win the foundation, then charge for the diagnosis.

## 5. How it plugs into what you already have

- **Pipe:** Ignition → `mira-relay` / `mira-bridge` (Sparkplug/MQTT) is already the live-tag path; it's a **direct-connection UNS-certified** surface, so an alert can jump straight to a grounded diagnosis with no confirmation gate.
- **Storage (the one real dependency):** this makes the **time-series persistence gap (G5)** from `docs/plans/2026-06-14-cdf-architecture-completeness-gap-check.md` a **build, not a maybe** — you must persist per-asset torque history to baseline and detect anomalies. Pair it with the **raw-landing/replayable-transform (G1)** so baselines can be recomputed as the logic improves.
- **Per-asset normal signature:** lives in **component profiles** (per-instance baseline; per-model template reused across customers — a resellable asset).
- **Contextualization:** the **entity matcher** (`docs/plans/2026-06-14-cognite-contextualization-replication-plan.md`) links the GS10's tags to the right asset/component so the baseline attaches to the right place in the UNS.
- **Copilot:** the Supervisor engine already grounds + cites; Load Watch just gives it a new, high-value trigger (a torque anomaly) and a new evidence source (the live trend).

In short: Load Watch is the **revenue use-case that justifies finishing the data foundation** the last two plans described. It ties all three together.

## 6. The demo IS the sales weapon

The hand-on-belt is a 30-second, visceral, impossible-to-misunderstand close:

> "Watch the screen. I'll put my hand on the belt. See that jump? MIRA felt a *hand*. Now imagine that's a bag jam, a worn bearing, or a motor about to trip — at 3 a.m., with nobody watching. MIRA catches it, tells your tech what it is, and writes the work order. No sensors installed."

Use it everywhere: the live sales demo, the PLG landing page, and the YouTube/promo pipeline (`tools/seedance-video-gen.py`). The annotated chart in `docs/promo-screenshots/` is a ready-made asset; the flat speed line over the dancing torque line is the proof in one image.

## 7. Honest limits (so you position it credibly, not over-claim)

- **It's the drive's *estimate*, not a calibrated transducer.** Sell **relative / trend / anomaly** monitoring, not lab-grade absolute torque. That's exactly what condition monitoring needs, so it's fine — just don't market "certified torque measurement."
- **This was a tiny bench motor** (~0.01 kW; baseline reads high at ~68% because the rating is small). Validate magnitudes on real equipment — but on bigger motors the unloaded baseline is *lower* and the headroom is *bigger*, so real anomalies are typically **easier** to see, not harder.
- **1 s sampling catches mechanical/load events** (jams, drag, wear trends). It is **not** full Motor Current Signature Analysis — fast electrical fault signatures (broken rotor bars, specific bearing fault frequencies) need high-rate current capture. Make that a **future premium tier**, don't imply it now.
- **Not a safety device.** Condition/asset-health only; never market it as machine guarding or e-stop.

## 8. Next steps

1. **Decide G5 (persist time-series)** — required for baselining. Smallest version: store torque/power/speed/freq per asset with retention. (See gap-check §3, §8.)
2. **Baseline + anomaly rule v1** — per-asset rolling baseline + over/under/trend alert. Plain Python, no framework.
3. **Wire one alert → Ask MIRA grounded RCA → Atlas work order** end-to-end on the bench GS10 as the reference demo.
4. **Package Monitor/Alert/Diagnose tiers** in `mira-web` (Stripe is already there).
5. **Cut the demo video** from this exact test for the funnel.
6. **Validate on a real (non-bench) motor** before quoting sensitivity numbers to customers.

---

## Data & assets
- Source: `mira-trend-2026-06-14T11-56-28-904Z.csv` (GS10 — Conv_Simple Drive; 218 samples @ 1 s)
- Verified stats: speed ±0.8% during run; torque 64.6%→93.9% (29.3 pt swing); ~5 hand events; power channel too coarse to register the load (torque % is the sensitive signal)
- Chart: `docs/promo-screenshots/2026-06-14_gs10-torque-sensitivity-hand-on-belt.png`
- Related plans: `docs/plans/2026-06-14-cdf-architecture-completeness-gap-check.md` (G5/G1 foundation), `docs/plans/2026-06-14-cognite-contextualization-replication-plan.md` (matcher attaches baseline to asset)
