# Video 8: The register map that cost me 3 days (GS1 vs GS10)

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
The AI wrote perfect code. From the wrong manual. The motor never moved.

**Beat 2 — The problem (0:08–0:20)**
I had a GS10 VFD. The manual was for GS1. Same drive family. Different registers. The AI didn't know that.

**Beat 3 — The proof (0:20–0:35)**
GS1 command register: 0x2100. GS10 command register: 0x2000. The code wrote to 0x2100. The drive had no idea what was happening.

**Beat 4 — The debug (0:35–0:48)**
Three days of "the motor won't run." Checking wiring. Checking comms. No errors. Just... nothing. Then I found it: two registers, same family, different names.

**Beat 5 — The lesson (0:48–0:58)**
Grounding beats fluency. AI is fast. Humans are right. Always verify the model before you trust the manual.

**Beat 6 — CTA (0:58–0:60)**
Never again. MIRA uses your real equipment data. Link in bio.

---

## Long-Form Outline (8–12 min)

### The Setup (0:00–1:30)
I had a Micro820 and a GS10 VFD sitting on my bench. I took a photo of the nameplates and asked Claude to write the Modbus code. It came back perfect-looking: MSG_MODBUS block, handshake logic, error handling. Textbook Modbus. [asset: plc/RESUME_VFD_COMMISSIONING.md]

### The Wrong Manual (1:30–3:00)
Claude's code referenced the GS10 manual. Good. But when I looked at the PDF, the section on command registers said register 0x2100 for run/stop. I didn't double-check — I just trusted the PDF was right. The code went straight into the PLC. [asset: GS10_Integration_Guide.md vs. a GS1 manual comparison]

### The Silent Failure (3:00–5:30)
I deployed the code. The Micro820 came up. The serial port connected. The MSG block showed "success." But the VFD never ran. No error. No fault light. Just dead. So I checked:

1. Wiring — three wires, twisted, terminated. Correct.
2. Baud rate — 9600 on both sides. Correct.
3. Node address — P09.00 = 1 on the VFD, Node=1 in the MSG block. Correct.
4. The code — looked right to me.

Silence is the worst error code. No indication of what's broken. [asset: plc/RESUME_VFD_COMMISSIONING.md debugging section]

### The Clue (5:30–6:45)
I grabbed a Modbus monitor. Real time, I saw the Micro820 writing to register 0x2100. The GS10 was receiving the frames (good CRC). But the GS10 was NOT changing state. Then I checked the GS10 manual **one more time** and saw a footnote: "Older GS1 models use 0x2100. GS10 and later use 0x2000."

Same drive family. Two registers. One word off. No warning. No error. Just a silent mismatch.

### The Fix (6:45–7:30)
Change 0x2100 to 0x2000 in the code. Recompile. Download. Motor runs immediately. Everything else was right. It was just the register address. [asset: plc/Micro820_v4.1.9_Program.st showing correct 0x2000, or a git diff showing the fix]

### Why This Is the Heart of MIRA (7:30–9:00)
This is why grounding beats fluency. The AI was fluent in Modbus. It wrote textbook code. But without **your real equipment data**, it picked the wrong manual. MIRA doesn't guess. It reads your nameplate. It looks up the drive model in your plant. It cites the right manual, the right register, the right parameter. That's the difference between a chatbot and actual help.

### The Real Lesson (9:00–9:15)
Always verify the model number before you trust the manual. Always check the part number on the hardware. Always cite what you're reading from. The AI made a 300-line PLC program perfect in 10 minutes. But one line — one register address — cost me three days because it came from the wrong source.

---

## Thumbnail Brief
**Layout:** Two register maps side by side. Left side (GS1): register 0x2100 with a red X over it. Right side (GS10): register 0x2000 with a green checkmark. Bold text: "0x2100 ≠ 0x2000"

**Text overlay:** "WRONG MANUAL"

**Key visual:** The two hex addresses, large, with a big visual clash between them. Red and green. X and checkmark.

---

## CTA
MIRA reads your real equipment data — model numbers, serial numbers, nameplate photos. It doesn't guess which manual to use. It cites the right one, the right registers, the right parameters. That's why one technician's hunch never stops a motor again. [asset: mira-hub/docs/cmms-integration or nameplate-reader feature]

**Funnel:** MIRA
