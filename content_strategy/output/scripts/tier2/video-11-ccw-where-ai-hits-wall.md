# Video 11: Connected Components Workbench is where AI hits a wall

## Short Script (60s)

**Beat 1 — Hook (0:00–0:08)**
The logic was perfect. The compiler said yes. It just never made it onto the PLC.

**Beat 2 — The error (0:08–0:18)**
ErrorID 255. Connected Components Workbench threw it at me. I had no idea what it meant.

**Beat 3 — The confusion (0:18–0:32)**
The ST code was correct. The syntax was clean. The logic was sound. But CCW couldn't download it. Not a code problem. A deploy problem.

**Beat 4 — The cause (0:32–0:45)**
CCW lost sync with the PLC. The serial connection was flaky. A dropped byte here, a timeout there. By the time the download finished, the PLC and CCW had drifted.

**Beat 5 — The lesson (0:45–0:56)**
AI can't fix this. No algorithm writes away a bad serial port or a loose USB cable. This is where humans own the diagnosis.

**Beat 6 — CTA (0:56–0:60)**
The troubleshooting playbook: what to do when CCW won't deploy. Link in bio.

---

## Long-Form Outline (8–12 min)

### The Perfect Code That Wouldn't Deploy (0:00–1:45)
The AI wrote the state machine. I reviewed it (video 9). It compiled clean. No errors. I clicked "Download to PLC." CCW spun for a while. Then: ErrorID 255. Download failed. The logic was right. CCW was broken. [asset: plc/RESUME_VFD_COMMISSIONING.md "ErrorID 255" section]

### What ErrorID 255 Means (1:45–3:00)
It's a catch-all: "Something went wrong, but we're not telling you what." CCW lost synchronization with the PLC. Could be a timeout. Could be a corrupt frame. Could be a dropped byte. The download started, but somewhere in the middle, PLC and CCW disagreed on what was being sent.

I had no way to know which it was just from the error code. [asset: plc/RESUME_VFD_COMMISSIONING.md debugging narrative]

### The Usual Suspects (3:00–5:00)
I checked the easy things first:
- Syntax errors? No, the code compiled.
- Logic errors? No, the state machine was correct.
- PLC offline? No, I could see the IP address.
- Wrong program file? No, it was the right one.

So I started over with a simpler program — just a blink loop, nothing smart. Download succeeded. Now back to the full logic, piece by piece. Every time I added a section, the download got more fragile. [asset: plc/RESUME_VFD_COMMISSIONING.md incremental debugging]

### The Real Problem: USB Serial (5:00–7:15)
I was downloading over USB from my laptop to the Micro820. The USB-to-serial adapter had a cheap chip. Under load (downloading 200 KB of compiled code), it would drop frames. CCW tried to re-transmit, but the timing was off. The PLC thought it was done, CCW thought it was halfway through.

Solution: use the Ethernet connection instead. Ethernet is more robust. No more ErrorID 255. [asset: plc/RESUME_VFD_COMMISSIONING.md "Solution: switch to Ethernet" section]

### Why AI Can't Fix This (7:15–8:30)
This is the key lesson. The AI wrote good code. But the problem wasn't in the code. It was in the communications layer. An algorithm can't diagnose a bad USB cable. It can't fix a timeout in a serial driver. It can't tell you which protocol works with your hardware. This is where humans have to take the reins.

The AI helps with the logic. The human has to own the deployment infrastructure. [asset: plc/RESUME_VFD_COMMISSIONING.md full narrative]

### The Workaround (8:30–9:00)
You have three options:
1. Use Ethernet instead of USB serial.
2. Increase the timeout in CCW settings.
3. Break the download into smaller chunks and load them separately.

All three are human decisions. No AI, just troubleshooting discipline and knowing your tools. [asset: plc/RESUME_VFD_COMMISSIONING.md "Deployment strategies" section]

### The Takeaway (9:00–9:15)
"Correct code that won't deploy" is frustrating, but it's a solved problem. You just have to know where to look: the deploy layer, not the code layer. AI helps you get the code right. You get the deployment right.

---

## Thumbnail Brief
**Layout:** Connected Components Workbench screen on one side showing "ErrorID 255 — Download Failed" in red. On the other side, a checkmark next to "Code Syntax: OK." Big X between them.

**Text overlay:** "DEPLOY ≠ DONE"

**Key visual:** CCW UI with the error message, and a side-by-side comparison of "Code OK" vs. "Deploy Failed."

---

## CTA
The CCW deployment troubleshooting playbook: the three most common reasons your perfect code won't download, how to diagnose each one, and the exact steps to fix it. USB vs. Ethernet, timeout tuning, and when to chunk your downloads. Free guide in the description. [asset: plc/RESUME_VFD_COMMISSIONING.md reformatted as troubleshooting PDF]

**Funnel:** PDF
