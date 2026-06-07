# Publishing Checklist — AI PLC/HMI + MIRA Content Build-Out

**Generated:** 2026-05-30  
**Status:** Ready for Week 1 launch sequence  
**Owner:** Mike Harper (FactoryLM)

---

## Section A — Ready to Use Now

All files listed below are in the repository and ready to publish. No edits needed.

| File Path | What It Is | How to Use |
|---|---|---|
| `content_strategy/output/LEARNING_GUIDE_DRAFT.md` | 8,600-word PDF draft (22–30 pages typeset), 19 chapters + 3 appendices | Hand to designer for typesetting in Typst/InDesign. Insert figures from FIGURE_MAP before final. Use as-is for content; figures are listed but not embedded. |
| `content_strategy/output/scripts/tier1/video-01-webcam-photo-to-hmi.md` | Short + long-form scripts for Video 1 ("I turned a bad webcam photo into a working HMI") | Read short script verbatim for 60-second YouTube short. Use outline for long-form (15–20 min) recording. Both assume PMC Station BEFORE/AFTER photos (see Section B). |
| `content_strategy/output/scripts/tier1/video-02-google-image-to-hmi.md` | Scripts for Video 2 (stock image → HMI pipeline demo) | Short + long-form. Uses stock conveyor reference image (see Section B item 3). |
| `content_strategy/output/scripts/tier1/video-03-can-ai-build-plc-dashboard.md` | Video 3: "Can AI Build Your PLC Dashboard in 10 Minutes?" | Tier 1; ready now. No blocking dependencies on missing assets. |
| `content_strategy/output/scripts/tier1/video-04-maintenance-knowledge-to-hmi.md` | Video 4: turning maintenance knowledge into an HMI | Tier 1; ready now. |
| `content_strategy/output/scripts/tier1/video-05-small-factory-ai-ready-interfaces.md` | Video 5: "Small factory + AI-ready interfaces = what's possible?" | Tier 1; ready now. |
| `content_strategy/output/scripts/tier2/video-06-ai-programmed-micro820.md` | Video 6: "I let AI program my Allen-Bradley Micro820" | Requires Micro820 ST editor screenshot (see Section B item 5). |
| `content_strategy/output/scripts/tier2/video-07-modbus-rtu-vfd-explained.md` | Video 7: "Modbus RTU to a VFD, explained by someone who just learned it" | Requires GS10 VFD config screenshot (see Section B item 4). |
| `content_strategy/output/scripts/tier2/video-08-register-map-cost-me-days.md` | Video 8: "A bad register map cost me 3 days" | Tier 2; ready now. |
| `content_strategy/output/scripts/tier2/video-09-ai-agent-near-live-plc.md` | Video 9: "AI agent running near a live PLC" | Tier 2; ready now. |
| `content_strategy/output/scripts/tier2/video-10-readonly-can-stop-motor.md` | Video 10: "Why read-only mode can still stop your motor" | Tier 2; ready now. |
| `content_strategy/output/scripts/tier2/video-11-ccw-where-ai-hits-wall.md` | Video 11: "Connected Components Workbench — where AI hits the wall" | Tier 2; ready now. |
| `content_strategy/output/scripts/tier2/video-12-ai-reads-schematic-photo.md` | Video 12: "AI reads a schematic photo and knows what it means" | Tier 2; ready now. |
| `content_strategy/output/scripts/tier3/video-13-ask-the-conveyor-what-happened.md` | Video 13: "Ask the conveyor what happened" (MIRA on live production) | Tier 3; ready now. Shown in live Command Center screenshots. |
| `content_strategy/output/scripts/tier3/video-14-why-generic-ai-hallucinates-on-your-machines.md` | Video 14: "Why generic AI hallucinates on your machines" | Tier 3; ready now. |
| `content_strategy/output/scripts/tier3/video-15-the-8400-fault-code.md` | Video 15: "The $8,400 fault code" | Tier 3; ready now. |
| `content_strategy/output/scripts/tier3/video-16-one-machine-photo-to-structured-plant.md` | Video 16: "One machine photo → structured plant namespace" | Tier 3; ready now. |
| `content_strategy/output/scripts/tier3/video-17-qr-code-on-machine-ai-knew-what-it-was.md` | Video 17: "QR code on a machine — AI knew what it was" | Tier 3; ready now. |
| `content_strategy/output/scripts/tier4/video-18-ai-transcribed-handwritten-marker-text.md` | Video 18: "AI transcribed handwritten marker text on my motor" | Tier 4; ready now. |
| `content_strategy/output/scripts/tier4/video-19-bad-photo-good-hmi.md` | Video 19: "Bad photo + good AI = HMI that works" | Tier 4; ready now. |
| `content_strategy/output/scripts/tier4/video-20-three-things-ai-got-wrong.md` | Video 20: "Three things AI got wrong (and why)" | Tier 4; ready now. |
| `content_strategy/output/scripts/tier4/video-21-cheapest-way-to-learn-plcs-and-ai.md` | Video 21: "Cheapest way to learn PLCs and AI at the same time" | Tier 4; ready now. |
| `content_strategy/output/scripts/tier4/video-22-maintenance-guy-not-programmer-shipped-this.md` | Video 22: "Maintenance guy, not programmer. Shipped this." | Tier 4; ready now. Autobiographical closer. |
| `content_strategy/output/landing-page-pdf-capture.md` | Email capture page (free PDF incentive) | Copy into Carrd / Webflow / your existing funnel. Customize call-to-action and link to hosted PDF. |
| `content_strategy/output/service-offer-machine-photo-hmi.md` | Service offer landing: "First 5 machine photo → HMI mockups free" | Post to Notion / Canva or integrate into factorylm.com. Drives leads to $500 assessment. |
| `content_strategy/public-assets/PLC_BRINGUP_PROMPT_public.md` | Sanitized PLC bringup guide (25 redactions: LAN IPs, Windows paths, user home dirs removed) | Reference doc for technicians setting up a Micro820. Windows path placeholders (`$REPO/`, `$CCW_PROJECT/`) already applied. Safe for public distribution. |
| `content_strategy/public-assets/RESUME_VFD_COMMISSIONING_public.md` | Sanitized VFD resume guide (2 redactions applied) | Reference doc for VFD commissioning. Safe for public distribution. |
| `content_strategy/public-assets/ASSET_INVENTORY.md` | Audit of all Ignition Perspective Views, machine photos, and PDF figures | Status report — what's ready, what's missing, provenance check on all machine photos. |
| `docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png` | Fault Detective diagnosis screen (Ch. 11/14 of PDF) | Ready now. High-quality live screenshot of the diagnostic chat interface. |
| `docs/promo-screenshots/2026-05-27_fault-detective-f2-blown_desktop.png` | Live PLC fault state F2 blown indicator (Ch. 11 of PDF) | Ready now. Shows real PLC tag integration. |
| `docs/promo-screenshots/2026-05-28_fault-detective-with-plc-io_desktop.png` | Live PLC I/O overlay in Fault Detective (Ch. 11 of PDF) | Ready now. Demonstrates source-selection UI. |
| `docs/promo-screenshots/2026-05-30_command-center-LIVE-watching-nodered_desktop.png` | Command Center UNS tree (live, watching Node-RED) (Ch. 13 of PDF) | Ready now. Latest capture, shows nested namespace structure. |
| `mira-core/data/photos/Analyze/20260422T093528.jpg` | Physical garage rig (PLC + VFD + motor) (Ch. 2 of PDF) | Highest resolution (168 KB) from the April 22 rig session. Use for "Hardware Stack" chapter. Provenance verified: Mike's garage equipment. |

---

## Section B — Mike Must Capture Before Publishing

Complete these tasks in order. Without them, the PDF and Video 1 launch will lack visual proof. Total time: ~60–75 minutes.

### 1. PMC Station BEFORE Photo — ✅ CAPTURED 2026-05-31 (Ch. 10, Video 1 Hook)

> **DONE.** Mike captured this via Photo Booth on 2026-05-31. Archived to
> `docs/promo-screenshots/2026-05-31_pmc-station-before-real-bench_photo.jpg`
> (real bench: Micro 820 PLC, GS10 VFD @ F 300.0, multimeter, handwritten
> "PMC Station" pushbutton panel). Already used as the opening "before" frame
> of **Video 16** (`marketing/videos/2026-05-31-phase5-demos/video-16-photo-to-plant`).
> Landscape, not portrait, but reads the label clearly — good enough for the hook.

**What:** A poor-quality, off-angle photo of the physical garage control panel with a visible "PMC Station" label.

**Why it matters:** This is the #1 money shot. Video 1's entire hook ("I turned a bad webcam photo into a working HMI") collapses without the before-and-after visual proof. Chapter 10 also needs this transformation story.

**How to capture:**
- Take a fresh phone/webcam shot of the actual garage panel **right now**.
- Angle: ~45° off-center, slightly blurry, some glare acceptable (proves it's a "bad" photo).
- Must include: a visible label on the panel — handwritten "PMC Station" or printed nameplate.
- Portrait orientation preferred (mobile-friendly).
- Good lighting is NOT required — the worse it looks, the better the "before" story.

**Time:** 10 minutes

**Save as:** `docs/promo-screenshots/2026-05-30_pmc-station-before-original-webcam_portrait.jpg`

---

### 2. PMC Station AFTER — Generated HMI Screenshot — ⚠️ LIKELY SATISFIED, verify provenance (Ch. 10, Video 1 Payoff)

> **Candidate exists:** `docs/promo-screenshots/2026-05-31_command-center-ConvSimpleLive-LIVE-framed_desktop.png`
> is a **live** Ignition Perspective View titled "PMC STATION" with the same
> colored pushbuttons as the BEFORE photo, bound to real Micro 820 / MIRA_PLC
> (CIP) tags. Visually it IS the after-shot. **Open question (blocks Video 1 &
> Video 2 truthfulness):** was ConvSimpleLive *generated from* the BEFORE photo
> via the photo→HMI pipeline, or hand-wired? The commits say "repoint Command
> Center to Ignition ConvSimpleLive" (wiring), not photo-generated. Confirm the
> provenance before narrating "AI built this from the photo."

**What:** Screenshot of the AI-generated Ignition Perspective View that resulted from the BEFORE photo.

**Why it matters:** The visual payoff. Without this, the transformation story has no ending.

**How to capture:**
1. Run the BEFORE photo through the photo→HMI generation pipeline (or use an existing demo output).
2. Generate the Ignition Perspective View JSON.
3. Open in Ignition Designer preview (or live session).
4. Screenshot at high DPI (1920x1080 minimum), desktop layout.
5. Include labeled buttons, status indicators, and any dynamic PLC data if running live.

**Time:** 15–20 minutes (assumes pipeline + Ignition are running)

**Save as:** `docs/promo-screenshots/2026-05-30_pmc-station-after-hmi-generated_desktop.png`

---

### 3. Stock Conveyor Reference Image — ✅ CAPTURED (Ch. 11, Video 2)

> **DONE.** Recovered from PLC laptop (`Conveyor example.PNG`) → archived
> `docs/promo-screenshots/2026-05-30_conveyor-reference-stock-render_input.png`
> (clean green-belt 3D conveyor render). It is the verified INPUT for **Video 2**,
> which matches it to the live GARAGE CONVEYOR HMI built from it.

**What:** A clean 3D or isometric illustration of an industrial conveyor belt.

**Why it matters:** Proves the pipeline isn't limited to custom photos — any reference image works. Demonstrates the photo→diagram conversion in Chapter 11.

**How to capture:**
- Google "industrial conveyor system 3D image" or "conveyor belt illustration".
- Find a clean, generic, top-down or isometric view (no branded logos).
- Screenshot or snip it.
- Resolution: 1200x800 or larger.

**Time:** 5 minutes

**Save as:** `docs/promo-screenshots/2026-05-30_stock-conveyor-reference_desktop.jpg`

---

### 4. ConveyorStatus Perspective View — ✅ CAPTURED (Ch. 12 of PDF)

> **DONE.** Recovered from PLC laptop (`CapturePEO1.PNG`) → archived
> `docs/promo-screenshots/2026-05-31_convsimplelive-conveyor-hmi-native_desktop.png`
> — the live ConvSimpleLive "GARAGE CONVEYOR" view: photo-eye states (PE-01
> BLOCKED), motor/VFD readout, status bar (E-STOP ARMED, MLC CLOSED, COMM OK), on
> live Micro 820 / MIRA_PLC (CIP) tags. The 5:47 walkthrough recording shows it
> with ASK MIRA diagnosing live (PowerFlex 525 / ABB citations).

**What:** Live screenshot of the Ignition ConveyorStatus Perspective View with active sensor data.

**Why it matters:** Chapter 12 explicitly requires a visual of the rendered HMI in action — not a mockup, a real live screen.

**How to capture:**
1. Open Ignition Designer or Ignition Gateway.
2. Load the ConveyorStatus Perspective View (location: `ignition/project/com.inductiveautomation.perspective/views/ConveyorStatus/resource.json`).
3. Run the demo/rig to push live sensor updates (speed, motor state, fault indicators).
4. Screenshot in Preview mode or live session.
5. High DPI (1920x1080 minimum), desktop layout.

**Time:** 15 minutes (assumes Ignition + PLC connection are ready)

**Save as:** `docs/promo-screenshots/2026-05-30_conveyor-status-live_desktop.png`

---

### 5. GS10 VFD Configuration Screenshot (Ch. 7, Video 7)

**What:** Screenshot of the GS10 VFD commissioning interface (register map, Modbus RTU config, or command-word setup).

**Why it matters:** Video 7 ("Modbus RTU to a VFD, explained") needs this as a reference.

**How to capture:**
- If using Connected Components Workbench (CCW): open the GS10 device dialog, screenshot the register configuration.
- Alternatively: capture the terminal output or web interface where Modbus register config is visible.
- Include: at least 3 registers visible, showing address + value + description.

**Time:** 20 minutes (assumes CCW + VFD commissioning project are accessible)

**Save as:** `docs/promo-screenshots/2026-05-30_gs10-vfd-modbus-config-screen_desktop.png`

---

### 6. Micro820 ST Program Editor — Code Screenshot (Ch. 6, Video 6)

**What:** Screenshot of the Micro820 program (ST language) in Connected Components Workbench.

**Why it matters:** Video 6 ("I let AI program my Micro820") needs visual proof of the actual program.

**How to capture:**
1. Open Connected Components Workbench.
2. Load `plc/Micro820_v4.1.9_Program.st` (or latest).
3. Screenshot the state machine section or main run logic.
4. High DPI (1920x1080 minimum).

**Time:** 10 minutes

**Save as:** `docs/promo-screenshots/2026-05-30_micro820-st-program-editor_desktop.png`

---

## Section C — Do NOT Publish

The following files contain sensitive data and must NEVER be shared publicly:

| File / Directory | Why | What to Do |
|---|---|---|
| `.claude/`, `.claude/rules/`, `.claude/skills/` | Contains VPS IP (165.245.138.91), Tailscale IPs, node hostnames, Doppler config refs, deploy internals | Remove from any exported content |
| `docker-compose*.yml`, `nginx-*.conf`, `deployment/`, `infra/`, `.github/workflows/` | Infrastructure topology — security risk if public | Do not share |
| `STRATEGY.md`, `NORTH_STAR.md`, `Mira-BizDev/` | Pricing logic, competitive positioning, GTM strategy (proprietary) | Internal only |
| `marketing/prospects/*.csv` | PII — prospect names, email, contact details | Delete or keep private |
| `docs/THEORY_OF_OPERATIONS.md` (full version) | VPS deployment, inference routes, secret references | If publishing, redact Doppler/env references |
| `plc/RESUME_VFD_COMMISSIONING.md` (original) | Windows paths + LAN IPs — use `_public.md` instead (already redacted) | Use public version only |
| `plc/PLC_BRINGUP_PROMPT.md` (original) | Same — use public version (`PLC_BRINGUP_PROMPT_public.md`) | Use public version only |
| `mira-core/data/photos/Tell/20260514T031119.jpg` | Unknown provenance — visual inspection required | Inspect before any use; likely internal test photo |

---

## Section D — Week 1 Launch Sequence

Execute in this order. Each step unlocks the next.

### Day 1 — Capture the money shots (morning)

**What:** Complete Section B items 1–3. These are the visual proof for Video 1 + Chapter 10.

**Tasks:**
- [ ] Capture PMC Station BEFORE photo (10 min)
- [ ] Generate PMC Station AFTER HMI and screenshot (20 min)
- [ ] Download stock conveyor reference image (5 min)

**Blockers:** None — you control this.

**Time:** ~35 minutes

**Deliverable:** 3 new PNG/JPG files in `docs/promo-screenshots/`

---

### Day 1–2 — Get the PDF typeset

**What:** Convert `LEARNING_GUIDE_DRAFT.md` into a formatted PDF with embedded figures.

**How:**
- Option A: Hand to a designer (Canva, InDesign, or dedicated typist). Give them FIGURE_MAP.md as a guide to placement.
- Option B: Use Pandoc + a template to export as PDF. Example: `pandoc LEARNING_GUIDE_DRAFT.md --template eisvogel -o LEARNING_GUIDE.pdf`.
- Option C: Upload to Canva → format → export as PDF.

**Figures to insert (from Section A):**
- 4 ready-now screenshots (Fault Detective, Command Center, etc.) — copy from `docs/promo-screenshots/`
- 1 rig photo (April 22) — from `mira-core/data/photos/Analyze/20260422T093528.jpg`
- 3 new photos (Day 1 captures above) — PMC before/after + conveyor reference

**Time:** 2–4 hours (depends on designer availability)

**Deliverable:** `LEARNING_GUIDE_PDF_FINAL.pdf` ready to host

---

### Day 2 — Stand up the email capture page

**What:** Deploy the free-PDF lead-capture landing page.

**How:**
1. Copy `landing-page-pdf-capture.md` into your funnel tool (Carrd, Webflow, Notion).
2. Update: email subject, call-to-action button text, and PDF download link (point to hosted PDF from Day 1–2).
3. Test: submit a fake email, verify PDF downloads.
4. Publish to a live URL (e.g., `factorylm.com/free-guide` or `free-plc-hmi-guide.carrd.co`).

**Time:** 1 hour

**Deliverable:** Live landing page with working PDF download link

---

### Day 3 — Launch LinkedIn announcement

**What:** Announce the guide + before/after service.

**How:**
1. Reuse the voice from `marketing/content/linkedin-series-2am-vfd-problem.md` (2 AM tone — direct, practical, founder voice).
2. Single post: "I built a free guide. Here's what it covers. [Link to landing page]"
3. Attach the before/after image pair: PMC Station BEFORE + PMC Station AFTER (stacked or side-by-side).
4. Comment with the service offer link: "First 5 machine photo → HMI mockups free. Reply here if interested."

**Supporting assets:**
- Image: PMC before/after split
- Link: landing page URL
- CTA: "Free guide" link in post, service offer in first comment

**Time:** 30 minutes

**Deliverable:** Published LinkedIn post + comments

---

### Day 3–4 — Open the "Machine Photo → HMI Mockup" service

**What:** Deploy the service offer landing page.

**How:**
1. Copy `service-offer-machine-photo-hmi.md` into Notion / Canva / a standalone page.
2. Add: payment link (if charging; or "email to apply for free tier").
3. Post to LinkedIn comments (Day 3) + include link in landing page footer.
4. Set expectation: "Reply with a photo of your panel, get a mockup back in 48 hours."

**Time:** 45 minutes

**Deliverable:** Live service landing page

---

### Day 4–5 — Record and upload Video 1 (60-second Short)

**What:** Produce the hero short video using the Day 1 captures.

**How:**
1. Use script from `content_strategy/output/scripts/tier1/video-01-webcam-photo-to-hmi.md` (short version).
2. Shots: (a) PMC BEFORE photo on screen, (b) you talking ("I took this bad photo…"), (c) PMC AFTER HMI on screen, (d) you talking ("…and turned it into a working HMI in 10 minutes").
3. Music: royalty-free industrial / tech background (Epidemic Sound, Artlist, or YouTube Audio Library).
4. Duration: 60 seconds.
5. Title card: "I turned a bad webcam photo into a working HMI" (or similar).
6. End card: landing page URL + CTA.

**Time:** 1–2 hours (filming + editing)

**Deliverable:** `video-01-short.mp4` ready for YouTube Shorts / TikTok / Instagram Reels

**Upload to:**
- YouTube Shorts (with link to landing page in description)
- TikTok (with link in profile)
- Instagram Reels (with link in comments)

---

### Day 5–6 — Record Videos 2 and 13 (supplementary)

**What:** Produce two additional tier videos while the rig is set up.

**Why:** These leverage the same captures (stock conveyor + live ConveyorStatus). Film them back-to-back.

**Video 2 ("Google image → HMI"):**
- Script: `video-02-google-image-to-hmi.md`
- Footage: stock conveyor image (Day 1 capture) → AI pipeline → rendered HMI
- Duration: 60 seconds (short) or 10 minutes (long-form)

**Video 13 ("Ask the conveyor what happened"):**
- Script: `video-13-ask-the-conveyor-what-happened.md`
- Footage: live Command Center (2026-05-30_command-center-LIVE-watching-nodered_desktop.png) + live chat with MIRA + fault diagnosis
- Duration: 60 seconds (short) or 8 minutes (long-form)

**Time:** 1.5–2 hours total (both videos)

**Deliverable:** 2 edited videos ready for upload

---

### Day 6–7 — Review early conversion and iterate

**What:** Check who downloaded the PDF, who replied to the LinkedIn post, who requested a mockup.

**How:**
1. Email: check signup list for landing page. Email each person: "Here's your free guide. Here's a $500 assessment offer if you want deeper help."
2. LinkedIn: reply to all comments. For genuine inquiries: offer a free mockup (first 5) or schedule a call.
3. Mockups: for each request, run the photo through the pipeline and send within 48 hours.
4. Conversions: anyone who replies → try to convert to $500 assessment call.

**Time:** 1–2 hours

**Deliverable:** First week's conversion data + follow-up emails sent

---

## Section E — Optional: Video 7 & 8 (Deeper Technical Content)

These require captures from Section B items 4–5 (VFD config + PLC editor). Only film if you have 1–2 extra hours.

| Video | Script | Requires | Duration | Priority |
|---|---|---|---|---|
| Video 6 | `video-06-ai-programmed-micro820.md` | Micro820 editor screenshot (Section B item 6) | 10–15 min | Medium (tech credibility) |
| Video 7 | `video-07-modbus-rtu-vfd-explained.md` | GS10 VFD config screenshot (Section B item 4) | 12–15 min | Medium (technical depth) |

If you complete these before Day 7, they add credibility to the "I understand this hardware" brand. If not, skip them for now — Video 1–5 and 13 are sufficient for Week 1 launch.

---

## Section F — Background: Demo Video Renders (Coming Soon)

The `promo-director` pipeline is rendering 3 supplementary demo MP4s (Phase 5). They will land in `marketing/videos/` when complete. These are **supplementary to Week 1 launch** — you can launch and add these later as they finish rendering.

Track status via:
```bash
ls -lh marketing/videos/ | grep 2026-05
```

---

## Section G — Sanity Checks Before Publishing

Before pressing "publish," verify:

- [ ] All PNG/JPG figures are **high DPI** (1920x1080 minimum for screenshots; 1200x800+ for images)
- [ ] All figures follow naming convention: `YYYY-MM-DD_description_layout.format` (e.g., `2026-05-30_pmc-station-before-original-webcam_portrait.jpg`)
- [ ] All figures are in `/docs/promo-screenshots/` (centralized; easier for designers)
- [ ] PDF includes all 7–10 figures (4 ready + 3 new from Section B)
- [ ] Landing page link is live and PDF downloads
- [ ] Video 1 is uploaded to YouTube Shorts with description link
- [ ] LinkedIn post includes before/after image pair and landing page URL
- [ ] Service offer page is live and linked from LinkedIn comments
- [ ] Tell/ folder photo (`mira-core/data/photos/Tell/20260514T031119.jpg`) has NOT been used anywhere (verify visually before any publication)

---

## Summary: What You're Shipping

| Artifact | Type | Status | Use Case |
|---|---|---|---|
| LEARNING_GUIDE.pdf | Educational | Ready after Day 2 typeset | Free lead magnet; email capture |
| Video 1 (60 sec) | Short-form | Ready Day 4 | YouTube Shorts / TikTok / Reels hero content |
| Landing page | Web | Ready Day 2 | Free PDF + email capture funnel |
| Service offer page | Web | Ready Day 3 | "5 free mockups" lead generator |
| LinkedIn post | Social | Ready Day 3 | Announcement + traffic to landing page |
| Scripts (22 videos) | Outline | Ready now | Ammunition for future recording |

**Week 1 revenue goal:** First 5 free mockups convert to $500 MIRA assessment calls (1–2 closes = $500–$1k pipeline opener).

---

## Questions?

This checklist is comprehensive but executable. All capture tasks can be done solo in ~75 minutes total. The PDF typeset is the longest blocking task (2–4 hours, designer-dependent). Everything else is parallel.

**Start with Section B items 1–3 this morning.** The rest unlocks automatically.
