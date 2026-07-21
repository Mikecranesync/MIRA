# MIRA Print Translator Test — boundary-multipage-xref

## 1. Source & drawing metadata
- Publisher: WiredWhite
- Title: IEC Schematic Learning Resource VER1.1
- Sheet: DOL control circuits (page 6) — coils K1-K4; power main contacts on page 3 (NOT in this view)
- Equipment: IEC DOL motor control
- Standard: IEC 60204-1 / IEC 60617 (/sheet.gridref xref)
- Category: multipage_xref
- Source URL: https://wiredwhite.com/wp-content/uploads/2025/10/IEC-Schematic-Learning-Resource-VER1.1.pdf
- Access date (UTC): 2026-07-21T07:48:31Z
- Original sha256: `b316c5db01b3eff8165f807751a9c447d201967cf77a431971d8379d868b19d1`

## 2. Why selected
Boundary class 10: cross-page reasoning. Only the control sheet (p6) is submitted; the power contacts it switches are on p3 (not shown). Tests HONEST 'that sheet is not in view' behavior vs fabrication.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
# Fan & Feeder DOL Control Circuits — Page 5 of 16

**Sheet identity (title block):**
- Page Title: "Fan & Feeder DOL Control Circuits"
- Project: "IEC Sample"
- Drawing: "IEC Schematic Learning Resource VER1"
- Created 3 Feb 2025 / Edited 28 Feb 2025

**Power rails:**
- Top rail: **24V-4** (24 V DC control supply, fed from 24V-4/4.A14 on the left, continuing out as 24V-4/6.H5 on the right)
- Bottom rail: **0 VDC** (common, fed from 0 VDC/4.I13, continuing out as 0 VDC/6.I1)

**Rung 1 — Fan 1 Start/Stop (left column):**
24V-4 → **TOR1** (NC contact, 95–96) → **PB1 "Fan 1 Start"** (NO, X4-4/X4-5) in parallel with **K1** sealing contact (13–14) → **PB2 "Fan 1 Stop"** (NC, X4-6/X4-7) → **K1 coil** (A1–A2) → 0 VDC. Indicator **PL1 "Fan 1 ON"** is wired across the K1 coil (X1–X2).

**Rung 2 — Fan 1 Motor Trip:**
24V-4 → **TOR1** (NC contact, 97–98) → **PL2 "Fan 1 Motor Trip"** → 0 VDC. Lamp illuminates when TOR1 trips.

**Rung 3 — Fan 2 Start/Stop:**
Same topology as Rung 1 with **TOR2**, **PB3 "Fan 2 Start"**, **K2** sealing contact, **PB4 "Fan 2 Stop"**, **K2 coil**, and **PL3 "Fan 2 ON"**.

**Rung 4 — Fan 2 Motor Trip:**
**TOR2** (97–98) → **PL4 "Fan 2 Motor Trip"** → 0 VDC.

**Rung 5 — Fan 3 Start/Stop:**
Same topology with **TOR3**, **PB5 "Fan 3 Start"**, **K3** sealing contact, **PB6 "Fan 3 Stop"**, **K3 coil**, and **PL5 "Fan 3 ON"**.

**Rung 6 — Fan 3 Motor Trip:**
**TOR3** (97–98) → **PL6 "Fan 3 Motor Trip"** → 0 VDC.

**Rung 7 — Feeder Manual / Jog:**
24V-4 → **TOR4** (95–96) → **SS2** selector switch in "Manual/Auto" position → **PB7 "Feeder Jog"** (NO, X4-22/X4-23) → **K4 coil** (A1–A2) → 0 VDC. **PL7 "Feeder ON"** is wired across K4.

**Rung 8 — Feeder Auto:**
Fed from **24V-5/6.C8** → **SS2** selector switch in Auto position → **R5 "Feeder Auto Relay"** coil (terminals 11–14) → 0 VDC via **I0.4/6.D8**.

**Cross-references (bottom of sheet) — coil contact locations on other pages:**
- **K1**: /2.D4, /5.H1, /5.C2
- **K2**: /2.D6, /5.H4, /5.C6
- **K3**: /2.D9, /5.H7, /5.C9
- **K4**: /2.D12, /5.H11
- **R5**: /5.D12, /6.H7

**Summary:** This is the 24 V DC control rung section for three DOL-started fans (each with Start/Stop PB, sealing contactor, thermal overload, and ON/Motor-Trip lamps) and one feeder with a Manual/Auto selector (SS2) feeding either a Jog pushbutton (K4) or an Auto relay (R5). The contactor coils K1–K4 and relay R5 are referenced on other pages of the drawing set.

No DANGER / WARNING / CAUTION boxes, hard prohibitions, or reset/isolation/bypass instructions are printed on this sheet.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 69.84s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:49:41Z

## 9. Source URL
https://wiredwhite.com/wp-content/uploads/2025/10/IEC-Schematic-Learning-Resource-VER1.1.pdf