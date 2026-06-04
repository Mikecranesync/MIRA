# Video 5: This is how small factories can start building AI-ready machine interfaces

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
You don't need a quarter-million-dollar SCADA project. You need a phone photo and an afternoon.

**Beat 2 — The stack (0:08–0:16)**
Micro820 PLC, eighty-five bucks. GS10 VFD, four hundred. Basic conveyor motor. Ignition Perspective. All under a thousand.

**Beat 3 — The interface (0:16–0:25)**
Take a photo of any one of those machines. Feed it to Claude Code. Get back a working interface in sixty seconds.

**Beat 4 — The scale (0:25–0:35)**
One screen becomes two. Two becomes ten. Ten machines become a plant namespace. That's the on-ramp.

**Beat 5 — The future (0:35–0:48)**
When every machine has a screen, every machine can diagnose itself. That's not SCADA. That's something better.

**Beat 6 — CTA (0:48–1:00)**
Free guide on the whole stack in the bio. From zero to AI-ready.

---

## Long-Form Outline (8–12 min)

### Intro (0:00–1:00)
I'm going to show you the cheapest, fastest on-ramp to an AI-ready plant. You don't need to be a big manufacturer. You don't need to wait for an integrator. You need a garage, one afternoon, and less than a thousand dollars. Here's the whole stack.
[asset: photo of the actual rig—Micro820, GS10, motor, Ignition on a laptop]

### The problem: the SCADA graveyard (1:00–2:30)
Paint the pain.
- Small manufacturers get quoted $150k–$400k for a SCADA project. Micro820 retrofit, maybe $50k.
- They say no. They stay on paper trackers and phone calls.
- Six months later, a new equipment failure happens, and they wish they had visibility.
- The budget is trapped: too big to fund out of capex, too complex to DIY with WordPress.
- Explain: SCADA is for factories that are already big. Smaller plants have a gap.
[asset: screenshot of SCADA vendors' pricing lists, or a maintenance logbook (analog)]

### The cheap rig: what you actually buy (2:30–4:00)
Walk through the bill of materials.
- **PLC:** Allen-Bradley Micro820 – ~$85 (compact, runs ST, widely available).
- **Drive:** Yaskawa GS10 (or equivalent) – ~$400 (Modbus RTU serial, industry-standard).
- **Motor:** 0.75 kW, 3 phase – ~$150 (from any industrial supplier).
- **Conveyor/test rig:** ~$200–$300 (aluminum extrusion, belt, pulleys; can DIY).
- **Networking:** RS-485 cable, USB/serial adapter – ~$40.
- **Software stack:**
  - Ignition Community Edition (free tier) for the dashboard.
  - Claude Code (subscription) for the AI agent.
  - Total: under $1,000. Under $2,000 with spares.
- Compare: one day of SCADA integrator time costs $1,500. This is cheaper than consulting.
[asset: BOM table or photo of each component laid out, with price tags]

### Building the first interface (4:00–5:45)
Live walkthrough: from rig photo to working screen.
- Show: a phone photo of the rig's PLC (bad angle, poor lighting—exactly what a tech would snap).
- Prompt Claude Code: "This is my conveyor test rig. Make me an Ignition Perspective View that shows motor speed, sensor status, and a run/stop button."
- Result: JSON arrives in 45 seconds. You drop it into Ignition.
- Bind the view to the Modbus tags. Test. Deploy to the laptop.
- Show: motor starts, speed gauge moves, sensor indicator changes color.
- Total time: 45 minutes. Cost: $0 (you already have Claude Code or Ignition Community).
[asset: screen recording of this workflow, or ConveyorStatus Perspective View]

### One machine → five machines → the namespace (5:45–7:30)
Show how this compounds.
- Machine 1 (conveyor): screen works, tags are bound, it lives on the office laptop.
- Machine 2 (pump station): different rig, but same workflow. Photo → prompt → 45 seconds → new screen.
- Machines 3–5 (packaging line): each one gets its own interface.
- Now the question: how do they talk? Do they live in separate projects, or do they become part of a plant "command center"?
- That's where the namespace idea comes in. Instead of "the conveyor dashboard," you have "Site / Floor 2 / Line 3 / Conveyor / Status."
- One photo at a time, you're building a structured view of your whole plant.
- Show: the Command Center UNS tree expanding as you add machines. This is the scale point.
[asset: Command Center screenshot showing a multi-machine namespace tree]

### The safety story (7:30–8:45)
Address the skeptic.
- "Won't the AI break my equipment?"
- No. The AI never touches hardware. It generates interfaces and diagnostic suggestions.
- You (the human) verify the interface before deploying it. You test on the rig. You confirm tag paths.
- The AI generates options. You pick. You test. You own the outcome.
- Explain: this is the workflow we use on the $2M product (MIRA). If it works for grounded diagnostics, it works for learning interfaces.
- **The safety rule:** the AI never writes to the PLC. You write. You test. You verify. If something goes wrong, you can trace it.
[asset: diagram showing AI → draft interface → human review → test rig → deploy cycle]

### From interfaces to diagnosis (8:45–10:15)
Bridge to the bigger story.
- Once every machine has a screen, every machine can talk.
- When Machine 1 faults, MIRA sees "conveyor motor temp = 95C" and asks "Is this normal?"
- Your answer feeds back. Over time, MIRA learns what "normal" is for *your* plant.
- Machine 5 sees a similar fault and MIRA says "On your Line 3 Packaging Line, this fault usually means the belt tension slipped. I've seen it 3 times. Here's what worked last time."
- You've turned one rig into a plant nervous system. That's the thesis of MIRA.
- Explain: the photo-to-HMI pipeline is the on-ramp. The grounded diagnosis is the business.
[asset: Fault Detective screenshot showing a fault diagnosis with evidence, or a MIRA chat highlighting a part]

### The real cost (10:15–11:15)
Reframe the ROI.
- "Building this rig costs under $1,000. Building it with a SCADA integrator costs $150k."
- "That interface you made in 45 minutes? An integrator charges $2k per screen."
- "Once you have screens, your maintenance team spends 30% less time diagnosing. At $85/hr loaded cost, that's $500/month saved per tech."
- "If you have 5 techs, 5 machines, that's $2,500/mo in recovered labor. Payoff on the rig: less than a month."
- Sketch the numbers on screen. Make it simple math, not corporate spin.
[asset: ROI spreadsheet or handwritten math on a whiteboard]

### The on-ramp (11:15–12:00)
Recap the journey.
- Week 1: Build the rig, make one interface, test it.
- Week 2–4: Build interfaces for the next 4 machines. You're good at it now.
- Month 2: Wire them all into a namespace. See your whole plant structured.
- Month 3: Capture maintenance knowledge from your tech. Feed it into MIRA. Now diagnoses start getting grounded.
- Month 4+: You own the data, the interfaces, the knowledge. Scale or sell. Your call.
- This is how small factories become AI-ready without waiting for a vendor.
[asset: timeline diagram or a photo montage of the rig stages]

### Closing & CTA (11:00–12:00)
I've documented the full rig specs, the code to get started, and the pricing for each component in a free guide. It includes the photo-to-HMI prompt, the Modbus register map, and the checklist for bringup. No integrator needed.
If you want to go deeper and learn how to turn this into a full plant system (namespace + diagnosis + predictive), MIRA is where that leads.
[asset: screenshot of lead-magnet PDF cover or MIRA sign-up]

---

## Thumbnail Brief
**Layout:** Small garage/shop space on the left. Micro820 + motor + HMI on screen. On the right, a command-center dashboard showing multiple machines.
**Text overlay:** "SMALL SHOP → AI-READY" (top), "$0 SCADA" or "DIY STACK" (bottom).
**Key visual:** The journey from a single rig to a structured plant. Proof that you don't need a Fortune 500 budget.

---

## CTA
Free guide to the rig stack in the bio. Includes specs, code, and a checklist. If you want to learn how to turn this into a MIRA pilot for your whole plant, ask me.

**Funnel:** PDF (lead magnet) → MIRA (when they see the real value is in grounding and scaling).

---

## Production Notes
- **Voice tone:** founder-to-founder. "You can do this yourself. Here's the price tag and the timeline. You own it."
- **The affordability is the hook:** small manufacturers hear "AI-ready plant" and think $500k. You're showing $1k. Lead with that.
- **Banned phrases:** "Democratize," "accessible to everyone," "barrier to entry." Say instead: "costs under $1,000," "takes an afternoon," "you own the whole stack."
- **First 3 seconds wins:** open on the actual rig—Micro820 in your hand, conveyor running, screen showing it. Real hardware, not a concept slide.
- **Asset to source:** photo of the real rig you used (the garage demo is ideal). BOM spreadsheet with prices. The ConveyorStatus Perspective View JSON. Photo of the dollar bills if you're feeling on-brand (the "$0 SCADA" moment).
- **Call-to-action logic:** this video lands on PDF (product awareness + lead magnet), with a soft nudge toward MIRA at the end. The viewer has now seen the full arc: interface trick → testing it → scaling it → grounding it → MIRA. If they're still interested, they book an assessment.
