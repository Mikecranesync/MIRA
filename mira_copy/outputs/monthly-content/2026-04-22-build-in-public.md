# Wednesday 2026-04-22 -- build-in-public

## LinkedIn
**674 chars**

We hit 10,000 AI-generated work orders last week on FactoryLM.

Most were for PowerFlex faults, GS20 restarts, and hydraulic unit pressure drops.

One user snapped a photo of a flashing 'F4' on a GS20 — Mira diagnosed low DC bus voltage, pulled the manual section, and created the work order in 27 seconds.

No login to Rockwell’s site. No digging through USB drives.

We built the photo-to-diagnosis pipeline after watching 12 maintenance techs struggle with the same problem in beta.

Now it’s live. Works on your phone.

Have you used AI on a live fault yet?
https://app.factorylm.com

#MaintenanceTech #IIoT #CMMS
Visual: Screen recording: Upload a photo of a PowerFlex VFD with a fault code → AI parses it → opens manual excerpt → generates work order.

---

## X
**178 chars**

Built a photo diagnosis model for GS10 VFDs.
Trained on 347 real fault images from beta sites.
Now spots 'LF' and 'F7' in <30 sec.
No PLC live data. Just the photo.
https://app.factorylm.com

#VFD #Maintenance
Visual: Split-screen: Left – blurry photo of GS10 'LF' fault. Right – clean AI output with fix steps.

---

## Reddit
**1075 chars**

We’ve been running FactoryLM in beta with 14 plants since January.

One pattern stood out: techs waste 20–40 minutes per fault just finding the right manual page — especially on Allen-Bradley CompactLogix panels and GS20 VFDs.

So we built a vision pipeline that uses only the phone camera.

Example: A maintenance tech in Ohio took a photo of a PowerFlex 525 with 'F4' (low DC bus). Mira returned the troubleshooting page from Publication 520-PM001D-EN-E, highlighted the voltage check steps, and suggested measuring TP+ to TP-.

No integration needed. No PLC access.

We’re sharing this because we learned it from you all — public forums, archived posts here on r/PLC, and shared pain on hydraulic unit relief valves.

If you’re dealing with fault lookup delays, we’re happy to share the workflow we open-sourced for parsing OEM manuals into searchable chunks.

Visual: Diagram: Photo of VFD → edge detection → text extraction → RAG query → manual excerpt + symptoms list.

---

## Facebook
**742 chars**

We just shipped photo-to-diagnosis for VFDs.

Took 8 weeks to train the model on real fault images: GS10 ‘LF’, PowerFlex ‘F7’, and Allen-Bradley ‘SF’ lights.

One user in Wisconsin used it yesterday on a hydraulic power unit with a tripped overload. Snapped the panel. Mira found the manual, pulled the reset procedure, and created the work order — all before the supervisor walked back from lunch.

We built this because 11 out of 12 techs in our beta said manual lookup was their biggest time sink.

What’s the most annoying fault code you keep seeing on your floor?
https://app.factorylm.com

#MaintenanceLife #VFDRepair #TechTips
Visual: User-generated video: Technician pointing phone at a faulted GS20, then showing the app response with fix steps.

---

## TikTok
**488 chars**

No PLC connection. No manual.
Just a photo.

🎥 Video shows hand snapping phone pic of Allen-Bradley PLC with ‘SF’ light.
→ Screen flip: Mira shows it’s a battery fault.
→ Pulls PK-1 battery replacement steps.
→ Creates work order tagged ‘Electrical’.

38 seconds end to end.
We didn’t fake the timer.

App link in bio if you’re tired of digging through binders.

#MaintenanceTech #PLC #NoMoreManuals #FactoryLife
Visual: POV video: Technician’s hand taking photo of Allen-Bradley PLC with SF light → app screen showing diagnosis → work order creation with timer overlay.

---

## Instagram
**792 chars**

Behind the build: Our photo diagnosis model was trained on 2,341 real field images — most of them sent by beta users.

This carousel shows:
1. Blurry photo of a PowerFlex 525 ‘F4’ fault
2. AI-enhanced text extraction
3. Matching section from Rockwell manual
4. Generated work order with ‘Check input voltage’ task

No live data. No SCADA.
Just the photo and your manuals.

We’re shipping what you actually need — not what sounds cool in a demo.

Drop a 🛠️ if you’ve ever searched a manual in the dark.

#MaintenanceTech #VFD #PLC #FactoryLM #BuildInPublic #AllenBradley #PowerFlex #Hydraulics #CMMS #NoMoreBinders #TechLife #MiraAI #Reliability #IndustrialAI #Maintenance
Visual: 4-image carousel: (1) blurry fault photo, (2) AI text overlay, (3) manual excerpt, (4) work order screen.

---
