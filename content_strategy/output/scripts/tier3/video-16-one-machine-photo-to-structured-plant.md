# Video 16: From One Machine Photo to a Structured Plant

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
[Blurry phone photo of a control panel. Handwritten label "PMC Station."]
"One photo. Bad lighting, off-angle. Watch where this goes."

**Beat 2 — Photo Becomes Screen (0:08–0:18)**
[The photo transforms into a live, working HMI. Sensors light up. Real MQTT tags updating.]
"AI turns it into a live HMI in 10 minutes. Handwritten labels transcribed."

**Beat 3 — Screen Becomes Asset (0:18–0:28)**
[The HMI is tagged in the UNS. An asset entry appears: "Home Garage / Conveyor Lab / Conveyor 1 / CV-101".]
"The screen becomes an asset. The asset gets a location in the plant."

**Beat 4 — Asset Becomes Context (0:28–0:38)**
[The UNS tree expands: Enterprise → Home Garage → Conveyor Lab → Conveyor 1 → CV-101. Sensors, fuses, motor underneath.]
"One photo started this tree. Now the whole plant is mapped."

**Beat 5 — Context Enables Diagnosis (0:38–0:48)**
[A fault is injected. MIRA names it instantly, shows the asset, highlights the components, recommends steps.]
"When a fault hits CV-101, MIRA knows exactly which CV-101 you're talking about."

**Beat 6 — That's the Flywheel (0:48–0:55)**
[The Command Center showing live assets, connected lines, a technician on the floor with a phone.]
"One photo. One machine. Becomes the on-ramp to knowing your whole plant."

**Beat 7 — CTA (0:55–0:60)**
[MIRA logo + UNS tree. Factorylm.com.]
"Request a MIRA demo at factorylm.com. Start with one photo. End with a structured plant."

---

## Long-Form Outline (8–12 min)

### The Wedge: One Photo (0:00–1:00)
Most factories don't start with a plan. They start with a problem.

"Our Line 3 conveyor has no interface. We need something, fast."

That's where this starts. One machine. One photo. A maintenance manager takes a picture with their phone and says, "Can you turn this into a screen?"

That's the wedge.

[Show the original operator-station photo — blurry, off-angle, but clear enough to read the labels]

### From Photo to Working HMI (1:00–2:30)
The prompt is simple: "Reproduce this operator panel as an Ignition Perspective View. List the controls and indicators you see."

AI generates the JSON. You paste it into Ignition. You bind it to PLC tags (or mock them with a simulator).

Now you have a live screen that shows sensors, motors, fuses, and alarms.

The handwritten label "PMC Station" is transcribed into the UI as a header.

You've gone from "no interface" to "live HMI" in an afternoon.

[asset: docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png]

Cost: 4 hours of work. No SCADA project. No $200k budget.

### From HMI to Asset (2:30–4:00)
But an HMI is still just a screen. It doesn't tell anyone *where* this machine is in the plant.

That's where the UNS (Unified Namespace) comes in.

You tag the machine with a **UNS path**:
```
enterprise/home-garage/conveyor-lab/conveyor-1/cv-101
```

That path has meaning:
- **enterprise** = your org root
- **home-garage** = the site (your garage lab)
- **conveyor-lab** = the area (the conveyor learning area)
- **conveyor-1** = the line (Conveyor Line 1)
- **cv-101** = the asset (Conveyor CV-101)

Now the HMI isn't floating. It's *located*. It's *scoped*.

Every sensor, every fault, every diagnostic is scoped to CV-101 in the Conveyor Lab at Home Garage.

### From Asset to Namespace (4:00–5:30)
Once you have one asset in the UNS, adding a second becomes obvious.

Conveyor 2 (CV-102): different photo, same workflow, different UNS path.

Motor M-101, Pump P-201, Line 1 VFD — they all get paths.

Now you have a plant structure. Not a jumble of "screens." A *namespace*.

[Show the UNS tree expanding: Enterprise → Home Garage → Conveyor Lab → [Conveyor 1, Conveyor 2, Motor 1, Pump 1, VFD 1, ...]. Below each, the specific assets and their tags.]

The Command Center visualization shows this as an interactive tree. Expand "Home Garage" → expand "Conveyor Lab" → expand "Conveyor 1" → click "CV-101" → the HMI loads, the live tags update, the diagnostics are scoped to that asset.

[asset: docs/promo-screenshots/2026-05-30_command-center-LIVE-watching-nodered_desktop.png]

### From Namespace to Grounded Troubleshooting (5:30–7:00)
The reason the UNS matters becomes clear when a fault hits.

Fault F0022 on a VFD. But which VFD?

Without the namespace: "It's one of the Yaskawa drives." Which manual? Which register map? Which output line?

With the namespace: "F0022 on enterprise/home-garage/conveyor-lab/conveyor-1/vfd1."

Now MIRA knows:
- Which VFD model (GS10, installed 2023)
- Which manual to cite (Yaskawa GA500 Tech Manual, Section 6.3)
- Which PLC tags to check (Coil 0 = motor_running, HR 106 = vfd_freq)
- Which part number is correct (Yaskawa GA500-110 = 11 kW, not the 1.5 kW variant)

The namespace is the **grounding anchor**. It ties every diagnostic to the right asset, the right manual, the right procedure.

[Show the diagnostic coming back: "F0022 on Conveyor Lab CV-101 VFD1: DC Bus Undervoltage. Check incoming voltage..."]

### The Flywheel: Photo → Screen → Asset → Namespace → MIRA → Maintenance Brain (7:00–8:30)
This is the MIRA commercial thesis. See `NORTH_STAR.md`.

1. **Photo** = low friction on-ramp. Any manager can take a picture. No SCADA training needed.
2. **Screen** = early win. The operator sees a live interface day 1. Momentum.
3. **Asset** = first structure. A machine has a name, a location, a place in the plant.
4. **Namespace** = organizational structure. Multiple machines → a plant topology.
5. **Troubleshooting** = grounded intelligence. Faults are scoped to assets. Diagnostics cite manuals. Evidence is traceable.
6. **Maintenance brain** = the long-term layer. Historical fault patterns, PM schedules, asset relationships, work-order history.

Each step funds the next. Photo → HMI is a 4-hour consulting gig ($500–1k). HMI → Namespace is a $2–5k pilot. Namespace → MIRA Operating Layer is $499/month recurring.

The wedge is the photo. The business is the namespace.

[asset: NORTH_STAR.md — the flywheel section]

### Why This Wins Against $200k SCADA Projects (8:30–9:30)
SCADA projects start with "requirements gathering." You wait 6 weeks. You build a comprehensive system. You deploy it in 6 months.

By then, you've forgotten why you started.

This wedge starts with "take a photo." You have a live screen in 4 hours. It's obviously useful. It builds momentum.

The namespace approach scales *incrementally*. Photo 1 → Photo 2 → Photo 3. By photo 5, you've paid for itself in avoided manual lookups.

A $200k SCADA project is an all-or-nothing bet on "this will work."

A $500 photo-to-HMI gig is a low-risk yes that leads to the next conversation.

And if it doesn't go further, you still have a working HMI. No sunk cost. No failed project.

[Show the cost comparison: SCADA project timeline vs. Photo→Namespace timeline. Show ROI curves crossing.]

### The Real Value: Technician Confidence (9:30–10:30)
A technician standing in front of CV-101 with a phone that says "CV-101 is in Conveyor Lab at Home Garage; last fault was F0022 on Tuesday; related asset VFD1 has a manual indexed; fault codes F0022, F0041, F0100 are defined" — that tech is *more confident*.

They're not guessing. They're not opening a browser. They're reading structured knowledge about the specific asset they're touching.

That confidence is worth money. A tech who is confident makes fewer mistakes. Fewer mistakes = fewer repeat faults. Fewer repeat faults = more uptime.

And the organization gains the artifact: a **structured plant namespace** that never existed before.

That namespace is the moat. That's what MIRA sells.

### CTA (10:30–12:00)
"Request a MIRA demo at factorylm.com. Start with one photo of your machine. See where it leads."

---

## Thumbnail Brief

**Layout:** Three-panel progression — left shows a blurry phone photo of a control panel; center shows the HMI rendering live on a screen; right shows the Command Center UNS tree with the asset highlighted. Arrows between panels showing the transformation.

**Text overlay:** "1 PHOTO → WHOLE PLANT"

**Key visual:** The visual progression from chaos (blurry photo) to order (structured tree). The live green/red indicators in the Command Center.

---

## CTA

Request a MIRA demo at factorylm.com. Start with one photo. End with a structured plant.

**Funnel:** MIRA
