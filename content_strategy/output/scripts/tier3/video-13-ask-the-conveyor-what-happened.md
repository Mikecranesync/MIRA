# Video 13: Ask the Conveyor What Happened

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
[A 2D conveyor HMI on screen. Red light. MQTT stream in real-time.]
"I built a conveyor that diagnoses its own faults. Watch what happens when I blow a fuse."

**Beat 2 — Fault Injection (0:08–0:15)**
[Click: Fuse F2 blown. All three sensors go offline.]
"Three sensors just lost power. The system is running."

**Beat 3 — MIRA Names It (0:15–0:25)**
[MIRA chat panel: "I believe you are working on Conveyor CV-101. Affected components: Fuse F2, PE-101, PE-102, PX-101. Confirm?"]
"MIRA sees it in 10 seconds: branch fuse loss, 95% confidence. It shows evidence."

**Beat 4 — Confirmation Gate (0:25–0:32)**
[Tech clicks confirm.]
"Notice: it asks first. No guessing. No wrong fix."

**Beat 5 — Step-by-Step (0:32–0:45)**
[MIRA returns: fault name, evidence list, affected parts highlighted in red on the HMI, recommended first check, safety note.]
"De-energize the 24V branch. Measure F2. Swap if blown."

**Beat 6 — Real Hardware (0:45–0:55)**
[Live conveyor moving; PE sensors on a physical panel; real MQTT tags.]
"Real hardware. Real diagnostic rules. Grounded in your plant data."

**Beat 7 — CTA (0:55–0:60)**
[MIRA logo + "factorylm.com".]
"Request a MIRA demo at factorylm.com. See what your equipment can tell you."

---

## Long-Form Outline (8–12 min)

### The Setup (0:00–1:00)
A booth demo on a table. One conveyor HMI, two screens. The left screen shows the 2D SVG diagram with sensors and fuses labeled. The right shows the MIRA chat interface. On the bench: the real PLC (Micro820), the VFD (GS10), and a sensor panel.

[asset: docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png]

### Why This Matters (1:00–2:30)
Most maintenance problems start with a guess. A tech sees a fault light, guesses at the root cause, orders the wrong part, and loses 12 hours. Here's what happens instead: the equipment tells you exactly what's wrong before you touch anything.

The confirming gate is the key. MIRA doesn't start troubleshooting until it has confirmed the asset, the fault, and the evidence. It asks before it acts.

### The 7 Diagnostic Rules (2:30–4:00)
Walk through the priority order:
1. E-stop active — safety always first.
2. **Branch fuse loss** — the demo we're about to run. All three sensors on F2 are silent.
3. Mechanical jam — blocked >5s + vision present + no VFD motion.
4. VFD / motion mismatch — VFD running but vision sees nothing (belt slip).
5. Sensor dirty or misaligned — PE blocked >2s, vision sees empty belt.
6. PE-101 chatter — windowed dropouts on one sensor, peers stable.
7. Vision sees product, PE-101 silent — wire or input card failure.

Each rule is evaluated in order. The first that matches with >85% confidence is the diagnosis. The others are notes for follow-up checks.

### The Fault Injection (4:00–5:30)
Click the "Inject F2 Blown" button. Show:
- PE-101 raw value: false (was true)
- PE-101 debounced: false
- PE-102 raw value: false
- PE-102 debounced: false
- PX-101 raw value: false
- PX-101 debounced: false
- Fuse F2 status: "blown"

MIRA's engine is continuously polling these topics. Within 1 second, it evaluates the rule stack. Rule 2 (F2 branch loss) fires.

[asset: docs/promo-screenshots/2026-05-27_fault-detective-f2-blown_desktop.png]

### The Confirmation Gate (5:30–7:00)
MIRA's first message: "I believe you are working on Demo Cell / Conveyor CV-101 / with branch fuse loss affecting F2, PE-101, PE-102, PX-101. This is my #1 suspicion at 95% confidence, based on: [list of evidence]. Before I give you troubleshooting steps, please confirm this is correct, or tell me what you're actually seeing."

Why this matters: A technician can say "no, that's not the one I'm looking at" or "yes, that matches the fault light." If they correct MIRA, the engine drops the confidence and moves to rule 3. If they confirm, MIRA proceeds with evidence and steps.

This is the undeniable part of MIRA's value: it forces a check-point, not a guess.

### The Answer (7:00–8:30)
After confirmation:

```
Fault: Branch Fuse Loss (F2)
Confidence: 95%

Evidence:
- Fuse F2 status: blown
- PE-101 debounced: false (normally true)
- PE-102 debounced: false (normally true)
- PX-101 debounced: false (normally true)
- Affected components: Fuse F2, PE-101, PE-102, PX-101

Recommended first check:
Measure 24V at Fuse F2 input (should be ~24V).
Measure 24V at Fuse F2 output (should be 0V if blown, ~24V if OK).

Safety note:
De-energize the 24V distribution branch before pulling Fuse F2.
Verify de-energization with a multimeter on the input.
Use an appropriate 2A fuse replacement (NOT higher).

Next measurement:
After replacement, cycle the conveyor and confirm all three sensors are debounced = true.
```

The SVG diagram on the left highlights F2, PE-101, PE-102, PX-101 in red. The rest stay green.

### Why Grounding Matters (8:30–9:30)
This engine was trained on the **exact Micro820 v4.1.9 register map** and the **GS10 VFD command words**. Every diagnosis ties to a specific PLC tag, a specific register, a specific bit. There's no guessing about "what the sensor might be."

If the PLC doesn't see PE-101 = false, the diagnosis doesn't fire. If the diagnosis fires but the tech measures 24V on F2 output, the rules tell them what to check next.

This is grounding in action. Not ChatGPT guessing about "fuses." Grounding in your actual equipment.

### The Plant Context (9:30–10:00)
The Command Center UNS tree (shown in Video 16) is why this demo works at scale. One conveyor here has 13 fault modes. A real plant has 200+ assets. Grounding each one requires a namespace: where is this asset in the plant? Which line? Which cell? Which site?

The confirmation gate solves that at the top of the conversation. "Are you working on CV-101 in Demo Cell 1, or CV-102 in Demo Cell 2?" Once confirmed, every subsequent diagnosis is scoped to that asset.

### CTA (10:00–10:30)
"Request a MIRA demo at factorylm.com. We'll walk through a fault on your equipment, and you'll see exactly how MIRA grounds the diagnosis in your plant data."

---

## Thumbnail Brief

**Layout:** Split screen — left side shows the conveyor HMI with F2 fuse highlighted in red and three sensors offline; right side shows MIRA chat with "BRANCH FUSE LOSS 95%" in bold. Conveyor spinning in the background. Dark background.

**Text overlay:** "ASK THE CONVEYOR"

**Key visual:** The red-highlighted fuse and the confidence percentage. The contrast between a running machine and a named, grounded fault.

---

## CTA

Request a MIRA demo at factorylm.com. See what your equipment can tell you before you guess.

**Funnel:** MIRA
