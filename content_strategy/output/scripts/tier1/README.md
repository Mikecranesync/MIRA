# TIER 1 YouTube Video Scripts — MIRA Content Strategy

**Status:** Ready to record
**Created:** 2026-05-30
**Source:** AI_PLC_HMI_MIRA_Content_and_Product_Strategy.md (Deliverable 2)

## Overview

These 5 scripts make up the TIER 1 video series: the highest-hook, lowest-production-cost content where proof already exists in the MIRA repo. Each video ships as:
- **60-second Short** (vertical, YouTube Shorts / social)
- **8–12 minute long-form** (horizontal, YouTube main feed)

Total reach: 5 Shorts + 5 long-form = 10 videos to publish over 5 weeks (2 Shorts/week + 1 long-form/week).

---

## File Manifest

| File | Hook | CTA | Funnel |
|------|------|-----|--------|
| `video-01-webcam-photo-to-hmi.md` | "This is a garbage webcam photo." | PDF | PDF → MIRA |
| `video-02-google-image-to-hmi.md` | "I Googled conveyor 3D image." | PDF | PDF → Workshop |
| `video-03-can-ai-build-plc-dashboard.md` | "Can AI do real industrial work? Let's test it." | PDF | PDF → MIRA |
| `video-04-maintenance-knowledge-to-hmi.md` | "Your senior tech's brain is the most valuable thing." | MIRA | MIRA (bottom-funnel) |
| `video-05-small-factory-ai-ready-interfaces.md` | "You don't need a SCADA project. You need a phone photo." | PDF + MIRA | PDF → MIRA |

---

## Format: What Each Script Contains

```markdown
# Video [N]: [Title]

## Short Script (60s)
6–8 verbatim beats, ≤25 words each.
**Beat 1 — Hook (0:00–0:08)** — must describe a machine or screen changing, NOT talking head.

## Long-Form Outline (8–12 min)
H2 sections with one-sentence descriptions.
[asset: path/to/repo/file] tags for every piece of proof.

## Thumbnail Brief
Layout description, text overlay, key visual.

## CTA
Single sentence. Exact words to say.

## Production Notes
Voice tone, banned phrases, first-3-seconds rule, assets to source.
```

---

## Key Rules Applied to Every Script

1. **First 3 seconds win or lose:** Opens on a machine or screen changing, never a talking head or logo.
2. **Proof rule:** Every factual claim cites `[asset: path/to/file]`. No claim without a repo artifact.
3. **One CTA per video:** Pick from PDF / MIRA / Workshop. Never mix.
4. **Banned phrases:** ❌ "AI-powered," "game-changing," "revolutionize," "seamless," "leverage," "synergy," "unlock," "cutting-edge."
5. **Voice:** Maintenance guy talking to maintenance guy. Short sentences. Earned credibility.
6. **Funnel discipline:** Videos 1–3 land on PDF (awareness + lead magnet). Videos 4–5 bridge to MIRA (consideration + bottom-funnel).

---

## Recording Priority

If time is limited, film these first:
1. **Video 1** (webcam photo → HMI) — highest hook, easiest to reproduce.
2. **Video 2** (Google image → HMI) — one reference image, same pipeline.
3. **Video 3** (real PLC test) — honest failure, credibility builder.

Videos 4–5 can follow once 1–3 are live and driving traffic.

---

## Asset Checklist

**Critical (must have):**
- [ ] Operator-station webcam photo (original or recreated). If lost, **retake a bad photo of a real panel** — the "bad photo" is part of the proof.
- [ ] Conveyor reference image (stock photo or real diagram).
- [ ] ConveyorStatus Perspective View screenshots (Ignition).
- [ ] Fault Detective demo screenshots.
- [ ] PLC rig photo (Micro820, GS10, motor, actual rig).
- [ ] Command Center UNS tree screenshot (showing multi-machine namespace).

**Highly recommended:**
- [ ] Screen recording of photo → prompt → JSON generation (Video 1, 2).
- [ ] Ignition tag binding table / dashboard screenshots.
- [ ] Video of a sensor triggering a fault (screen going red).
- [ ] Micro820 code snippet comparing GS1 vs GS10 register map (Video 3).
- [ ] Interview clip or Q&A with senior technician (Video 4).
- [ ] BOM spreadsheet with component prices and photos (Video 5).

**Sanitize before publishing:**
- [ ] Redact `C:\Users\hharp\...` paths from commissioning docs.
- [ ] Remove VPS/Tailscale IPs from any screenshot.
- [ ] Confirm machine photos are yours (not customer's). Blur identifying detail if unsure.
- [ ] Keep prospect CSVs and infra configs out of any published repo.

---

## Publishing Workflow (Recommended)

**Week 1:**
- Capture money shots (operator-station photo, rendered views, Fault Detective screenshots).
- Film Videos 1, 2, 3 back-to-back in one day (same setup, different assets).

**Week 2:**
- Edit + publish Short for Video 1. Post on YouTube Shorts + social.
- Announce free PDF (lead magnet) in video CTA. Point to landing page.

**Week 3:**
- Publish Short + long-form for Video 2.
- Announce "photo-to-HMI" service: "First 5 free mockups."

**Week 4:**
- Publish Short + long-form for Video 3.
- Convert warmest leads into paid gigs or $500 assessments.

**Week 5:**
- Film + publish Videos 4, 5 (MIRA-focused, bottom-funnel).

---

## Success Metrics (Per Script)

| Metric | Target (60s Short) | Target (long-form) |
|--------|-------|-------|
| Views (first 48h) | ≥500 | ≥200 |
| CTR to link | ≥5% | ≥2% |
| Lead (email capture) | ≥10 | ≥5 |
| Conversion (paid) | Measure after 2 weeks | Measure after 1 week |

---

## Notes for Recording

- **Narration style:** Record yourself talking. Don't use a voiceover artist. Your voice is the credibility.
- **B-roll:** Screen recordings, hardware photos, live demos. No stock footage or "AI" graphics.
- **Editing:** Simple cuts, minimal effects. The proof is the visual, not the production.
- **Captions:** Enabled, clean, readable. They're mandatory for social.

---

## Next Steps

1. **Locate/recreate the operator-station photo** (Video 1's money shot).
2. **Reserve a day to batch film** Videos 1, 2, 3.
3. **Schedule publishing:** 2 Shorts/week + 1 long-form/week for 5 weeks.
4. **Assign conversion:** Who answers the PDFs? Who does the mockup service? Who closes the $500 assessments?
5. **Track funnel:** spreadsheet with views → leads → conversions by video.

---

## Related Documents

- **Content Strategy (full):** AI_PLC_HMI_MIRA_Content_and_Product_Strategy.md
- **Lead Magnet Blueprint:** AI_Assisted_PLC_HMI_Learning_Guide_Outline.md (DELIVERABLE 4)
- **LinkedIn Voice Guide:** marketing/content/linkedin-series-2am-vfd-problem.md
- **Assets in Repo:**
  - Ignition views: `ignition/project/com.inductiveautomation.perspective/views/`
  - PLC code: `plc/Micro820_v4.1.9_Program.st`
  - GS10 guide: `plc/GS10_Integration_Guide.md`
  - Demo docs: `docs/conveyor-fault-detective-demo/`
  - Proof screenshots: `docs/promo-screenshots/2026-05-*.png`

---

## Questions?

Refer back to the **Content Strategy** doc (§2, TIER 1 section) for the full context on each video's purpose, assets, and funnel placement.
