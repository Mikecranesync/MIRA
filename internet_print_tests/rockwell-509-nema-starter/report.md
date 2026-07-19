# MIRA Print Translator Test — rockwell-509-nema-starter

## 1. Source & drawing metadata
- Publisher: Rockwell Automation
- Title: Bulletin 509 NEMA Motor Starters — Wiring Diagrams (GI-WD005)
- Sheet: Bulletin 509 Sizes 7 & 8 — 3-Phase Starters, standard START-STOP pushbutton (booklet p.13)
- Equipment: NEMA 3-phase magnetic motor starter
- Standard: NEMA
- Category: motor_starter
- Source URL: https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf
- Access date (UTC): 2026-07-13T13:10:37Z
- Original sha256: `9d3f977104c86a6ee38aa3f85630a3ad9ff890ec138a43b0d85977479bde6993`

## 2. Why selected
Page index 12 of the Rockwell WD booklet is a genuine NEMA 3-phase magnetic-starter wiring diagram (verified by render 2026-07-13): incoming L1/L2/L3, current transformers 1CT/2CT/3CT (terminals 20-25), motor T1/T2/T3, START-STOP pushbutton station, CR control relay, K1/K2, A1X-A4Y coil terminals, overloads, and a separate-control-source ladder. Pages 0-3 are cover/intro/contents/key-to-symbols (text) — page 12 is the first dense starter schematic. Publicly published on literature.rockwellautomation.com; provenance verified 2026-07-10 (httpx 200/206 application/pdf).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Allen-Bradley Bulletin 509 three-phase full-voltage magnetic motor starter (Sizes 7 and 8), wired for a standard START-STOP push-button station — catalog wiring page 17.

This page documents an across-the-line 3-phase motor starter. Incoming lines L1/L2/L3 pass through the main contactor poles, through current transformers (1/2/3 C.T.) and the three overload elements (O.L.'s), then out to the motor as T1/T2/T3. The lower elementary (ladder) diagram shows the control logic: a separate control source, protected by a 1-amp fuse, runs through a normally-closed Stop button and a normally-open Start button (sealed in by a CR relay contact) to energize the control relay CR; a normally-closed overload contact in series drops the circuit out on overload. Because Sizes 7 and 8 use very large contactors, the operating coil is DC-fed: a rectifier bridge converts the control AC to DC, an economizer circuit (1 & 2 Econ. Cap. plus 1 & 2 Res. switched by CR contacts) lowers the coil holding current after pull-in, and a MOV (Mov.) suppresses coil transients.

🔑 Signals
• Three-phase supply in
• Motor output leads
• Stop command (opens control circuit)
• Start command (energizes/seal-in via CR)
• Control-relay coil energize
• Overload trip (drops control circuit)
• Contactor coil (DC) hold

🔧 Devices
• Three-phase motor (MOTOR (T1/T2/T3))
• Main contactor operating coil (DC, economizer) (M / (L.B.))
• Line current transformers (1C.T. / 2C.T. / 3C.T.)
• Three-pole overload relay (O.L.'s)
• Control relay with seal-in and economizer contacts (CR (coil K1/K2; contacts A1X..A4X / A1Y..A4Y))
• Rectifier bridge (AC-to-DC for coil) (Rect.)
• Surge-suppression varistor (Mov.)
• Economizer capacitors (1 Econ. Cap. / 2 Econ. Cap.)
• Economizer resistors (1 Res. / 2 Res.)
• Control-circuit fuse (FU (1A))
• Stop push button (NC) (Stop (1-2))
• Start push button (NO) (Start (2-3))

🩺 If you're chasing a fault
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• Abbreviation '(L.B.)' at the M coil/contact is not clearly decodable.
• Exact AC/DC terminal assignment on the rectifier bridge (which of 4/8/9/12) is hard to read.
• Terminal '13' appears both at CR coil (K2) and near the OL/Grd area — possible dual usage needs a clean crop.
• FU block digit sequence '1 2 3 4 6 7' (whether '5' is intentionally skipped).
…and 1 more (see 'map')

⚠️ No voltage is printed on this sheet — neither the incoming line voltage nor the 'Separate Control Source' level is shown, so do not assume a value; treat the circuit as potentially lethal until measured. For continuity/resistance checks (Stop/Start contacts, coil, OL contact, capacitors, resistors) de-energize, lock out, and verify absence of voltage first. If live voltage checks are required to isolate coil vs OL, follow energized-work procedures with properly rated meters and PPE. Note that this is a generic catalog diagram and may not reflect the exact as-built panel.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 169.84s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **83/100** (B)
- hard failure: **False**
- summary: The response correctly identifies the sheet (Bulletin 509, Sizes 7 & 8, 3-phase starter with START-STOP station) and gives a generally accurate, well-hedged account of the DC-coil/rectifier/economizer control scheme, with no invented voltages or device tags and appropriate uncertainty flags on genuinely ambiguous marks. Its main weaknesses are an unaddressed set of lamp-like symbols near the top of the diagram and a somewhat speculative (though hedged) merging of the 'M' coil and '(L.B.)' contact into one device with combined terminals. No hard failures were found.

## 5. Verified strengths
- Sheet identity (Bulletin 509, Sizes 7 & 8, START-STOP pushbutton, 3 Phase Starters) matches the drawing's title block and footer exactly.
- Correctly identifies the DC-coil/rectifier/economizer architecture visible via 'Rect.', 'Mov.', '1/2 Econ. Cap.', '1/2 Res.' blocks.
- Appropriately flags ambiguous/illegible items ('(L.B.)', rectifier terminal numbers, FU sequence gap) instead of asserting them as fact.
- Correctly notes the absence of any printed voltage value on the sheet and gives appropriate lockout/tagout safety guidance.

## 6. Suspected errors / hallucinations
- "Contactor coil (DC) hold — M / (L.B.) @ 6-7-8-9 → pulls in main contactor via rectifier + economizer · conf 0.60" — The drawing shows 'M' coil (6-M-9) and a separate '(L.B.)' contact (7-8) as distinct symbols; merging them into one device with a single terminal range is a simplification not clearly supported by the drawing, though it is appropriately hedged with low confidence.

## 7. Items requiring technician review
- Meaning of '(L.B.)' abbreviation near the M coil/contact
- Exact rectifier bridge terminal assignment (4/8/9/12)
- Dual appearance of terminal '13' at CR coil (K2) and near the OL/Grd area
- Whether '5' is intentionally omitted from the FU terminal block sequence
- Identity/function of the four unlabeled lamp-like (⊗) symbols near the top of the diagram, which the response never addresses

## 8. Build & runtime
- commit: `8379b7cb8fc00324590aabd2f054a212dc2a55b5` · branch: feat/internet-print-test-runner · version: 3.137.1
- judge model: claude-sonnet-5 · run: 2026-07-13T13:25:34Z

## 9. Source URL
https://literature.rockwellautomation.com/idc/groups/literature/documents/wd/gi-wd005_-en-p.pdf