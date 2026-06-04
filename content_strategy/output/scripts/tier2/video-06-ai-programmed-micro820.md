# Video 6: I let AI program my Allen-Bradley Micro820

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
I version-controlled my PLC program like software. Every change tracked, every fix reviewable, every mistake reversible.

**Beat 2 — Show the files (0:08–0:20)**
These are my actual Micro820 programs. v3, v4, v4.0.1, v4.1.9. Not documents. Not guesses. Real ladder logic and ST state machines the AI wrote.

**Beat 3 — The catch (0:20–0:35)**
AI got 95% right. I still wrote the I/O map by hand. I still built the safety interlocks myself. AI doesn't replace that.

**Beat 4 — Why this matters (0:35–0:50)**
When the motor stopped, I didn't have to rewrite from memory. I had a diff. I had blame. I knew exactly what changed.

**Beat 5 — CTA (0:50–0:60)**
Free guide: how to use AI safely inside a PLC program, line by line. Link in bio.

---

## Long-Form Outline (8–12 min)

### Before AI: Notes in a Drawer (0:00–1:30)
PLC programs lived in CCW. When you edited one, nobody knew why. You made notes. Sometimes. [asset: plc/README.md]

### Versioning Changes Everything (1:30–2:45)
I moved the ST code to git. Now every change has a message, a timestamp, a diff. You can see exactly what changed between v3 and v4. [asset: plc/Micro820_v3_Program.st → v4.1.9_Program.st in git log]

### The State Machine: Hand-Written + AI-Improved (2:45–5:00)
Walk through the conv_state machine in v4.1.9. Show the ST code. This is ladder logic turned into state handlers. AI helped structure it, but the safety rules (the 5-second watchdog for VFD comms failure, the fault_alarm latch) — those I wrote and verified by hand. Every single state transition is deliberate. [asset: plc/Micro820_v4.1.9_Program.st, lines showing state machine]

### The I/O Map: Non-Negotiable (5:00–6:30)
The physical wiring. Inputs: DI0=conveyor_motion_sensor, DI1=emergency_stop. Outputs: DO0=motor_run, DO1=motor_reverse. I assigned these. AI never touched this. I then had to commission each one live on the actual hardware. [asset: plc/MbSrvConf_v4.xml or a clean schematic of the I/O]

### Debugging With History (6:30–8:00)
Show a moment where the VFD stopped replying (a comm fault). Without versioning, you'd guess. With git: look at the last change to the Modbus poller logic. The diff shows exactly what changed. You can revert it in seconds or understand why the new code matters. [asset: git log --oneline plc/]

### Why You Can Trust This (8:00–9:00)
Because I never let AI touch the safety rules. Because I reviewed every change before committing. Because when something fails, I have proof of what changed and why.

### CTA (9:00–9:15)
Free guide on how to structure a PLC program for AI collaboration without losing control. Link in the description.

---

## Thumbnail Brief
**Layout:** CCW screen on the left showing Modbus logic, git diff on the right showing v3→v4.1.9 side-by-side. Big checkmark over the CCW side (human-verified), AI icon with an arrow pointing to the git side (AI-assisted, tracked).

**Text overlay:** "v3 → v4.1.9: Every Change Tracked"

**Key visual:** Split screen: CCW on one side, git log on the other.

---

## CTA
The free guide walks you through setting up a PLC codebase in git and what parts of a Micro820 program you can safely hand to AI (logic, state flow) versus what you always own (I/O assignments, safety interlocks, watchdog timers). [asset: to be written as PDF companion]

**Funnel:** PDF
