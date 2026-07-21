# MIRA Print Translator Test — boundary-plc-ladder-rungs

## 1. Source & drawing metadata
- Publisher: University of Utah ECE 3510
- Title: Ladder Logic Fundamentals (PLC tutorial)
- Sheet: 3-rung example program
- Equipment: PLC ladder logic
- Standard: IEC 61131-3 ladder
- Category: plc_ladder
- Source URL: https://my.ece.utah.edu/~ece3510/Ladder%20Logic%20Fundamentals%20PLC%20tutorial.pdf
- Access date (UTC): 2026-07-21T07:46:39Z
- Original sha256: `c9f9a1c1bd5d236ce4dbd7ef62803b291f2501b425474ef2c3a23667f738bd3e`

## 2. Why selected
Boundary class 2: PLC rungs (contacts left, coils right) — a different visual grammar than field wiring.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This print is a training slide (MET 382, dated 1/14/2008, page 4 of "Ladder Logic Fundamentals") titled **"Anatomy of a Ladder Program (cont'd)"**. It is not a working machine schematic — it is an instructional diagram showing the structure of a ladder logic program.

**Top slide — "A 3-rung example ladder program":**

- **Rung 0** — comment: *"Use standard start/stop logic to control system start bit"*
  - Inputs: `Start` (I_PB0, `<Local:6:I.Data.0>`), `Stop` (I_PB1, `<Local:6:I.Data.1>`), `RSView_Stop`, `RSView_Start`, `B_System_On` (sealing contact)
  - Output: `B_System_On`

- **Rung 1** — comment: *"Control the dropline motor and the green stack light"*
  - Input: `B_System_On`
  - Outputs: `Motor` (O_Motor, `<Local:3:O.Data[11].0>`) and `Stack light - Green` (O_Green_Stack_LT, `<Local:3:O.Data[21].>`)

- **Rung 2** — comment: *"Control Product Stop #1"*
  - Inputs: `B_System_On`, `Photoeye 2` (I_PE2, `<Local:3:I.Data[0].2>`), `Photoeye 3` (I_PE3, `<Local:3:I.Data[1].0>`), `Shot pin down sensor` (I_Shot_Pin_Down, `<Local:3:I.Data[5].0>`), `Product Stop 2` (O_PS2, `<Local:3:O.Data[3].2>`), `Product Stop 1` (O_PS1, `<Local:3:O.Data[3].3>`)
  - Output (branch): `Product Stop 1` (O_PS1, `<Local:3:O.Data[3].3>`)

**Bottom slide — annotated version of Rung 0**, labeling the parts of a ladder instruction:

- **Rung Number** — the "0" at the left rail
- **Rung Comment** — *"Use standard start/stop logic to control system start bit"*
- **Description assigned to alias tag** — e.g., the word "Start"
- **Alias tag pointing to base address** — e.g., `I_PB0`
- **Base address** — e.g., `<Local:6:I.Data.0>`
- **Input Instruction** — the contact symbol on the rung

In short, the print teaches the reader how to read a ladder rung by identifying its number, comment, alias tag, base address, and instruction type, using a 3-rung example that latches a system-on bit, then drives a motor/light, then sequences product stops via photoeyes and a shot-pin sensor.

No DANGER / WARNING / CAUTION boxes, hard prohibitions, or reset/isolation/bypass instructions are printed on this sheet, so no safety section is required.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 33.98s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:47:14Z

## 9. Source URL
https://my.ece.utah.edu/~ece3510/Ladder%20Logic%20Fundamentals%20PLC%20tutorial.pdf