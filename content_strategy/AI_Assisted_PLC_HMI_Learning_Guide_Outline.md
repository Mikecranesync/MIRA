# AI-Assisted PLC and HMI Development: Lessons from Building MIRA

**Author:** Mike Harper — Founder, FactoryLM
**Format:** PDF learning guide (lead magnet / paid mini-guide candidate)
**Source of truth:** Built from real artifacts in the MIRA repo (PLC code, Ignition Perspective views, Modbus maps, demo HMIs, commissioning logs). Every chapter below points to the actual file or screenshot it draws on, so nothing in the final PDF is invented.

> **Positioning line for the cover:** *"I'm a maintenance guy, not a software engineer. In 30 days I used AI coding agents to program a real PLC, talk Modbus to a VFD, and turn a phone photo of a machine into a live HMI. Here's exactly how — what worked, what blew up, and what shocked me."*

---

## How to use this outline

This is the **chapter-by-chapter blueprint** for the PDF. Each chapter lists:
- **Covers** — the teaching content
- **Real proof** — the repo artifact that backs it (so the PDF shows screenshots/code, not claims)
- **Takeaways** — the 2–4 things a reader keeps
- **Figure needed** — what to screenshot/capture before publishing

Target length: **22–30 pages.** Tone: practitioner-to-practitioner, no hype, no "AI will replace you." The credibility comes from the scars.

---

## Front Matter

- **Cover** — title + the positioning line above. Background: the live conveyor HMI screenshot (`docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png`).
- **Who this is for** — maintenance techs, controls hobbyists, small-plant engineers, and "AI-curious" industrial people who can wire a panel but have never shipped code.
- **Who I am** — 1 paragraph. Maintenance background, building MIRA/FactoryLM, learned this in public over 30 days.
- **The one promise** — by the end you'll know how to point an AI coding agent at real automation hardware *safely*, and turn a machine photo into a working interface.
- **Safety disclaimer** — this is education, not a substitute for qualified commissioning, arc-flash/LOTO discipline, or your OEM's procedures. (Pull from the spirit of `.claude/rules/fieldbus-readonly.md` and the safety-keyword discipline already in the codebase.)

---

## PART 1 — The Setup: What I Was Actually Building

### Chapter 1 — The 30-day arc
- **Covers:** the honest timeline — from "can an AI even read a PLC program?" to a live conveyor that diagnoses its own faults and a web/HMI that renders it. Frame the whole guide.
- **Real proof:** git history shows the real progression — Ignition ST parser + tag export (May 11), photo→knowledge demo loop (May 20), schematic-photo vision (May 25), conveyor fault-detective engine + HMI (May 27), live PLC dashboard + operator panel (May 29).
- **Takeaways:** you don't need to know the destination; you need a real machine and a willingness to be wrong daily.
- **Figure needed:** a simple timeline graphic (can be generated).

### Chapter 2 — The rig
- **Covers:** the actual hardware/software stack so readers can copy it cheaply. Allen-Bradley **Micro820 2080-LC20-20QBB**, **AutomationDirect GS10 DURApulse VFD**, Modbus RTU over RS-485, **CCW (Connected Components Workbench)**, Ignition (Perspective), and the AI agents (Claude Code + ChatGPT).
- **Real proof:** `plc/GS10_Integration_Guide.md`, `plc/Micro820_v4.1.9_Program.st`, `plc/MbSrvConf_v4.xml`, `ignition/` project.
- **Takeaways:** a garage-scale rig (one PLC + one VFD + one motor) is enough to learn everything that matters.
- **Figure needed:** photo of the physical rig / wiring; bill of materials table.

---

## PART 2 — PLC Programming With an AI Coding Agent

### Chapter 3 — Letting an AI write Structured Text (ST)
- **Covers:** how AI actually helped write the Micro820 ladder/ST — state machine for the conveyor (idle → starting → running → stopping → fault), the value of versioning the program like code (v3 → v4.1.9), and reading a program you didn't hand-write.
- **Real proof:** the versioned ST programs in `plc/` (`Micro820_v3_Program.st` through `Micro820_v4.1.9_Program.st`) — a literal, visible record of iteration.
- **Takeaways:** treat PLC logic as source-controlled text; AI is great at refactors and explanations; you still own the I/O map.
- **Worked / Failed / Surprised callout (Worked):** version-controlling the ST file made every AI change reviewable and reversible.

### Chapter 4 — The human-in-the-loop bringup pattern
- **Covers:** the single most important workflow in the guide. The AI has terminal access but **cannot see the panel or touch energized hardware** — so you split the work: *"You check what you can see, I check what you cannot."* Phase-gated checklist, PASS / FAIL / NEEDS PHYSICAL CHECK, never skip a step, never proceed without operator confirmation.
- **Real proof:** `plc/PLC_BRINGUP_PROMPT.md` — the actual 9-phase bringup prompt (power check → network → discovery → IP set → project verify → variables → program load → download → force-output test → input verify).
- **Takeaways:** this pattern is the safe, repeatable way to use an AI agent on real automation hardware. **This chapter alone is worth the price of the guide.**
- **Figure needed:** the phase checklist as a clean one-page graphic.

### Chapter 5 — CCW: where the friction lives
- **Covers:** the unglamorous truth — the AI can write perfect logic, but CCW download/sync is its own beast. Serial-port config "out of sync," TCP download failures, the difference between "the program is right" and "the hardware received it."
- **Real proof:** `plc/RESUME_VFD_COMMISSIONING.md` — a real blocker log: *"the serial port Modbus RTU driver has NEVER been loaded onto the PLC hardware... TCPIPObject download fails... `ErrorID=255` = MSG block never completed."*
- **Worked / Failed / Surprised callout (Failed + Surprised):** I kept assuming the *program* was broken. It wasn't. The note to the AI literally says **"DO NOT rewrite the PLC program. v5.0.0 is correct. The problem is purely the CCW download/sync issue."** The lesson: AI's reflex is to rewrite code; sometimes the bug is in the tooling, not the logic.
- **Takeaways:** separate "is the logic correct?" from "did it actually deploy?" — they fail independently.

---

## PART 3 — Modbus and VFD Communication

### Chapter 6 — Talking Modbus RTU to a drive
- **Covers:** the concrete mechanics — RS-485 wiring (D+/D-/G to the GS10 RJ45 SG+/SG-/SGND), 9600 baud, 8N2 RTU, termination resistor over 30 ft, separate conduit from motor power. Read holding registers (FC03) for status, write single register (FC06) for commands.
- **Real proof:** `plc/GS10_Integration_Guide.md` §3 wiring + §4 serial config + §5 MSG block ST code; `plc/live_monitor.py`, `plc/vfd_diag.py`.
- **Takeaways:** Modbus is simple once you accept it's just "read these numbers, write those numbers."
- **Figure needed:** the RS-485 pinout/wiring diagram (already in the guide as ASCII — redraw cleanly).

### Chapter 7 — The register map that cost me days (the big "surprised")
- **Covers:** the trap that wrecks beginners — **the same drive family uses different register maps.** The original parameter doc was written for the **GS1**; the rig had a **GS10 DURApulse**. Command register moved from `0x2100` → `0x2000`, frequency setpoint `0x2101` → `0x2001`, and the command format changed from simple codes to a **bit field** (18 = RUN+FWD, 20 = RUN+REV, 1 = STOP).
- **Real proof:** `plc/GS10_Integration_Guide.md` §8 "What Was Wrong (Root Cause Analysis)" — the GS1-vs-GS10 comparison table.
- **Worked / Failed / Surprised callout (Surprised):** the AI confidently generated *correct-looking* code from the *wrong* manual. The failure wasn't reasoning — it was **source grounding.** Garbage manual in, garbage register out. This is the exact reason MIRA grounds every answer in the right document.
- **Takeaways:** always confirm the *exact* model and its register map before writing a single MSG block. This single insight is the spine of the whole MIRA product thesis.

### Chapter 8 — Fault codes and clearing them
- **Covers:** reading drive fault codes over Modbus, what CE10/F30 comm-timeout means, how to clear a fault (keypad STOP/RESET or write 2 to `0x2002`), and why `P09.02 = warn-and-continue` saves your sanity during commissioning.
- **Real proof:** `plc/GS10_Integration_Guide.md` §6 fault-code table + §2 register map.
- **Takeaways:** a comm fault is usually wiring, baud, or timeout — not the drive.

### Chapter 9 — Read-only by default: the safety rule that matters
- **Covers:** discovery and monitoring code must be **read-only**, and even "read-only" isn't side-effect-free on a live serial bus — two masters on an RS-485 line can fault-stop a running motor. Never sweep a live PLC-mastered bus.
- **Real proof:** `.claude/rules/fieldbus-readonly.md` (the real engineering rule in the repo) and `plc/discover.py` / `plc/live_monitor.py` (read-only) vs `plc/deploy_modbus_map.py` (deliberate writes).
- **Takeaways:** decide *write vs read* on purpose, per tool. This is how you let an AI near a plant without breaking it.

---

## PART 4 — The Headline: Turning Machine Images into HMIs

> This is the part that makes people stop scrolling. It's the visual "wait, you can do *that*?" moment.

### Chapter 10 — From photo to Perspective View
- **Covers:** the core trick — hand an AI coding agent a rough image of a machine, control station, or HMI screen, and have it reproduce the layout as an **Ignition Perspective View** wired to live tags. Even a bad front-facing webcam photo works; the AI picked up handwritten marker text ("PMC Station") off the panel.
- **Real proof:** the Ignition Perspective views in `ignition/project/com.inductiveautomation.perspective/views/` — **ConveyorStatus**, SpeedControl, FaultLog, NavBar, MiraPanel, MiraAlertHistory, ConnectSetup, MiraSettings — each is real JSON bound to tags like `Conveyor/VFD_Hz`, `VFD_Amps`, `VFD_DCBus_V`, `VFD_FaultCode`, `Motor_Running`, `EStop_Active`, `Conv_State`. Plus the source machine photos in `mira-core/data/photos/`.
- **Takeaways:** the AI isn't drawing a picture — it's producing a **functional, tag-bound interface** from a reference image.
- **Worked / Failed / Surprised callout (Surprised):** a low-quality webcam photo was enough; the agent transcribed handwritten panel labels and turned them into real UI text.
- **Figure needed (HIGH PRIORITY — capture before publishing):** the *before* (the original webcam/operator-station photo) and the *after* (the generated Perspective view), side by side. **This is the money shot of the entire guide.** See the "Screenshots to gather" section.

### Chapter 11 — The conveyor-image-to-HMI repeat
- **Covers:** proving it wasn't a fluke — searched the web for a "conveyor 3D image," snipped it, handed it to the AI, and got a conveyor HMI graphic. Did it twice on separate occasions. Then bound it to the live fault-detective pipeline.
- **Real proof:** `ignition/project/.../ConveyorStatus/resource.json` (the live-tag HMI) and the Node-RED 2D conveyor HMI in the Fault Detective demo (`docs/conveyor-fault-detective-demo/README.md`, screenshot `2026-05-27_fault-detective-chat-diagnosis_desktop.png`) — the SVG component IDs match the diagnostic engine's `affected_components` verbatim, so highlighting a faulted part is one line of code.
- **Takeaways:** reference image → HMI graphic → live data → self-diagnosing screen is a repeatable pipeline, not a one-off demo.
- **Figure needed:** the snipped conveyor reference image next to the rendered conveyor HMI.

### Chapter 12 — Wiring the HMI to the real backend
- **Covers:** how the generated screen becomes *live* — PLC → Modbus poll → MQTT/UNS topic → HMI binding. The Micro820 HR/coil map (HR106 `vfd_freq`, HR107 `vfd_current`, coil 0 `motor_running`, coil 5 `estop_active`) flowing to UNS topics and onto the screen.
- **Real proof:** `docs/conveyor-fault-detective-demo/README.md` "Live PLC overlay" tag table; `plc/live-plc-bridge/bridge.py`; `ignition/gateway-scripts/tag-stream.py`.
- **Takeaways:** the visual is the easy 20%; the binding to real tags is the valuable 80% — and the AI helps with both.

---

## PART 5 — Where This Becomes a Product: MIRA / FactoryLM

### Chapter 13 — From "cool trick" to "grounded maintenance assistant"
- **Covers:** why image-to-HMI matters commercially — it's the fast on-ramp to a **Maintenance Intelligence Namespace.** A photo becomes a screen becomes an asset becomes a place to hang manuals, fault history, and PMs.
- **Real proof:** `NORTH_STAR.md` (the flywheel), `STRATEGY.md` (the three offers), the Command Center web app (`docs/promo-screenshots/2026-05-30_command-center-LIVE-watching-nodered_desktop.png`) showing the UNS tree Enterprise → Home Garage → Conveyor Lab → Conveyor 1.
- **Takeaways:** the trick is the wedge; the namespace is the business.

### Chapter 14 — Grounding, confirmation, and "I don't know"
- **Covers:** the part that makes industrial buyers trust it — MIRA confirms the asset/location before troubleshooting, cites its source, and admits gaps. Demo: inject a blown F2 fuse, MIRA names "branch fuse loss, 95% confidence," lists evidence, and asks you to confirm the asset before giving steps.
- **Real proof:** the Fault Detective demo's UNS confirmation gate (`.claude/rules/uns-confirmation-gate.md`, demo README "Talk to MIRA" section), screenshot `2026-05-27_fault-detective-chat-diagnosis_desktop.png`.
- **Takeaways:** the difference between a toy chatbot and a tool a tech will trust at 2 AM is grounding + confirmation + citations.

---

## PART 6 — Lessons, Honest

### Chapter 15 — What worked
- Version-controlling PLC logic as text; AI-assisted refactors and explanations.
- The phase-gated, human-in-the-loop bringup prompt (`PLC_BRINGUP_PROMPT.md`).
- Image-to-Perspective-View — fast, repeatable, visually convincing.
- Grounding every answer in the correct source document.
- A garage rig (one PLC, one VFD, one motor) teaching the whole stack.

### Chapter 16 — What failed
- CCW serial-port download/sync — logic correct, deploy broken, `ErrorID=255` (`RESUME_VFD_COMMISSIONING.md`).
- The AI's reflex to rewrite working code instead of looking at the tooling.
- Trusting a parameter doc written for the wrong drive series (GS1 vs GS10).
- Comm faults masquerading as drive faults.

### Chapter 17 — What surprised me
- A bad webcam photo was enough to generate a working HMI — including handwritten labels.
- "Read-only" can still fault-stop a live motor (two-master RS-485 contention).
- The hard part of automation isn't the logic; it's the **grounding** and the **deploy**.
- An AI agent paired with a human's eyes-on-hardware beats either one alone.

### Chapter 18 — What beginners should know
- Confirm the exact model and register map *first*. Always.
- Treat PLC programs like source code: version, review, roll back.
- Keep discovery read-only; decide writes deliberately.
- Let the AI handle syntax and boilerplate; you own safety, I/O, and the physical checks.
- Don't let an AI touch energized hardware — pair it with your eyes instead.

### Chapter 19 — The next experiments
- Swap simulated vision booleans for a real camera (YOLOv8/Roboflow) feeding the same HMI.
- Auto-generate a Perspective View from a *single* uploaded asset photo end-to-end.
- Push the conveyor demo to a second asset (the UNS path already supports it).
- Voice memo → structured fault record (tribal knowledge capture).
- CMMS work-order write-back from the diagnosis.
- (All of these are listed as real cutlines in `docs/conveyor-fault-detective-demo/README.md` "What's intentionally NOT in this demo.")

---

## Back Matter

- **Appendix A — GS10 + Micro820 cheat sheet** (condensed from `GS10_Integration_Guide.md`: comm params, register map, command words, fault codes). High-value standalone — could be its own lead magnet.
- **Appendix B — The bringup prompt** (cleaned-up, redacted version of `PLC_BRINGUP_PROMPT.md` — remove the `C:\Users\hharp\...` paths and LAN IPs first).
- **Appendix C — Glossary** (PLC, VFD, HMI, Modbus RTU, RS-485, UNS, Perspective, CCW, ST).
- **CTA page** — "Want me to turn *your* machine photo into an HMI mockup? → [book a call / join the waitlist]" + FactoryLM/MIRA link.

---

## Screenshots / figures to gather before this PDF ships

| Priority | Figure | Where it goes | Status |
|---|---|---|---|
| 🔴 1 | Original operator-station webcam photo (the "PMC Station" one) | Ch.10 before/after | **Not in repo — locate original** |
| 🔴 2 | Generated Perspective View of that operator station | Ch.10 before/after | **Capture from Ignition** |
| 🔴 3 | Snipped conveyor reference image + rendered conveyor HMI | Ch.11 | Partially have (HMI yes, source snip TBD) |
| 🟡 4 | Physical rig photo (PLC + VFD + motor) | Ch.2 | Capture |
| 🟢 5 | Conveyor Fault Detective diagnosis screen | Ch.11/14 | ✅ `2026-05-27_fault-detective-chat-diagnosis_desktop.png` |
| 🟢 6 | Command Center UNS tree | Ch.13 | ✅ `2026-05-30_command-center-LIVE-watching-nodered_desktop.png` |
| 🟢 7 | ConveyorStatus Perspective view rendered | Ch.10/11 | Capture from Ignition (JSON exists) |

> **Redaction note for the PDF:** strip the Windows user path `C:\Users\hharp\...`, the VPS IP, Tailscale IPs, node hostnames, and Doppler/secret references before anything is published. Keep LAN IPs (192.168.x) only if needed for teaching; they're low-risk but cosmetic to remove.
