# Video 3: Can AI build a PLC dashboard from a machine photo? (The real test)

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
Everyone says AI can't do real industrial work. Let's test it. One photo of a control panel. One real PLC. One question: does it work?

**Beat 2 — Setup (0:08–0:15)**
I gave Claude Code a photo, the Micro820 manual, and a GS10 VFD. The prompt: "Build a dashboard that reads this PLC and controls this drive."

**Beat 3 — The stumble (0:15–0:28)**
The AI wrote perfect code. From the wrong register map. The motor never moved. That's when I learned something.

**Beat 4 — The fix (0:28–0:40)**
One manual change. Redeployed. Motor ran. But here's the real lesson: the code was wrong because the *foundation* was wrong. Not the AI. The input.

**Beat 5 — The result (0:40–0:52)**
Dashboard worked. Conveyor moved. Sensors lit up. But it took a human who knew the equipment to catch what the AI missed.

**Beat 6 — CTA (0:52–1:00)**
That's the real story. Free guide in the bio. I walk through the failure and what it taught me.

---

## Long-Form Outline (8–12 min)

### Intro (0:00–1:00)
I'm a maintenance guy, not a software engineer. But I convinced an AI to program a real PLC and control a real VFD. This is the honest version—what worked, what didn't, and why the failure was actually the whole point.
[asset: plc/Micro820_v4.1.9_Program.st, plc/GS10_Integration_Guide.md §8]

### The Setup: Hardware + Prompt (1:00–2:30)
Show the rig: Micro820 PLC, GS10 VFD, conveyor motor.
- The Micro820 runs structured text (ST). The GS10 is a Modbus RTU drive. They need to talk.
- The challenge: the AI has never seen *my* register map. It only knows the GS10 datasheet.
- The prompt: "Write an ST program that reads current PLC inputs, sends a run command to the GS10 via Modbus RTU, and returns the motor status to the dashboard."
- Explain: I gave the AI a real job with real stakes. Not a simulation. Not a tutorial. Actual hardware.
[asset: photo of the rig, plc/MbSrvConf_v4.xml]

### The First Attempt: Perfect Code, Wrong Manual (2:30–4:15)
Show the code the AI generated.
- The ST structure was clean. Function blocks. State machine logic. Proper error handling. All the hallmarks of good code.
- But when I deployed it to the PLC, the motor wouldn't budge.
- Walk through the troubleshooting: "Motor's getting power. PLC is running. Drive's online. Why no move?"
- I found it: the AI was reading and writing the wrong registers. The code looked for motor speed at `HR100`, but the actual register was `HR400110`.
- The AI had this right in the datasheet. It just grabbed the wrong one.
[asset: code snippets showing the two register references, or a comparison table GS1 vs GS10]

### The Root Cause: Why This Happened (4:15–5:45)
This is where the video earns trust.
- The GS10 comes in multiple hardware revisions. The older GS1 uses one register map. The newer GS10 uses another.
- Both are in the same manual, a page apart.
- The AI had the manual. It just picked the first one it saw.
- Explain: this wasn't laziness. It was the difference between a 5-year-old drive (in your plant) and a current-gen drive. The AI couldn't tell which one was real without asking.
- This is also why documentation alone isn't enough. Specifications + *your* hardware serial numbers = the truth.
[asset: screenshot of the two register tables in the GS10 manual, side-by-side]

### The Fix & The Lesson (5:45–7:15)
Walk through how I fixed it.
- I changed one line: `HR100` to `HR400110`.
- Redeployed. Ran the ST program again. Motor spun up. Sensors read correctly. Dashboard lit up.
- The lesson: **the AI gave me 95% of a solution. I supplied the 5% that mattered.**
- Most people think that means the AI failed. I think it means grounding beats fluency. An ungrounded AI can write perfect syntax for the wrong problem. A grounded person catches it in five minutes.
- This is why I built MIRA. It's this same pattern, but for diagnostics: AI generates candidates, *you* choose the right one because you know your equipment.
[asset: before/after code comparison, or a video of the motor spinning]

### The Working Dashboard (7:15–8:45)
Show the final result running.
- Snapshot of the Ignition dashboard reading the motor speed, drive temperature, fault codes.
- Trigger a simulated fault and watch it propagate: PLC sees it, drive reports it, dashboard highlights it red.
- Demonstrate the control: press "run" on the dashboard, motor accelerates. Press "stop," motor decelerates. This is the proof it's live.
- Narrate: "This dashboard came from a photo and a prompt. But it only works because a human who knows the equipment verified the foundation."
[asset: ConveyorStatus screenshot with live tags, or Fault Detective dashboard]

### What This Tells You About Industrial AI (8:45–10:30)
Step back and philosophize.
- AI is not your replacement. It's the draft generator.
- The question isn't "Can AI write PLC code?" It's "Can AI save me time on the drafting part so I can focus on the verification?"
- Answer: yes. Significant time savings.
- But the corollary: you still have to know your equipment well enough to spot when the AI grabbed the wrong manual.
- This is why I'm skeptical of "fully autonomous" industrial AI. The plant changes. The equipment drifts. Manuals lie sometimes. You have to stay in the loop.
[asset: diagrams or callout showing AI + human = working solution, vs. AI alone or human alone]

### The Bigger Picture: Why Grounding Matters (10:30–11:30)
Connect this test to MIRA's core principle.
- Every MIRA answer cites a source. Your manual, your work orders, your tag map.
- If the source is wrong, the answer will be wrong. But at least you can see *why*.
- A generic AI will make up an answer that sounds good. A grounded AI will say "I don't know" or "check this source."
- The GS1/GS10 mistake is small, but it's the same pattern: **without knowing your specifics, even a fluent AI picks the wrong path.**
- This is also why you can't just replace your techs with a chatbot. You need the chatbot + the tech together.
[asset: `.claude/rules/uns-confirmation-gate.md` concept, or MIRA chat screenshot showing a source citation]

### Closing & CTA (11:30–12:00)
I documented the full build, including the failure and the recovery, in a free guide. It covers the ST state machine, how the Modbus RTU registers work, the gotchas I hit, and the workflow I use now to avoid them. There's also a section on when to fight with CCW and when to rewrite working code—spoiler: almost never.
[asset: screenshot of lead-magnet PDF cover]

---

## Thumbnail Brief
**Layout:** Your skeptical face (mid-doubt) on the left. PLC + conveyor + motor on the right. Bold text overlay.
**Text overlay:** "AI + REAL PLC = ?" (top), "REAL TEST" (bottom, red box).
**Key visual:** The contrast between "everyone says AI can't do this" (your face) and the actual hardware (proof it works).

---

## CTA
Free guide in the bio. I walk through the full build—the code, the failure, and the lesson.

**Funnel:** PDF (lead magnet) → MIRA (when they see how grounding prevents the same mistake on diagnostics).

---

## Production Notes
- **Voice tone:** skeptic-turned-believer. "I expected it to fail. It mostly didn't. But here's where it did—and why that matters."
- **The honest failure is the hero:** don't hide the GS1/GS10 mistake. Lead with it. That's what builds trust with controls people.
- **Banned phrases:** "AI solved it," "magic," "autonomous." Say instead: "the AI generated the code," "I verified the registers," "the foundation was wrong, not the syntax."
- **First 3 seconds wins:** open on the rig (PLC, drive, motor) with a question overlay. "Does AI work on real hardware?"
- **Asset to source:** plc/Micro820_v4.1.9_Program.st for the code walkthrough. plc/GS10_Integration_Guide.md §8 for the register maps. Photos of the actual rig are critical for authenticity.
- **Call-to-action logic:** this video lands on PDF first (product awareness), then bridges to MIRA (the real business—grounded maintenance intelligence).
