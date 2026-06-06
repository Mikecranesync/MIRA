# Video 1: I turned a bad webcam photo into a working HMI

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
This is a garbage webcam photo of a control panel. Dark. Blurry. Angle's wrong. A PM scheduler label scrawled in marker. Now watch what the AI does with it.

**Beat 2 — The generate (0:08–0:16)**
I gave Claude Code the photo and a prompt: "Turn this into an Ignition Perspective View. List everything you see." Thirty seconds later, I had JSON.

**Beat 3 — The build (0:16–0:24)**
I dropped that JSON into the operator station project. The AI didn't invent anything—it read the panel. Numbers. Controls. Buttons. Even transcribed the handwritten label.

**Beat 4 — Live proof (0:24–0:35)**
I wired it to real tags. Now when the motor runs, the screen moves. When the sensor faults, the display goes red. This isn't a drawing. It's functional.

**Beat 5 — The reach (0:35–0:45)**
Bad photo, real interface. You don't need studio equipment or a $200k SCADA project. You need a phone and an afternoon.

**Beat 6 — CTA (0:45–1:00)**
Free guide in the bio. I'll walk you through the exact 5 steps—safely. From any bad photo to a screen that works.

---

## Long-Form Outline (8–12 min)

### Intro (0:00–1:00)
In this video, I'm going to show you how I turned a grainy, real-world photo of a machine control panel into a working, live-updating HMI screen. No SCADA project. No six-month integration. Just a photo, an AI agent, and what I learned along the way.
[asset: docs/promo-screenshots/2026-05-30_command-center-LIVE-real-probe_desktop.png]

### The Starting Point: Why This Photo Matters (1:00–2:30)
Show the original operator-station webcam photo side-by-side with the generated view.
- Explain: this photo came from a real plant, real handheld camera, real maintenance context.
- Why it's hard: it's dark, off-angle, has glare, and someone wrote "PMC Station" in marker on the panel.
- What the AI saw that humans don't: structural patterns, labels, control relationships (input → output).
[asset: mira-core/data/photos/ or recaptured operator-station photo]

### The Prompt: What I Actually Asked (2:30–3:45)
Read the exact prompt template on screen.
- "Reproduce this operator panel as an Ignition Perspective View in JSON."
- "List every control and indicator you see—buttons, gauges, displays, labels."
- "If there's handwritten text, transcribe it into the label fields."
Walk through what the AI heard vs. what it produced: it read *position*, *function*, *label*—not the image quality.
[asset: screenshot of prompt in editor, or clean graphic]

### The Result: Building the View (3:45–5:30)
Show the generated Perspective View JSON being dropped into Ignition.
- Walk through the layout: where buttons landed, how labels were placed, what controls the AI chose to represent.
- **The honest moment:** show one thing it got wrong (maybe a sensor orientation or a button size), and how I fixed it in 30 seconds. This builds credibility.
- Explain: the AI created a *functional structure*, not a pixel-perfect design. You own the taste; the AI owns the wiring logic.
[asset: ignition/project/.../ConveyorStatus/resource.json or operator-station view JSON]

### Live Binding: From Static to Real (5:30–7:00)
Show tagging the screen to real PLC tags.
- Map each indicator to a tag (e.g., motor_run → button display, sensor_1 → indicator color).
- Show the tag configuration table (what I named it, what range it controls, what color it becomes when faulted).
- Hit a live tag update and watch the screen change in real time.
- Zoom on the handwritten "PMC Station" label now rendered in the screen—the AI transcribed it.
[asset: live Ignition screenshot + tag binding UI, Fault Detective conveyor HMI for reference]

### The Gotchas: What Goes Wrong (7:00–8:45)
Honest troubleshooting.
- **Bad photo, good prediction:** the AI will fill in gaps it can't see. You must verify.
- **Labels matter:** if the photo doesn't show a nameplate, the AI can't read it. Go back and snap a closer photo.
- **Binding is the hard part:** generating the layout is minutes; wiring it to tags is where the thinking lives.
- **Deploy ≠ done:** once you have a view, you still need to confirm it on the PLC, test tag paths, and validate handoff.
[asset: code snippets or screencaps showing a binding mistake, then the fix]

### Why This Works (8:45–10:15)
Step back and explain the principle:
- Machine panels are *designed* to communicate visually—that's their only job.
- The AI learned those patterns from thousands of industrial schematics and HMI examples.
- Vision LLMs are good at reading spatial relationships. They're not replacing your engineering; they're saving you the sketch time.
- This is safe because you're in control of the binding, the tags, and the live test. The AI never writes to hardware.
[asset: `.claude/rules/fieldbus-readonly.md` concept / safe-AI-near-PLC diagram]

### One More Thing: Handwriting (10:15–11:00)
Highlight the handwritten "PMC Station" label one more time.
- This is the moment that convinced skeptical controls people this wasn't a gimmick.
- The AI saw the marker text and turned it into a proper UI label.
- Your team's tribal knowledge (handwritten notes, sticky labels, field names) just became structured data.
- One photo → a screen → a snapshot of how your plant actually works.
[asset: close-up of "PMC Station" in original photo + rendered label in HMI]

### Closing & CTA (11:00–12:00)
If you want to try this on your machine photos, I've put together a free 5-step guide. It walks you through the exact process—taking the photo, the prompt, reviewing the AI output, binding to tags, and testing safely.
The guide also covers what to do when the photo is really bad, how to confirm model numbers, and the safety workflow.
[asset: screenshot of lead-magnet PDF cover]

---

## Thumbnail Brief
**Layout:** Split screen. Left side: grainy, dark original webcam photo of control panel with "PMC Station" scrawled in marker. Right side: clean, rendered Perspective View with the same labels and controls. Yellow arrow between them pointing right.
**Text overlay:** "PHOTO → HMI" (top), "AI Did This" (bottom, smaller).
**Key visual:** The contrast between the real, ugly photo and the functional, structured interface—the before and after.

---

## CTA
Free 5-step guide in the bio. I'll walk you through the exact process—from any bad photo to a working screen, safely.

**Funnel:** PDF (lead magnet) → eventually MIRA (when they see the full plant namespace story).

---

## Production Notes
- **Money shot (critical):** The original operator-station photo MUST be recaptured if the original is lost. The handwritten label is the emotional anchor—it's proof the AI reads context, not just shapes.
- **Voice tone:** practitioner-curious. "Here's what surprised me." "The honest mistake was…" Not marketing language.
- **Banned phrases in narration:** "AI-powered," "seamless," "revolutionize." Say instead: "the AI read the panel," "it transcribed the label," "it took 30 seconds."
- **First 3 seconds wins:** must open on the bad photo, then immediately show the result. No intro, no logo, no talking head.
