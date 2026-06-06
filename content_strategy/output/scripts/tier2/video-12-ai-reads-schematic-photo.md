# Video 12: I asked AI to read a schematic photo and diagnose the fault

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
I snapped a photo of a wiring schematic with my phone. Dim. Grainy. Off-angle. Asked the AI to read it.

**Beat 2 — The read (0:08–0:20)**
It traced the circuit from the contactor through the thermal overload to the motor. Named every component. Identified the fault points.

**Beat 3 — The catch (0:20–0:35)**
It was right most of the time. But it misread one label and reversed a connection. Small mistakes in a crowded schematic. It's good, not perfect.

**Beat 4 — The lesson (0:35–0:50)**
Vision LLMs are a force multiplier, not a replacement for your eyes. It sees what your phone camera sees. But you know what's actually true on the plant floor.

**Beat 5 — When to trust it (0:50–0:58)**
Good for: reading nameplate specs, tracing complicated circuits, spotting component types. Bad for: reading faded handwriting, distinguishing wire colors, safety-critical details.

**Beat 6 — CTA (0:58–0:60)**
Schematic-reading guide: when to use vision AI, when to go to the PDF. Link in bio.

---

## Long-Form Outline (8–12 min)

### Why Schematics Matter (0:00–1:15)
A schematic is the blueprint of a fault. It shows how power flows, where the fault-detection points are, what interlock blocks what. If you can read a schematic, you can diagnose from first principles. But schematics are often old, faded, hand-annotated, and hard to parse under fluorescent lights in a plant. [asset: mira-core/data/photos/ sample schematic image]

### The Vision LLM Experiment (1:15–2:30)
I took a photo of a control-panel schematic with my phone. Bad lighting. The angle was off. Schematic was hand-drawn, not printed. I uploaded it to Claude's vision model and asked: "Trace the circuit from the start button to the motor. What are the fault-detection points? What could block the circuit?"

It came back with a detailed circuit trace, component identification, and a list of four things that could prevent the motor from running. It looked authoritative. [asset: prompt used; screenshot of vision LLM response]

### What It Got Right (2:30–4:15)
The AI identified the contactor, the thermal overload relay, the emergency-stop button, and the motor winding. It traced the power path correctly: start button → contactor coil → motor contactor → motor winding. It spotted the thermal overload as a protection device. It recognized that a blown fuse would break the circuit. Most of the schematic, it read correctly. [asset: schematic photo with AI annotations overlaid]

### What It Got Wrong (4:15–6:00)
One label — a small handwritten note in the corner — the AI misread as "OL-2" when it was actually "OL-A." The difference matters: OL-A is a class-A protection device (fast trip), OL-2 is a different device. The AI also reversed a connection: it said one terminal was "Line 1" when the schematic showed "Neutral." Small mistakes, but on a safety-critical schematic, they could matter. [asset: schematic close-up showing the misread label and reversed connection]

### Why It Happens (6:00–7:15)
Vision LLMs are trained on printed, high-quality schematic images from manufacturer PDFs. Your plant schematic is hand-annotated, faded, with sticky notes and coffee stains. The model is doing its best with bad data. It's like trying to read a photocopy of a photocopy — it fills in gaps with what it "thinks" makes sense. Sometimes right. Sometimes wrong. No way to know which is which from the image alone. [asset: `.claude/skills/mira-industrial-safety` vision boundaries]

### When to Use Vision AI on Schematics (7:15–8:30)
Good use cases:
- Reading a nameplate (model, serial, voltage) — the AI is usually right
- Tracing a long, complex circuit when you're tired — it gives you a starting point to verify
- Spotting component types (transistor, relay, capacitor) — the AI knows these shapes
- Getting a quick overview before diving into the PDF

Bad use cases:
- Reading faded or handwritten labels — too error-prone
- Distinguishing wire colors in dim photos — colors shift
- Safety-critical fault detection points — needs verification
- Any detail that would affect how you troubleshoot or reset [asset: mira-core/features/vision-bounds.md]

### The Workflow (8:30–9:15)
When you use vision AI on a schematic:
1. Take the photo on your phone right there at the panel (good light, straight angle, fill the frame).
2. Ask the AI to trace the circuit or identify components.
3. Use the AI output as a starting point, not gospel.
4. Verify the critical details: pull the PDF, check the labels, confirm the connections.
5. Trust your eyes over the AI's reading when they conflict.

The AI is a force multiplier. You are the authority. [asset: mira-core/data/photos/vision-schematic-workflow.md]

---

## Thumbnail Brief
**Layout:** A schematic photo on the left (dim, faded, hand-annotated). On the right, a clean, AI-rendered circuit diagram with component labels. A question mark in the middle indicating uncertainty.

**Text overlay:** "GOOD BUT NOT PERFECT"

**Key visual:** Side-by-side comparison of real schematic (messy) and AI-interpreted schematic (clean), with a small error highlighted in red.

---

## CTA
Schematic-reading guide: best practices for using vision AI on plant photos, when to trust the output, when to go back to the PDF, and how to build a workflow that multiplies your speed without sacrificing accuracy. Free guide in the description. [asset: new guide to be written covering vision boundaries and schematic workflows]

**Funnel:** MIRA (bridge to grounded troubleshooting; vision is part of the MIRA platform's grounding layer)
