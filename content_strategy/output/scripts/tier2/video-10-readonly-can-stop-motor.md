# Video 10: Read-only can still stop your motor (the RS-485 trap)

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
I wrote a "safe, read-only" scanner. It stopped a running motor. Here's why.

**Beat 2 — The promise (0:08–0:18)**
A scanner that only reads. Never writes. No command words. No risk. Just looking. So I thought.

**Beat 3 — The problem (0:18–0:35)**
RS-485 Modbus is single-master. The PLC is the master. I plugged in a second scanner as a "read-only" device. Instant problem: two masters on the same bus.

**Beat 4 — The cascade (0:35–0:52)**
The PLC polls the VFD every 50 milliseconds. My scanner polls too. Frames collide. CRC fails. After 5 seconds of lost comms, the VFD times out and shuts down the motor. All because I was only reading.

**Beat 5 — The lesson (0:52–0:58)**
Read-only doesn't mean side-effect-free on Modbus. Single-master is a law, not a guideline.

**Beat 6 — CTA (0:58–0:60)**
The fieldbus safety rules: free guide. Link in bio.

---

## Long-Form Outline (8–12 min)

### What I Built (0:00–1:30)
A discovery tool. Scan the RS-485 bus, find all the Modbus devices, list their models and parameters. Read-only. No writes. Pure scanning. It looked safe to me. [asset: plc/discover.py, `.claude/rules/fieldbus-readonly.md`]

### The Modbus Rule You Don't Think About (1:30–3:15)
Modbus RTU is asynchronous, half-duplex, single-master. One device talks at a time. The PLC (the master) sends a command to the VFD (a slave). The VFD replies. That's it. No other device on the bus is allowed to talk.

When I plugged in my read-only scanner, I broke that rule. Now TWO devices were trying to talk. The PLC was polling the VFD. I was polling the VFD. Frames collided. [asset: `.claude/rules/fieldbus-readonly.md` "hard invariant" section]

### What Happens When Frames Collide (3:15–5:30)
The RS-485 wires can't handle two devices at once. The signal gets corrupted. The CRC checksum fails. The receiving device — in this case, the VFD — sees garbage and discards it. The PLC, waiting for an answer, gets nothing.

The PLC retries. But now my scanner is also sending. More collisions. The PLC's polls keep failing. [asset: `.claude/rules/fieldbus-readonly.md` "two masters" section]

### The 5-Second Watchdog (5:30–7:00)
The GS10 VFD has a parameter: P09.03 Timeout Detection. Factory default: 5 seconds. This is a safety feature. If the PLC (the master) goes silent for 5 seconds, the VFD assumes the master is dead. What does a dead master mean? The PLC can't control me anymore. What does an uncontrolled VFD do? Shut down the motor.

So after 5 seconds of comms failures caused by my read-only scanner, the VFD triggered fault CE10 (comm loss) and the ladder logic on the Micro820 — the watchdog timer in `vfd_err_timer` — latched the fault. The motor stopped. [asset: `.claude/rules/fieldbus-readonly.md` "vfd_err_timer" reference; plc/Micro820_v4.1.9_Program.st watchdog section]

### Read-Only ≠ Side-Effect-Free (7:00–8:15)
This is the key lesson. A read-only operation (my scanner never wrote anything) still broke the system. It wasn't the write that caused the fault. It was the contention. Two masters on a single-master bus. By the time the fault happened, I had issued zero write commands. I was just reading. And the motor was stopped. [asset: `.claude/rules/fieldbus-readonly.md` full rule]

### The Fix: Bus Isolation (8:15–9:00)
The tool exists now, but with a guard: pass `--serial-bus-idle` to prove you have turned off the PLC. Or use the Ethernet version (Modbus TCP) — that's multi-master by design and side-effect-free because TCP handshakes don't collide like half-duplex serial. [asset: plc/discover.py source; `.claude/rules/fieldbus-readonly.md` "Ethernet scan is side-effect-free" section]

### The Takeaway (9:00–9:15)
Single-master fieldbus rules aren't negotiable. Even a "harmless" read can shut down your production line if you violate them. Know your bus. Know the rules. Enforce the rules before you plug anything in.

---

## Thumbnail Brief
**Layout:** Two master devices shown on the same RS-485 bus, with red lightning bolts between them indicating collision. On one side, a PLC. On the other, a generic scanner. Text: "⚠ TWO MASTERS = CHAOS"

**Text overlay:** "READ-ONLY ≠ SAFE"

**Key visual:** Two agents on one bus with collision symbols; a motor in the background transitioning from green (running) to red (stopped).

---

## CTA
The fieldbus safety rules: a free guide for anyone working with Modbus, RS-485, or industrial protocols. Single-master vs. multi-master, isolation gates, scan etiquette, and why your "harmless read" can fault-stop a motor. Download it. Read it before you plug anything into a live plant. [asset: `.claude/rules/fieldbus-readonly.md` + docs/specs/fieldbus-discovery-spec.md reformatted as a PDF]

**Funnel:** PDF
