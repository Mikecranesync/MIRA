# Video 2: Claude Code built an Ignition Perspective screen from a conveyor image

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
I Googled "conveyor 3D diagram." Snipped a stock image. Asked Claude Code to turn it into a real HMI.

**Beat 2 — The snip (0:08–0:15)**
One image. No manual. No specs. Just a generic reference diagram and a prompt: "Make this a live interface."

**Beat 3 — The build (0:15–0:25)**
Perspective View JSON came back. I dropped it into Ignition. Wired it to tags. Now the sensors light up green. One goes red. Back to green. Works.

**Beat 4 — The test (0:25–0:38)**
I did this twice with different reference images. Both times it worked. Not a fluke. A pattern.

**Beat 5 — The pipeline (0:38–0:48)**
The repeatable part: reference image → AI generates the HMI → bind the component IDs to your PLC tags → done.

**Beat 6 — CTA (0:48–1:00)**
Free guide in the bio. Shows the exact pipeline I use. Works on any machine image.

---

## Long-Form Outline (8–12 min)

### Intro (0:00–1:00)
You don't need a schematic. You don't need a manual. I took a stock image of a conveyor, fed it to Claude Code, and got back a working Ignition Perspective screen in 60 seconds. Here's how.
[asset: 2026-05-27_fault-detective-chat-diagnosis_desktop.png]

### The Starting Point: A Google Image (1:00–2:15)
Show the snipped conveyor reference image.
- This is a freely available, generic 3D render. No proprietary data. No exact match to any customer equipment.
- Most people think "that's not enough information." But the AI sees structural patterns—motors, belts, sensors, flow direction.
- Explain: why this works is not magic; conveyor design is standardized. Six motors, two belts, start/stop controls, sensor indicators. The AI has seen this pattern 10,000 times.
[asset: the conveyor reference image or similar stock photo]

### The Prompt & The First Result (2:15–4:00)
Read the prompt on screen.
- "Make this an Ignition Perspective View. Show active sensors as green, faulted sensors as red. Include start/stop buttons."
- Walk through what the AI generated: a 2D conveyor belt graphic, four sensor indicators (proximity switches), motor speed feedback, E-stop button.
- Show the JSON structure—component positions, tag bindings, color logic.
- The AI didn't invent anything; it *arranged* standard controls in a way that makes industrial sense.
[asset: ignition/project/.../ConveyorStatus view JSON, or clean screenshot]

### Live Binding: The Component ID Trick (4:00–5:45)
This is the move that makes it repeatable.
- Every component the AI generates gets a semantic name: `sensor_1_proximity`, `motor_run_button`, `fault_indicator`.
- I don't manually wire each one. Instead, I map those semantic names to my PLC tag namespace in one table.
- Show the tag table: [Component ID] → [PLC tag path].
- Now when a tag updates, the corresponding component highlights automatically.
- Explain: the AI gave you the structure; the tag table lets you own the mapping. You change the tag name, not the HMI.
[asset: tag-binding table screenshot, or mira-mcp/server.py tool showing the mapping]

### The Live Test (5:45–7:30)
Show the HMI connected to real tags.
- Manually trigger a sensor (or show a PLC write) and watch the HMI component light up green.
- Inject a fault—sensor goes red. Stays red until the fault clears.
- Demonstrate one more control: press the start/stop button, see motor_run toggle on the tag, watch the motor indicator respond.
- Narrate: "This is the moment it stops being a picture and becomes an interface."
[asset: screen recording of Ignition HMI + live tag updates, Fault Detective demo for reference]

### The Repeatable Pattern (7:30–9:00)
Walk through the pattern I use every time.
- **Step 1:** Find or snap a reference image (stock photo, schematic, or a photo of a similar machine).
- **Step 2:** Prompt: describe what you see, then build an HMI.
- **Step 3:** Extract the semantic component IDs from the JSON.
- **Step 4:** Map those IDs to your PLC tag namespace (one table, 5 minutes).
- **Step 5:** Bind in Ignition, test on tags, deploy.
- Emphasize: once you have the mapping table, you've solved this machine type for the next person. Reuse.
[asset: flowchart or diagram of the 5-step pipeline]

### Why It Works (or Doesn't) (9:00–10:30)
Honest talk about the limits.
- **This works best** for standard equipment (conveyors, presses, packaging lines) where the structure is recognizable.
- **This struggles** with unique designs, where only the OEM manual shows the true control relationships.
- **The middle ground:** use the AI-generated layout as a draft. You spend 10 minutes reviewing and adjusting it, not 3 hours drawing from scratch.
- The video you're watching isn't "AI replaces engineers." It's "AI generates a draft that a one-person team can deploy instead of waiting for an integrator."
[asset: screenshot of a layout the AI got right vs. one that needed tweaking]

### One-Line Highlight: The Highlight Trick (10:30–11:15)
Show the diagnostic engine using the same component IDs to highlight faults.
- When MIRA diagnoses a conveyor fault ("motor_1 bearing temp high"), it sends a message that says "highlight motor_1_body red."
- The component ID is the bridge between the diagnosis engine and the visual interface.
- Same reference image → same component names → same interface understands the fault.
- This is how a chatbot knows which part of your screen to make red when it says a part is failing.
[asset: Fault Detective demo screenshot showing highlighted component + MIRA chat alongside]

### Closing & CTA (11:15–12:00)
I've documented this pipeline in a free guide. It includes the prompt template, the tag-binding table format, and three worked examples with different machine types (conveyor, pump station, packaging line). The guide also covers what to do when the AI generates a layout you don't like—when to accept it, when to redraw.
[asset: screenshot of lead-magnet PDF cover]

---

## Thumbnail Brief
**Layout:** Left side: the snipped conveyor stock image (generic, clean). Right side: the rendered green-and-red HMI with active sensors. Arrow between them.
**Text overlay:** "GOOGLE IMAGE → LIVE HMI" (top), "Works Every Time" (bottom).
**Key visual:** The simplicity of the input (a stock photo) vs. the functionality of the output (a real interface with live indicators).

---

## CTA
Free pipeline guide in the bio. Shows the exact 5 steps and three worked examples.

**Funnel:** PDF (lead magnet) → Workshop (live cohort where they try it on their machine photo).

---

## Production Notes
- **Voice tone:** "I tested this twice. Both times it worked. Not a miracle, just a repeatable pattern."
- **The repeatable part is the star:** emphasize that the pattern works on *any* standard machine type, not just conveyors. This is the wedge into the workshop funnel.
- **Banned phrases:** "Generative AI," "cutting-edge," "unlocks." Say instead: "the AI generated," "it arranged," "component IDs let you reuse."
- **First 3 seconds wins:** open on the snipped reference image, then immediately show the HMI rendering. The contrast is the hook.
- **Asset to source:** need a clean stock conveyor image or a similar reference diagram. The 2026-05-27 Fault Detective screenshot is the target output.
