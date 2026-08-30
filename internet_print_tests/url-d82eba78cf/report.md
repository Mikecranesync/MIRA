# MIRA Print Translator Test — url-d82eba78cf

## 1. Source & drawing metadata
- Publisher: (direct URL)
- Title: https://support.automationdirect.com/docs/an-gs-021.pdf
- Sheet: None
- Equipment: None
- Standard: None
- Category: None
- Source URL: https://support.automationdirect.com/docs/an-gs-021.pdf
- Access date (UTC): 2026-07-21T10:16:39Z
- Original sha256: `888e8675d66be569e1b2fc90358e8f898b654f7d3801609f82f1ec1f00099f9d`

## 2. Why selected
operator-supplied --source-url

## 3. Exact Telegram bot response (verbatim, unmodified)

```
# Wiring Diagram Explanation (Page 5)

This is an AutomationDirect drive/VFD control terminal wiring diagram showing how an **EchoSpan** device is connected to the drive's analog input.

## Main Terminals Shown

**Control terminals (left column):**
- **+24V** (two terminals) — internal 24 VDC supply
- **DI1/FWD, DI2/REV, DI3–DI7** — digital inputs (DI1/FWD and DI2/REV are the dedicated forward/reverse run terminals)
- **DCM** — digital common
- **SCM, +24V, STO1, STO2** — Safe Torque Off circuit
- **+10V** — 10 V reference for analog inputs
- **AI1, AI2** — analog inputs (each with a DIP switch selecting **0–20 mA / 4–20 mA / 0–10 V**)
- **ACM** — analog common

**Power/communication terminals (right column):**
- **R1O, R1C, R1** — relay output contacts
- **AO1** — analog output (DIP switch: **0–10 V / 0–20 mA / 4–20 mA**)
- **Option Slot** and **USB Port**

## External Wiring (shown in blue)

1. **Run command:** A switch is wired between **DI1/FWD** and **DCM** — closing it commands forward run.
2. **EchoSpan transmitter:** Powered from an external **24Vdc** source.
   - **(+)** output → **AI2** terminal
   - **(−)** output → **ACM** terminal

## Critical Note Printed on the Sheet

> **"Please set the DIP switch for AI2 to 4-20 mA"**

This is required so the drive interprets the EchoSpan's 4–20 mA signal correctly on the AI2 input.

## What This Sheet Does NOT Show

- Drive model number, parameter settings, or scaling values for AI2
- Power input wiring (line/load terminals)
- Motor connections
- Any field device other than the EchoSpan

For those, refer to the drive's user manual and the EchoSpan datasheet.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 35.29s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **82/100** (B)
- hard failure: **False**
- summary: The response is well-structured and accurately captures the majority of the drawing's content, including the EchoSpan wiring, terminal layout, and the critical AI2 DIP-switch note. It loses points for the unsupported claim that AI1 also has a DIP switch (only AI2's is drawn), for stating 'Safe Torque Off' and 'dedicated forward/reverse' as fact rather than inference, and for omitting any mention of the visible 'AS IS' disclaimer or STO safety considerations.

## 5. Verified strengths
- Terminal list (+24V×2, DI1/FWD–DI7, DCM, SCM, +24V, STO1, STO2, +10V, AI1, AI2, ACM, R1O/R1C/R1, AO1, Option Slot, USB Port) matches the drawing exactly.
- EchoSpan (+) → AI2 and (-) → ACM wiring correctly traced from the blue lines.
- Run-command switch between DI1/FWD and DCM correctly identified.
- Red critical note 'Please set the DIP switch for AI2 to 4-20 mA' accurately quoted.
- AO1 DIP switch options (0-10V / 0-20mA / 4-20mA) match the visible AO1 switch block.

## 6. Suspected errors / hallucinations
- "AI1, AI2 — analog inputs (each with a DIP switch selecting 0–20 mA / 4–20 mA / 0–10 V)" — Only the AI2 DIP switch block (labeled 'AI2' at its base) is visible in the drawing; no DIP switch is shown adjacent to the AI1 terminal.
- "DI1/FWD and DI2/REV are the dedicated forward/reverse run terminals" — The drawing only shows the labels DI1/FWD and DI2/REV; it does not explicitly state these are 'dedicated' run terminals — this is an inference from the label text.
- "SCM, +24V, STO1, STO2 — Safe Torque Off circuit" — The drawing shows the STO1/STO2 labels and a jumper between them, but does not explicitly identify the function as 'Safe Torque Off' on this sheet.

## 7. Items requiring technician review
- Verify whether AI1 actually has a DIP switch on the physical drive (the drawing only depicts one for AI2).
- Confirm STO1/STO2 jumper configuration against the drive manual's STO wiring requirements before energizing.
- Cross-check the 'AS IS' disclaimer at the top of the sheet — this is an AutomationDirect technical-support illustration, not a formal drive manual.

## 8. Build & runtime
- commit: `c9cd6cc16b8a4cf67ee2bf0d92632118a5add360` · branch: fix/print-recall-staging-compose-passthrough · version: 3.184.1
- judge model: MiniMaxAI/MiniMax-M3 · run: 2026-07-21T10:48:48Z

## 9. Source URL
https://support.automationdirect.com/docs/an-gs-021.pdf