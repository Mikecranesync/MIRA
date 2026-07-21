# MIRA Print Translator Test — boundary-relay-ladder-xref

## 1. Source & drawing metadata
- Publisher: Square D Company
- Title: Wiring Diagrams (File 0140, 1967 ed.)
- Sheet: 3-wire elementary control (holding contact)
- Equipment: relay ladder control circuit
- Standard: NEMA ICS elementary/ladder (JIC)
- Category: relay_ladder
- Source URL: https://archive.org/download/Square-d-wiring/Wiring%20Diagrams.pdf
- Access date (UTC): 2026-07-21T07:50:28Z
- Original sha256: `70dc072fb8e691cae9e37ecb601a8e613326fb95053babd903f41dd110bab567`

## 2. Why selected
Boundary class 1: relay ladder elementary control (START/STOP holding, CRs). 1967 ed cross-sheet callouts are lighter than the modern book (Schneider portal 403).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This is **Square D Company, "Wiring Diagrams — Typical Control Circuit Elementary Diagrams," dated January 1967, Page 5.** It shows six numbered 3-wire motor starter control schemes (Diagrams 3–8), each with a schematic and a brief printed description.

**Diagram 3 — 3 Wire Control with Pilot Light to Indicate when Motor is Running**
Circuit: L1 → STOP → START → M (starter coil) → O.L.'S → L2, with an M auxiliary contact sealing across START and a pilot light (R) wired in parallel with the M coil.
Printed note: *"A pilot light can be wired in parallel with the starter coil to indicate when the starter is energized and thus show that the motor is running."*

**Diagram 4 — 3 Wire Control with Pilot Light to Indicate when Motor is Stopped**
Same basic 3-wire circuit, but the pilot light (G) is fed through a normally closed M auxiliary contact.
Printed note: *"A pilot light may be required to indicate when the motor is stopped. This can be done by wiring a normally closed auxiliary contact on the starter in series with the pilot light as shown. When the starter is deenergized, the pilot light is on. When the starter picks up, the auxiliary contact opens, turning off the light."*

**Diagram 5 — 3 Wire Control with Push-To-Test Pilot Light to Indicate when Motor is Running**
Pilot light (R) is wired through a TEST pushbutton so the bulb can be checked independently of the motor state.
Printed note: *"When the motor running pilot light is not lit, there may be doubt as to whether the circuit is open or whether the pilot light bulb is burned out. The push-to-test pilot light enables the testing of the bulb simply by pushing on the color cap."*

**Diagram 6 — 3 Wire Control with Illuminated Push Button to Indicate when Motor is Running**
Combines the START button and pilot light (R) into one device. Printed note on the diagram: *"✱ PUSHING ON PILOT LIGHT OPERATES START CONTACTS."*
Printed description: *"The illuminated push button combines a start button and a pilot light in one unit. Pressing the pilot light lens operates the start contacts. Space is saved by requiring only a two unit push button station instead of three."*

**Diagram 7 — 3 Wire Control with Fused Control Circuit Transformer**
Adds a step-down transformer (PRI / X1 SEC X2) with a fuse on the ungrounded secondary side; secondary may be grounded "IF USED."
Printed note: *"A step down transformer can be used to provide a control circuit voltage lower than line voltage for reasons of operator safety. One side of the transformer secondary can be grounded when conditions permit. Short circuit protection for the transformer and control circuit is provided by a fuse in the ungrounded side of the transformer secondary."*

**Diagram 8 — 3 Wire Control with Fused Control Circuit Transformer and Control Relay**
Same transformer scheme as Diagram 7, but a CR (control relay) contact on the line side handles the high-VA starter coil, allowing a smaller transformer.
Printed note: *"A starter coil with a high volt-ampere rating may require a control transformer of considerable size. A control relay and a transformer with a low VA rating can be connected so that the normally open relay contact controls the starter coil on the primary or line side. Square D Size 5 Form FT starters use this scheme."*

**Common elements across all six:** L1/L2 power rails, a normally-closed STOP, a normally-open START, an M sealing contact, the M starter coil, and O.L.'S (overload contacts) in series with the coil.

No DANGER / WARNING / CAUTION boxes, hard prohibitions, or required reset/isolation/bypass instructions are printed on this sheet, so no safety section is required.

⚠️ Convention only — a print never shows live state. Verify with the circuit made safe and a meter before relying on it.
```

- classification: **ELECTRICAL_PRINT** (conf 0.8)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 27.59s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:51:04Z

## 9. Source URL
https://archive.org/download/Square-d-wiring/Wiring%20Diagrams.pdf