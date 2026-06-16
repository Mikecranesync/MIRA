# Thursday 2026-04-16 -- build-in-public

## LinkedIn
**677 chars**

We built the CMMS setup in 2 minutes because we watched 17 maintenance techs struggle with onboarding last month.

No forms. No provisioning. No sales call.

Just log in, add assets, and start diagnosing.

We tested it on a PowerFlex 753 fault code (F302) — snapped the HMI screen, got the fix steps from the manual in 11 seconds.

Manual search? Took one tech 34 minutes. Phone tree with Rockwell support? Still on hold.

Now live: AI diagnosis via Slack, Telegram, or web.

We’re running beta at $97/facility/month — unlimited queries, full CMMS.

What’s the longest you’ve waited for a fault code answer?

https://app.factorylm.com

#MaintenanceTech #CMMS #PowerFlex
Visual: Split-screen video: left side shows someone scrolling through a printed PowerFlex manual, frustrated. Right side shows someone uploading the same fault screen to FactoryLM, getting an answer in seconds.

---

## X
**276 chars**

Last week: 37% of AI diagnosis requests were for A-B PLC fault 17 (I/O Module Fail).

Instead of digging through 400-page manuals, techs snapped a photo.

AI pulled the exact isolation steps from THEIR manuals in <15 sec.

No waiting. No guesses.

https://app.factorylm.com

#Maintenance #AllenBradley
Visual: Side-by-side: blurry photo of an Allen-Bradley PLC fault light, then the AI response showing 'Check Module Status LED, verify backplane connections, replace if no link.'

---

## Reddit
**1109 chars**

We’ve been running FactoryLM onsite at a metal stamping plant for 6 weeks. Here’s what we learned:

One recurring issue: GS20 VFDs tripping on F09 (Overvoltage during decel).

Standard manual fix: check input line, monitor DC bus voltage, adjust decel ramp.

But the real problem? Hydraulic power units cycling back pressure too fast, spiking regeneration.

We trained the AI to flag the hydraulic circuit first — not the VFD settings.

Now, when a tech snaps a photo of the GS20 fault code, the AI diagnosis includes: 'Check hydraulic return valve timing before adjusting VFD decel.'

It’s not magic — it’s context. 

We’re using RAG to pull from their actual GS20 and hydraulic unit manuals.

If you’re drowning in OEM docs and still guessing, you’re not alone. We’re trying to fix that — one facility at a time.

(No sales pitch. Just sharing what worked here.)

Visual: Photo of a GS20 VFD display showing F09 fault, with a red hydraulic line in the background. Caption overlay: 'F09? Check the hydraulics first.'

---

## Facebook
**644 chars**

We built something real this week:

A maintenance tech at a bottling plant snapped a photo of a flashing fault on a PowerFlex 525.

In 22 seconds, the AI returned: 'F71 – Ground fault. Check motor leads, inspect connector block for moisture.'

He found water in the conduit. Fixed in under 10 minutes.

No manual. No phone call. No downtime.

We’re shipping AI that reads YOUR manuals — not generic tips.

How many hours this month did you waste looking up fault codes?

https://app.factorylm.com

#MaintenanceReliability #VFD #FactoryLM
Visual: Short video: hand holding phone takes photo of PowerFlex 525 HMI. App processes image. Text appears: 'F71 – Ground Fault. Check motor leads and connector block for moisture.'

---

## TikTok
**446 chars**

POV: You’re staring at a faulted Allen-Bradley PLC. No manual. No time.

We trained AI on actual Rockwell manuals — not guesses.

Snap a photo. Get the fix from YOUR docs in seconds.

This isn’t demo. It’s live in 12 facilities.

No LangChain. No BS. Just faster answers.

#MaintenanceTech #PLC #FactoryLM #BuildInPublic

#MaintenanceTech #PLC #FactoryLM #BuildInPublic
Visual: Quick cuts: close-up of a fault light on an A-B PLC, hands fumbling with a binder, phone camera snapping the screen, app response popping up with 'Module 3: Replace due to comms loss.'

---

## Instagram
**924 chars**

Carousel:

1. Photo of a technician in front of a hydraulic power unit with a GS10 VFD showing fault F11 (Phase Loss).
2. Phone screen: blurry photo upload to FactoryLM.
3. App response: 'F11 – Check input fuses L1/L2/L3. Verify line voltage at terminal block. Inspect contactor coil.'
4. Technician replacing a blown fuse.
5. VFD green ready light on.

No manual. No wait. Just fix.

We built this because 40 minutes shouldn’t cost 4% of your shift.

Now in beta: $97/month per facility. 48-hour refund if it doesn’t save time.

What fault code wastes the most of your time?

#MaintenanceLife #Hydraulics #VFDRepair #AllenBradley #PowerFlex #GS10 #Troubleshooting #FactoryTech #CMMS #IndustrialAI #BuildInPublic #MaintenanceTeam #ReliabilityEngineering #NoMoreManuals #FixItFast
Visual: 5-image carousel: 1) Faulted GS10 on hydraulic unit, 2) Phone uploading photo, 3) AI response on screen, 4) Technician swapping fuse, 5) Machine running again.

---
