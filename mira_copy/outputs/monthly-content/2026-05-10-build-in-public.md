# Sunday 2026-05-10 -- build-in-public

## LinkedIn
**696 chars**

We ran a live diagnosis test today on a PowerFlex 525 fault — code F41.

Our AI, Mira, found the cause in 12 seconds: phase loss on input terminals. Work order auto-generated.

We timed the same fault in a printed manual: 38 minutes. 

This is why we're building FactoryLM in public. Not because it's easy — because maintenance techs waste hours every week on this.

Beta users get 2-minute CMMS setup, photo-to-diagnosis, and AI that reads your manuals.

We're shipping new fixes every week — sometimes messy, always real.

Question: How many minutes did you lose last week just hunting down fault codes?

##MaintenanceTech ##CMMS ##PowerFlex
Visual: Screen recording: split view of Mira returning fault diagnosis in 12 seconds vs. technician flipping through a PowerFlex 525 manual.

---

## X
**278 chars**

F41 on a PowerFlex 525.

Tech 1: Checks manual, calls OEM, waits — 40 mins.
Tech 2: Snaps photo. AI returns diagnosis in 11 sec.

We built the tool we needed on the floor.

We don't sell promises. We sell time.

https://app.factorylm.com

##VFD ##AllenBradley
Visual: Side-by-side video: one hand flipping through a manual, the other tapping a phone to trigger AI diagnosis.

---

## Reddit
**1052 chars**

We're building FactoryLM in public — not as a marketing move, but because we were tired of waiting 30 minutes for simple answers on the floor.

Last week, we stress-tested Mira on a blown GS20 VFD. Fault code: 0x342 (overvoltage during decel).

We uploaded 14 Automation Direct manuals into the system — including obscure legacy PDFs with no TOC.

Mira returned: 
1) Check brake resistor continuity (R5-2 to R5-3, 50Ω)
2) Verify decel ramp time < 15s
3) Inspect contactor K2 for arcing

Tested all three. Found burnt contacts on K2.

No live PLC data. No Modbus. Just OCR + RAG over real manuals.

If you're debugging VFDs daily, this is what it’s like when the AI actually knows your gear.

We’re sharing these steps because we believe in open testing — not because we want downloads.

Visual: Photo: annotated screenshot of a GS20 fault log next to Mira's diagnosis card highlighting 'contactor K2'.

---

## Facebook
**670 chars**

We just fixed how Mira handles hydraulic power unit schematics.

Old way: You upload a .PDF. AI reads it. Sometimes misses symbols.

New way: We pre-process schematics to isolate relief valves, accumulators, and pump stacks before indexing.

Now, if you snap a photo of a tripped HPU with a stuck relief valve, Mira returns:
- Exact valve location (per your schematic)
- Adjustment torque spec
- Linked PM history

We’re shipping updates weekly because we know you can’t wait months for a fix.

Question: What’s the most frustrating thing about using schematics under pressure?

#Maintenance #Hydraulics #FactoryLM
Visual: Carousel: 1) Photo of a messy HPU control box, 2) Uploaded schematic, 3) Mira’s diagnosis highlighting the relief valve.

---

## TikTok
**634 chars**

Day 14 of building FactoryLM live.

We broke Mira yesterday — overloaded the context window with a 1200-page Allen-Bradley manual.

Techs kept asking about obscure ControlLogix I/O faults, so we went all-in on chunking strategy.

Now she parses 175 fault codes from 1756-UM001E-EN without choking.

No magic. Just stubbornness.

Video shows: upload → error → fix → fast answer on 'no communication with module in slot 4'.

This is what real industrial AI looks like — not hype. Grit.

##BuildInPublic ##MaintenanceTech ##AllenBradley
Visual: Fast-cut video: debug logs, frustrated dev, code edits, then Mira instantly answering a ControlLogix fault.

---

## Instagram
**1045 chars**

Build log: Week 3.

We’re training Mira to read handwritten notes in margins of old hydraulic schematics.

Why? Because real techs annotate. Circles. Arrows. 'FIXED 3/22 – check solenoid B'.

Last test: photo of a greasy HPU schematic with 'PUMP NOISE! – replaced 2023' scrawled on it.

Mira flagged:
- Last replacement date
- Linked work order
- Suggested checking inlet strainer (per OEM history)

Not perfect yet. But getting closer.

This is how industrial AI learns — from your floor, not a lab.

#MaintenanceLife #FactoryLM #BuildInPublic #Hydraulics #CMMS #PowerFlex #AllenBradley #AutomationDirect #TechLife #Reliability #IndustrialAI #BuildInTheOpen #NoFreeTier #PWA #OnTheFloor

#MaintenanceLife #FactoryLM #BuildInPublic #Hydraulics #CMMS #PowerFlex #AllenBradley #AutomationDirect #TechLife #Reliability #IndustrialAI #BuildInTheOpen #NoFreeTier #PWA #OnTheFloor
Visual: Carousel: 1) Close-up of a greasy, hand-annotated hydraulic schematic, 2) Phone screen showing upload, 3) Mira’s diagnosis card with highlighted notes and history.

---
