# Tuesday 2026-04-28 -- build-in-public

## LinkedIn
**678 chars**

Last week, we hit 10,000 AI-powered fault diagnoses on FactoryLM.

Half were PowerFlex VFD faults. 32% on Allen-Bradley PLCs. The rest: GS20s, hydraulics, random legacy gear nobody remembers.

One user uploaded a blurry photo of a Fault Code 12 on a GS10. Our model found the manual page in 18 seconds. He fixed it in 3.

We trained Mira on 417 PDFs last month — mostly ignored application notes and out-of-print GS series guides. Now it answers 'What does [Obscure Alarm 7E] mean on a 20-year-old HPU?' like a senior tech.

We're not using LangChain or open-source LLMs. Just Claude API + raw manuals.

No Modbus streaming yet — that’s Config 4. But photo-to-diagnosis? Live.

Question: What’s the hardest fault code you’ve chased without a manual?

#MaintenanceTech #CMMS #IndustrialAI
Visual: Split-screen video: left side showing a technician pointing phone at a faulted PowerFlex VFD, right side showing Mira’s AI response with highlighted manual page and action steps.

---

## X
**254 chars**

Built Mira to answer A-B PLC fault codes in <10 sec using YOUR manuals. Not generic Google results. Your PDFs, indexed. Ask her 'What’s F12 on a PowerFlex 4M?' — she finds it. No app install. Works in Slack. factorylm.com

#Maintenance #IIoT
Visual: Screen recording: typing 'F12 PowerFlex 4M' into Mira chat, response appears in 8 seconds with manual excerpt and fix steps.

---

## Reddit
**1225 chars**

We’ve been testing AI for VFD and PLC fault lookup using real technician workflows. 

Here’s what we learned: most techs don’t need live PLC data to fix a fault — they need the manual. Fast. Especially for GS10/GS20s or older Allen-Bradley drives where the pdf is buried in a shared drive or long gone.

So we built a pipeline that ingests PDF manuals (yes, scanned ones) and lets you ask questions like:

- 'What causes Output Phase Loss on a GS20?'
- 'How to clear DC Bus Overvoltage on PowerFlex 4?'
- 'Hydraulic unit trips on high temp, pressure OK — what next?'

We tested with 37 manuals. Mira (our AI) pulled correct pages 94% of the time. Missed ones were due to bad scans or handwritten notes.

We’re not selling anything here. Just testing if this actually helps. If you’ve dealt with obscure fault codes and no docs, would something that instantly finds the right page — from your own manual set — save you time?

Visual: Video showing side-by-side: technician flipping through paper manual (frustrated), then typing question into Mira and getting answer instantly.

---

## Facebook
**684 chars**

We just pushed photo-to-diagnosis for GS10 VFDs. Works on your phone.

Take a pic of the fault code. App opens. Mira reads it. Pulls the exact page from the manual. Tells you the next 3 steps.

No app store download. Install as PWA. Works offline.

Last week, a user in Ohio snapped a photo of a flashing 'F7' on an old PowerFlex. Got the fix in 11 seconds. Said he usually spends 30+ minutes digging through binders.

We’re building this in public — adding one drive, one PLC family at a time.

What’s the most frustrating fault code you’ve seen on an Allen-Bradley or GS series drive?

#MaintenanceTips #FactoryLM #VFDRepair
Visual: Short clip: phone camera focusing on a GS10 display showing 'F7', app opens, AI response: 'Check input phase balance. Test AC line voltage. Inspect fuse continuity.'

---

## TikTok
**675 chars**

POV: You're staring at a faulted HPU, no manual, and production is down.

You open FactoryLM on your phone.
Snap a photo of the error.
AI pulls the manual page.
Tells you: 'Check pilot valve coil resistance — should be 22-26Ω.'

You test it. It’s 0Ω.
Replace coil. Machine back up in 18 minutes.

This happened yesterday at a packaging plant in Indiana.

We’re live for Allen-Bradley, PowerFlex, GS10/GS20 — and adding hydraulics weekly.

No magic. Just your manuals, ready when you need them.

##MaintenanceTech ##VFD ##PLC
Visual: First-person video: technician walking up to faulted machine, taking photo with phone, app responds instantly, technician nods, pulls out multimeter, fixes coil, restarts machine.

---

## Instagram
**1019 chars**

Photo: technician holding phone showing Mira’s response to a 'F13' code on a PowerFlex 40.
Text overlay: 'F13? That’s DC Bus Undervoltage. Check input line voltage at terminal block — not just at disconnect.'

Swipe →

Carousel card 2: Same tech, multimeter on terminals, reading 380V instead of 480V.

Card 3: AI chat history: typed 'F13 PowerFlex 40', response in 9 seconds with manual excerpt.

Card 4: 'FactoryLM — AI that reads your manuals so you don’t have to.'

We’re adding 10 new manual sets per week. Allen-Bradley, GS series, hydraulic units. No live PLC data — just the docs, fast.

What’s the last fault code you had to hunt down the old way?

##MaintenanceLife ##IndustrialAI ##CMMS ##VFD ##PLC ##PowerFlex ##AllenBradley ##Hydraulics ##FactoryTech ##ReliabilityEngineering ##MiraAI ##PWA ##NoAppStore ##TechLife ##BuildInPublic
Visual: 4-slide carousel: (1) phone showing Mira response to F13, (2) multimeter on terminals, (3) chat history, (4) FactoryLM logo with tagline.

---
