# Video 7: Modbus RTU to a VFD, explained by someone who just learned it

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
Modbus sounds like black magic. It's actually just: read these three wires, ask for numbers, send numbers back.

**Beat 2 — The hardware (0:08–0:18)**
Three wires. A, B, and ground. 9600 baud. No handshake. No flow control. The simplest protocol on the planet.

**Beat 3 — The read (0:18–0:30)**
My PLC asks the VFD: "Give me your output current." The VFD answers in one register. One command, one answer, 50 milliseconds.

**Beat 4 — The write (0:30–0:42)**
PLC sends: "Run forward at 50 Hz." The VFD runs. One register write. That's all.

**Beat 5 — Why this matters (0:42–0:56)**
You don't need a $50k integration. Micro820 + a 9600-baud serial port + a GS10 VFD = live control.

**Beat 6 — CTA (0:56–0:60)**
Free cheat sheet: every Modbus register, command word, and wiring pinout. Link in bio.

---

## Long-Form Outline (8–12 min)

### Why Modbus Still Owns (0:00–1:00)
It's 1985. Still works. No batteries. No firmware updates. RS-485 goes 4000 feet on twisted pair. Cheaper than networking. Plant floors still run on it. [asset: GS10_Integration_Guide.md intro]

### The Three Wires (1:00–2:30)
RJ45 jack on the GS10. Pin 5 is A (positive), Pin 4 is B (negative), Pin 3 is signal ground. Twist A and B together, braid the shield, keep it under 300 feet. You can buy a pre-made cable or build one in an afternoon. [asset: GS10_Integration_Guide.md § Wiring, photo of RJ45 pinout]

### Serial Settings: The One Gotcha (2:30–3:45)
GS10 Parameter P09.04 = 13 means "8 data bits, no parity, 2 stop bits, RTU mode." That MUST match your Micro820 serial port. If they don't agree, no comm. No error message. Just silence. 9600 baud for both. P09.01 on the VFD. [asset: GS10_Integration_Guide.md Table § Communication Parameters]

### The Command Register: 0x2000 (3:45–5:15)
To start the motor forward, you write the value 18 (hex 0x0012) to register 0x2000. The bits mean: bit 1 = "run", bit 3 = "forward." Write 20 (hex 0x0014) for reverse. Write 1 (hex 0x0001) to stop. That's Modbus Function Code 06 — write one register. [asset: GS10_Integration_Guide.md § Control Command register bit field table]

### The Speed Register: 0x2001 (5:15–6:30)
To set the frequency, write a number to 0x2001. The scale is value / 10. So to run at 30 Hz, write 300. To run at 60 Hz, write 600. This is live — the VFD responds in one poll cycle. [asset: GS10_Integration_Guide.md § Frequency Setpoint]

### Reading Back: Registers 0x2103–0x2105 (6:30–8:00)
After you command a run, you want to know: is it actually running? Read register 0x2103 (output frequency), 0x2104 (output current), 0x2105 (DC bus voltage). Use Function Code 03 — read holding registers. The PLC polls every 50 ms. You're watching the motor in real time. [asset: GS10_Integration_Guide.md § Status Registers table]

### The Micro820 MSG Block Setup (8:00–9:15)
In CCW ladder logic, the MSG_MODBUS block talks to the GS10. Node = 1 (matches P09.00 on the VFD). It reads and writes just like we described. Show the MSG block configuration: channel (serial port), baud rate, slave address. [asset: plc/Micro820_v4.1.9_Program.st excerpt or screenshot]

### CTA (9:15–9:30)
Free Modbus cheat sheet: every command word (FWD, REV, STOP, FAULT RESET), every status register, and the exact wiring pinout. Download it. Print it. Tape it to your wall. [asset: docs/guides/Modbus_RTU_Cheat_Sheet_GS10.pdf (to be generated)]

---

## Thumbnail Brief
**Layout:** GS10 VFD on the left, Micro820 PLC on the right, three RS-485 wires between them glowing. Modbus command words (0x2000, 0x2001) floating above the wires.

**Text overlay:** "0x2000 = RUN | 0x2001 = SPEED"

**Key visual:** VFD and PLC with highlighted wires and register addresses.

---

## CTA
Download the free Modbus RTU + GS10 cheat sheet. It lists every command, every status register, the serial settings, the wiring pinout, and the exact MSG block configuration for Micro820. [asset: GS10_Integration_Guide.md §7 "Quick Reference Appendix" reformatted as PDF]

**Funnel:** PDF
