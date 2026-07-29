# MIRA Print Translator Test — automationdirect-click-plc-io

## 1. Source & drawing metadata
- Publisher: AutomationDirect
- Title: CLICK PLC Hardware User Manual — Ch.3 Installation and Wiring (C0-USER-M)
- Sheet: Ch.3 — DC Input & Output Wiring Methods, sinking/sourcing (p.3-31)
- Equipment: PLC discrete I/O module
- Standard: Industrial 24VDC
- Category: plc_io
- Source URL: https://cdn.automationdirect.com/static/manuals/c0userm/ch3.pdf
- Access date (UTC): 2026-07-13T20:34:21Z
- Original sha256: `82e374d7253644771a0f40b2845b6d4935fd1f22fb81b1537669ee64e57e6313`

## 2. Why selected
Page index 30 is a genuine 24 VDC PLC discrete-I/O wiring diagram (verified by render 2026-07-13): sinking/sourcing DC inputs, NPN/PNP field-sensor termination (Input/Common, DC NPN Sensor sinking, DC PNP Sensor sourcing, Field Device, Supply, Ground, 20-28 VDC), and DC output-to-load wiring. Completely different category/standard from the NEMA starter. Publicly published OEM chapter PDF; provenance verified 2026-07-10.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Manual page 3-31 (CLICK PLC Hardware User Manual, Ch. 3) showing generic DC input and DC output wiring methods between PLC I/O points and field devices.

This page teaches how to wire CLICK PLC DC I/O to field devices, not a specific machine. The DC input point is drawn as an opto-coupler with dual (anti-parallel) diodes, so it can be wired either sinking or sourcing. Example 1: an NPN (open-collector) sensor that sinks current is paired with a PLC input wired sourcing, with an external DC supply feeding the Common terminal. Example 2: a PNP (open-emitter) sensor that sources current is paired with a PLC input wired sinking, and no extra module supply is needed because the field loop already sources current. Example 3 (output side): a PLC DC output wired sinking drives a field-device load with a sourcing input, powered by a 20-28 VDC supply. Stated ranges: DC inputs ~+12-24 VDC, DC outputs ~+5-24 VDC.

🔑 Signals
• NPN sensor output signal into the PLC (sensor sinks, PLC sources)
• PNP sensor output signal into the PLC (sensor sources, PLC sinks)
• PLC output signal to the field-device load (PLC sinks to Common)
• Supply power to PLC Common / field loop (input examples)
• 20-28 VDC loop power for the output example

🔧 Devices
• Generic PLC DC input point (dual-diode opto-coupler, wireable sinking or sourcing) (PLC DC Input)
• Open-collector NPN field sensor (sinking) (DC NPN Sensor (Sinking))
• Open-emitter PNP field sensor (sourcing) (DC PNP Sensor (Sourcing))
• PLC DC output point (sinking, transistor/MOSFET) (PLC DC Output)
• Field-device load with a sourcing input (Field Device)
• External DC supply for input loop (Supply)
• 20-28 VDC supply for output loop (20-28 VDC)

🩺 If you're chasing a fault
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• No device tags, wire numbers, terminal numbers, or PLC channel addresses are printed — this is a generic method illustration.
• No specific CLICK module part number is identified for the illustrated I/O points.

⚠️ Voltages printed on this page: DC inputs typically +12-24 VDC, DC outputs typically +5-24 VDC, and the output example uses a 20-28 VDC supply — no higher/AC levels are shown, and this is a generic reference, not proof of your actual field conditions. For continuity/resistance checks on wiring, de-energize, lock out, and verify absence of voltage first. For live signal/voltage checks on the low-voltage DC loops, use appropriately rated meters and follow energized-work procedures. The drawing does not establish the real installed voltage of your specific panel.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 120.06s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **42/100** (F)
- hard failure: **True**
- summary: The response correctly identifies the sheet, purpose, and most sinking/sourcing input wiring paths, and cites voltages accurately from the page. However, the 'map' follow-up confidently (0.85) mis-states the output-circuit topology by merging the '+DC Power/Power' terminal with the separate 20-28 VDC supply node shown in the Common-to-Ground return path, an incorrect terminal/connection claim presented as fact, which caps the grade at F despite otherwise solid generic descriptions.

## 5. Verified strengths
- Correctly identifies the page/section as CLICK PLC manual Ch.3 p.3-31 DC Input/Output Wiring Methods.
- Correctly captures the NPN sinking sensor -> PLC sourcing input wiring with external Supply in the Common/Ground return path, matching the diagram.
- Correctly captures the PNP sourcing sensor -> PLC sinking input wiring with no additional supply needed, matching the diagram text 'no additional power supply is required for the module.'
- Correctly cites all printed voltage ranges (+12-24 VDC, +5-24 VDC, 20-28 VDC) without inventing new values.
- Appropriate generic safety/LOTO language for a low-voltage DC training diagram.

## 6. Suspected errors / hallucinations
- "20-28 VDC loop power for the output example — 20-28 VDC @ Power / +DC Power → PLC DC Output and field-device load loop" — The drawing shows '+DC Power' feeding a separate 'Power' terminal on the PLC DC Output block, while the 20-28 VDC battery symbol sits in the Common-to-Ground return path (consistent with the 'Supply' battery placement in the NPN input example above it); conflating these two nodes is not supported by the visible layout.
- "Supply(+) -> load Input (sourcing) — power conductor" — Per the drawing's wiring pattern, the direct signal path is PLC 'Output (sinking)' to Field Device 'Input (sourcing)'; the supply is inserted in the Common-Ground return path, not directly wired to the load's Input terminal.

## 7. Items requiring technician review
- Verify actual node connections of the 'Power'/'+DC Power' terminal versus the 20-28 VDC supply in the PLC DC Output diagram before relying on the assistant's stated loop topology.
- Confirm whether '+DC Power' and the 20-28 VDC supply are electrically the same net or two independent supplies before troubleshooting an output circuit based on this page.

## 8. Build & runtime
- commit: `a5be72afa0a6396b225fefeb751e30cedeeecc2f` · branch: feat/internet-print-test-runner · version: 3.137.2
- judge model: claude-sonnet-5 · run: 2026-07-13T20:49:15Z

## 9. Source URL
https://cdn.automationdirect.com/static/manuals/c0userm/ch3.pdf