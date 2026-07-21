# MIRA Print Translator Test — boundary-pneumatic-iso1219

## 1. Source & drawing metadata
- Publisher: Festo Didactic (mirrored, Univ. de Guadalajara)
- Title: Fundamentals of Pneumatics (TP101)
- Sheet: 5/2 double-pilot valve speed-control circuit
- Equipment: pneumatic circuit
- Standard: DIN ISO 1219
- Category: pneumatic
- Source URL: https://lagos.udg.mx/sites/default/files/adjuntos/transparenciasneumaticaeng.pdf
- Access date (UTC): 2026-07-21T07:47:39Z
- Original sha256: `10a598553cf90422c8fd995f8c9685f37ac6d13f85ce528183cc4d97c8e6712c`

## 2. Why selected
Boundary class 6: ISO 1219 pneumatic circuit (double-acting cylinder, flow controls, 5/2 DCV, 3/2 PBs).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
# Circuit Diagram: 5/2-Way Double Pilot Valve (Speed Control)

## What the sheet shows

This is a Festo Didactic pneumatics training sheet (page 14) presenting a partially completed pneumatic circuit. The printed problem description states:

> "The piston rod of a double-acting cylinder is to move out upon manual actuation of a 3/2-way valve. The piston rod is to remain in its extended position until a second valve is actuated. After actuation of the second valve, the piston rod then moves back into its initial position. The piston speed should be adjustable in both directions."

## Components shown on the diagram

- **1A** — double-acting cylinder (top of diagram)
- **1V2, 1V3** — one-way (meter-out) flow control valves on the two cylinder ports
- **1V1** — 5/2-way double-pilot directional control valve (center, ports 1, 2, 3, 4, 5; pilot lines at 12 and 14)
- **1S1, 1S2** — two 3/2-way manually actuated (pushbutton/spring-return) valves at the bottom, each with its own exhaust port

## Printed assignment

- Complete the circuit diagram.
- Explain the functioning of the control.

## Printed flow-control requirement

- Supply air flow control
- Exhaust air flow control

## How the circuit functions (per the printed problem)

1. **Extend stroke:** Pressing **1S1** sends a pilot signal to port **14** of **1V1**, shifting the 5/2 valve. Supply air flows through port 4 → out port 2 to the cap end of **1A**. Air leaving the rod end passes through **1V3** (meter-out), so the extend speed is throttled by **1V3**. The 5/2 valve is bistable (double-pilot), so the cylinder stays extended after **1S1** is released.
2. **Retract stroke:** Pressing **1S2** sends a pilot signal to port **12** of **1V1**, shifting it back. Supply now flows from port 4 → out port 3 to the rod end of **1A**. Air leaving the cap end is metered out through **1V2**, so retract speed is throttled by **1V2**.
3. **Speed adjustment:** **1V2** sets retract speed; **1V3** sets extend speed. The sheet calls for both supply-side and exhaust-side flow control, which is achieved by the pair of one-way throttle valves **1V2 / 1V3** shown on the cylinder ports.

## Note on the sheet

The diagram as printed is incomplete — the pilot signal lines from **1S1** to port 14 and from **1S2** to port 12 of **1V1** are not yet drawn; completing those connections is part of the printed assignment.
```

- classification: **ELECTRICAL_PRINT** (conf 0.8)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 47.6s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:48:28Z

## 9. Source URL
https://lagos.udg.mx/sites/default/files/adjuntos/transparenciasneumaticaeng.pdf