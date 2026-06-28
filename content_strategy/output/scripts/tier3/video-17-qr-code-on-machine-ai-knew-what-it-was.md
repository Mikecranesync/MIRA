# Video 17: I Scanned a QR Code on a Machine and the AI Knew What It Was

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
[A technician on a plant floor. Zoomed in on a QR code sticker on a control panel.]
"Stick a QR code on any machine. Scan it with your phone. The AI knows which one you're standing at."

**Beat 2 — Scan (0:08–0:15)**
[Phone camera pointed at the QR code. One tap. The QR resolves to a URL.]
"No app. No sign-in. Scan the code."

**Beat 3 — Context Loads (0:15–0:25)**
[Phone screen: "CV-101 — Conveyor Lab, Home Garage. Last fault: F0022, Tuesday 14:00. Manual available. Ask a question."]
"Asset context loads. Live tags. The asset manual. Everything about that specific machine."

**Beat 4 — Ask a Question (0:25–0:35)**
[Tech types: "It's making a noise." MIRA responds: "Likely bearing wear on the motor — let's check the current draw and temperature."]
"You ask a question. MIRA answers based on the asset, not a generic guess."

**Beat 5 — Grounded to the Machine (0:35–0:45)**
[The MIRA answer references CV-101 specifically: "CV-101 motor current is running 20% high. Temperature is elevated. Recommend bearing inspection."]
"The answer is grounded in CV-101's real tags, not generic troubleshooting."

**Beat 6 — No App. No Training. (0:45–0:55)**
[A different technician scans a different QR code on a different machine. Same instant access.]
"Every technician on your floor gets instant access to every machine's knowledge."

**Beat 7 — CTA (0:55–0:60)**
[QR code + Phone. Factorylm.com.]
"Request a MIRA demo at factorylm.com. QR code on every machine. Knowledge at hand."

---

## Long-Form Outline (8–12 min)

### The Setup: QR on Hardware (0:00–1:00)
A technician walks the plant floor with a phone. On every machine panel, a small QR code sticker.

No app required. No sign-in. Just point, scan, tap.

The QR resolves to a URL like:
```
https://mira.factorylm.com/assets/enterprise/home-garage/conveyor-lab/conveyor-1/cv-101
```

The browser loads a lightweight mobile interface with:
- Asset name and location (CV-101 in Conveyor Lab)
- Live tags (motor_running, vfd_freq, current_draw, temperature)
- Last 10 fault events (timestamps, fault names, evidence)
- Related assets (VFD1, Sensor PE-101, Fuse F2)
- A chat box to ask MIRA questions

No authentication. No app store. No "please wait for the app to load."

This is **zero-friction floor access to asset knowledge**.

[asset: 2026-05-10_qr-asset-sheet_desktop.png]

### Why This Matters (1:00–2:00)
Most plant maintenance is analog. A technician walks a line with a clipboard. He writes down what he sees. He walks back to the office, opens a computer, looks up fault codes.

That's serial work. That's time wasted.

QR on the machine + MIRA on the phone = parallel work. The technician gets the information *at the asset*, not hours later at a desk.

And because the QR is scanned *in place*, the context is unambiguous. "I'm standing at CV-101. My phone shows CV-101's manual. My question is about CV-101."

No confusion. No "which conveyor was this?" No wrong diagnosis because the technician was looking at the wrong manual.

### The Mobile Interface (2:00–3:30)
The QR page is lightweight. Not a full app — a mobile web interface.

**Header:**
```
CV-101 — Conveyor Lab, Home Garage
Enterprise / Home Garage / Conveyor Lab / Conveyor 1
```

**Live tags (updated every 2 seconds):**
```
Motor Running: ✓ (running)
VFD Frequency: 59.8 Hz
VFD Current: 12.3 A (normal)
Temperature (bearing): 67°C (elevated, target <60°C)
Pressure (oil): 22 psi (OK)
```

**Recent events:**
```
Tuesday 14:00 → F0022 (DC Bus Undervoltage) [RESOLVED]
Monday 09:30 → Sensor PE-101 dropout [RESOLVED]
Monday 08:15 → Motor contactor chatter [RESOLVED]
```

**Related assets (one-tap navigation):**
```
VFD1 — Yaskawa GA500 (last fault: F0041, 3d ago)
Sensor PE-101 — Proximity switch (last dropout: 1d ago)
Fuse F2 — Branch fuse, 2A (status: OK)
```

**Chat box:**
```
[Your question here...]
[MIRA's response, grounded in CV-101]
```

All of this loads in <2 seconds. No app. No install.

[Show a mobile screenshot of the QR page]

### The Grounding: CV-101 → Manual → Tags → Diagnosis (3:30–5:00)
A technician scans CV-101's QR. The page loads. He sees the live tags.

He notices the bearing temperature is 67°C (elevated from the 60°C target).

He types: "Bearing feels hot and is making a noise."

MIRA responds:

```
Bearing wear diagnosis for CV-101 motor:

Evidence:
1. Bearing temperature: 67°C (2–3°C above target)
2. Motor current draw: 12.3A (normal; not indicating shaft friction)
3. Acoustic signature: grinding noise on start (mentioned)

Most likely: bearing wear / lubrication degradation

Next checks:
1. Visually inspect bearing for leakage or discoloration
2. Measure temperature at 5-minute intervals during operation
3. If temperature >75°C, recommend shutdown and bearing replacement

Related: CV-101 bearing is a SKF 6309 (installed 2022, typical life 8–10 years)
Manual reference: Conveyor assembly manual, Section 4.2, page 67
```

Notice what just happened:
- The diagnosis is **scoped to CV-101** (not "conveyors in general")
- It references **the exact bearing model** (SKF 6309, from the asset registry)
- It cites **the exact manual and page** (Conveyor assembly manual, §4.2, p.67)
- It compares **actual temperature** (67°C vs. 60°C target, measured right now on CV-101)
- It gives **next steps** (measured, actionable, traceable)

All of this is grounded in the asset. No generic answer. No guessing.

[asset: docs/promo-screenshots/qr-scan-asset-context.png (if available; otherwise describe the flow)]

### The Workflow: No App, No Training (5:00–6:30)
A new technician starts on your line. They've never worked CV-101.

They walk the floor. They see a QR code on the conveyor panel.

They pull out their phone. Camera app. Point at the QR. Scan.

The page loads: "CV-101 — Conveyor Lab, Home Garage. Last fault: F0022. Ask a question."

They don't need training. They don't need an app. They don't need to memorize where manuals are stored.

They just scan and ask.

And because the QR is printed on the hardware itself, it's impossible to get the context wrong. The asset you're touching is the asset the QR points to.

[Show the QR-print spec: small square sticker, weather-sealed, placed on the machine panel near the nameplate]

### No App Means Fast Adoption (6:30–7:30)
Adoption is the hardest part of any technician tool.

If you require "download the app, create an account, wait for IT to approve," half your team never uses it.

If you print a QR code on the machine, and it works on any phone's camera app, adoption is instant.

Every technician who has a phone — which is all of them — gets instant access.

No download. No account. No training. Scan and use.

### The Technician Outcome (7:30–8:30)
A technician walks a line with a phone and a clipboard.

Before MIRA:
- Sees a fault light
- Writes it down on the clipboard
- Walks back to the office
- Opens a computer
- Searches for the manual
- Looks up the fault code (47 minutes average)
- Calls the site supervisor with a half-confident diagnosis
- Orders a part (or the wrong part)

With MIRA + QR:
- Sees a fault light
- Scans the QR on the machine
- Types the fault code into MIRA on their phone
- Gets the diagnosis with source citations
- Calls the site supervisor with evidence
- Orders the right part
- (Or understands the problem is outside the plant and doesn't order anything)

Time saved: 40+ minutes per fault.

Confidence gained: the technician is speaking from a manual, not guessing.

Mistakes avoided: fewer wrong part orders, fewer repeat faults.

### Scale: Every Machine Gets a QR (8:30–9:30)
One QR code costs $0.05 to print.

Stick them on every asset in your plant.

Now your entire plant is a network of instant access points to MIRA.

A technician on Line 1 can scan Line 3's equipment. A contractor on a site visit can scan and get full context without asking questions.

Your PM schedule? Printed as a QR. Scan it → "Next bearing inspection: Friday 3 PM."

Your wiring schematic? Archived as a QR on the panel. Scan it → "Here's the wiring diagram for CV-101."

[Show a plant floor with multiple QR codes visible on different machines. Each scan loads that machine's specific context.]

### The Business Model (9:30–10:30)
The QR is free to print and stick.

The mobile interface is free to visit.

The MIRA grounding and diagnosis are the paid layer.

A technician scans CV-101. They get the asset context (free). They ask MIRA a question (paid, via the MIRA subscription on your plant).

The QR is the **onboarding moment**. It's the first touchpoint where a technician realizes the knowledge is *available*.

Everything after that is engagement and value capture.

For your plant: every technician has access to every manual, every fault code, every asset relationship — instantly, at the point of failure.

### CTA (10:30–12:00)
"Request a MIRA demo at factorylm.com. We'll stick a QR code on your most critical machine. Scan it. See what instant asset context looks like."

---

## Thumbnail Brief

**Layout:** Close-up of a QR code sticker on a metal control panel. Technician's hand with a phone scanning it. Phone screen shows the asset context (asset name, live tags, last faults, manual link). Two panels: left = physical QR on hardware, right = phone screen with asset loaded.

**Text overlay:** "QR CODE = INSTANT CONTEXT"

**Key visual:** The connection between the physical QR and the instant digital response. The simplicity of the scan-and-know workflow.

---

## CTA

Request a MIRA demo at factorylm.com. Scan a QR. Get instant knowledge of the asset you're touching.

**Funnel:** MIRA
