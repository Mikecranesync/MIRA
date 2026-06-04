# Video 9: How I let an AI agent near a live PLC without breaking the plant

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
Rule number one: the AI never touches energized hardware. I'm going to show you exactly how I made sure of that.

**Beat 2 — The split (0:08–0:22)**
I see what the AI can't. The wiring. The PLC connectors. The safety rules. The AI sees what I can't see fast. The logic, the patterns, the code structure.

**Beat 3 — The workflow (0:22–0:35)**
Nine phases. From idea to live. Every phase has a human check. The AI proposes. I verify. I decide when it goes on the PLC.

**Beat 4 — Phase by phase (0:35–0:50)**
Requirements, design, code, review, offline test, PLC syntax check, download, live test, lock it down. You check every single gate.

**Beat 5 — Why this works (0:50–0:58)**
The AI is fast. Humans are safe. Together: you get both.

**Beat 6 — CTA (0:58–0:60)**
Free playbook: the exact nine-phase bringup checklist. Link in bio.

---

## Long-Form Outline (8–12 min)

### Why This Matters (0:00–1:30)
Your plant runs on that PLC. If I let the AI write code and blindly download it, I'm risking production. So I built a workflow that gets the speed of AI without the risk. Nine phases. All the thinking happens before the download. [asset: plc/PLC_BRINGUP_PROMPT.md]

### Phase 1 — Requirements (1:30–2:30)
What are we building? A state machine for the conveyor. What are the states? IDLE, RUNNING, FAULT. What triggers each state? The sensor reads, the fault codes, the commands from Modbus. Write this down. Don't let the AI guess. You write the requirements. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 1 section]

### Phase 2 — High-Level Design (2:30–3:30)
How will the logic flow? Sensor input → state handler → motor output. Where does the watchdog timer go? How do we detect a comms fault? Sketch it on paper or a whiteboard. The AI will implement it, but YOU design it. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 2]

### Phase 3 — Code Generation (3:30–4:30)
Now ask the AI to write ST code for the state machine you designed. Be specific: "Three state handlers. One for each state. Each handler checks inputs, sets outputs, transitions to the next state." The AI will produce ladder or ST. You'll review every transition. [asset: plc/Micro820_v4.1.9_Program.st excerpt]

### Phase 4 — Code Review (4:30–5:45)
Read every line the AI wrote. Check for:
- Syntax errors (CCW catches most, but some slip through)
- Logic errors (does this transition make sense?)
- Missing edge cases (what happens if two inputs are true at once?)
- Watchdog timers (is the safety rule there?)

Mark up the code. Ask the AI to fix it. It will. You review again. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 4]

### Phase 5 — Offline Test (5:45–6:45)
Simulation mode. The PLC is running, but nothing is connected. Trigger the inputs manually in the emulator. Does the state machine transition correctly? Does the output happen? No real hardware. No risk. Run a dozen scenarios. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 5]

### Phase 6 — PLC Syntax Check (6:45–7:15)
Download the code to the PLC (in test mode, not run mode). CCW compiles it. Are there errors? If there are, the code never even executes. Fix them before moving on. [asset: plc/RESUME_VFD_COMMISSIONING.md "CCW ErrorID 255" section]

### Phase 7 — Download (7:15–8:00)
Only after all six phases above, download the code to the live PLC. But don't RUN it yet. It's sitting there, compiled, ready. You review it one more time in CCW. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 7]

### Phase 8 — Controlled Live Test (8:00–8:45)
Set the PLC to RUN. But use a single step or a slow cycle. Don't throw a real load at it. Watch the inputs change. Watch the state machine step through IDLE → RUNNING. Watch the outputs toggle. If something is wrong, you see it now, not when a motor starts spinning backward. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 8]

### Phase 9 — Lock It Down (8:45–9:15)
Only when phases 1–8 are all verified: enable full automation. Let the sensors drive it. Let Modbus commands control it. Now it's live. You can trust it because you checked every gate. [asset: plc/PLC_BRINGUP_PROMPT.md Phase 9]

---

## Thumbnail Brief
**Layout:** A flowchart with 9 boxes arranged in a staircase. Each box is a phase (Req, Design, Code, Review, Test, Syntax, DL, LiveTest, Lock). Checkmarks next to the human-owned steps (1, 2, 4, 5, 6, 8). Small AI icon next to the AI-owned steps (3, 7).

**Text overlay:** "HUMAN CHECK AT EVERY GATE"

**Key visual:** The staircase of 9 phases with alternating human (red) and AI (blue) icons.

---

## CTA
The free playbook is the exact nine-phase workflow I use every time I let an AI write code for a live PLC. Print it. Laminate it. Use it. It's the difference between a cool demo and production safety. [asset: plc/PLC_BRINGUP_PROMPT.md reformatted as a checklist PDF]

**Funnel:** PDF → Workshop (the live "photo-to-HMI" workshop uses this safety pattern)
