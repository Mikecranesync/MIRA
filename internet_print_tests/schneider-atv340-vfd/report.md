# MIRA Print Translator Test — schneider-atv340-vfd

## 1. Source & drawing metadata
- Publisher: Schneider Electric
- Title: Altivar Machine ATV340 Wiring Diagrams (NVE97896)
- Sheet: Wiring diagram section (p. 3-5)
- Equipment: Variable frequency drive (VFD)
- Standard: IEC 61800-5-1
- Category: vfd
- Source URL: https://download.schneider-electric.com/files?p_enDocType=Instruction+sheet&p_File_Name=ATV340_IS_Wiring_Diagrams_S1-S2-S3_NVE97896_02.pdf&p_Doc_Ref=NVE97896
- Access date (UTC): 2026-07-21T06:30:32Z
- Original sha256: `5d8d99b51ecee2eb5e8f085552c3e4b72f0b63295497b88aa7978135ee204785`

## 2. Why selected
Schneider ATV340 VFD: mains input (S1/S2/S3 variants), motor output, STO_A/STO_B safety, DI1-DI5, AI1-AI3/AQ1 analog, R1/R2 relays, DQ1/DQ2, encoder, Modbus/Sercos — a dense IEC drive to cross-check against the NEMA GS20. Page 0 verified by render 2026-07-13 as the wiring sheet (1/2). Caption chosen to satisfy the production is_print_question() gate (an initial 'Explain the power and control wiring…' phrasing is gate-rejected). Publicly published instruction sheet on download.schneider-electric.com; provenance verified 2026-07-10.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
# ATV340 S1, S2 & S3 Wiring Diagram Explanation

This sheet (NVE97896-02, 07/2018, page 1/2) shows the **Power** and **Control** wiring for the ATV340 drive in three frame sizes: S1, S2, and S3.

## Power Section (top)

**S1 & S2 frames:**
- **CN1** — AC power input: terminals **L1, L2, L3** plus **PE** (ground)
- **CN9** — DC bus terminals **PA/+** and **PC/-**
- **CN10** — Motor output: terminals **U, V, W** to motor **M**, plus **PE Plate**; terminals **PBe, PB** for **Braking resistor (if used)**

**S3 frame:**
- **CN1** — AC power input: terminals **L1/R, L2/S, L3/T** plus **PE**
- **CN9** — DC bus terminals **PA/+, PB, PC/-**
- **CN8** — **Braking resistor (if used)**
- **CN10** — Motor output: terminals **U/T1, V/T2, W/T3** to motor **M**, plus **PE**

## Control Section (bottom)

The ATV340 drive has these connectors:

- **CN2** — **24V, 0V, STO_A, STO_B** (Safe Torque Off inputs)
- **CN3** — **ENC** encoder input (**RS422**, **1Vpp, A/B/I**)
- **CN4** — **PTO** (Pulse Train Output)
- **CN5** — **PTI** (Pulse Train Input), **5V, 24V** from PLC
- **CN6** — I/O terminals:
  - Digital inputs: **DI1–DI5**, **DISUP**, **SHLD**, **DCOM**
  - Digital outputs: **DO1, DO2**
  - Analog input: **AI1, AI2** with **COM, SHLD, 10V** (range **0..10Vdc, x..20mA**)
  - Analog output: **AO1** (**0..10Vdc, x..20mA**)
  - Relay outputs: **R1A, R1B, R1C** and **R2A, R2C**
- **CN7** — **HMI** (**Modbus VP12S**) and **ETH1, 2** (**Optional or Sercos III**)
- **SW1** — **SK** switch, **SRC / EXT** positions

## External connections shown

- **PLC** → PTI (5V/24V), DO1/DO2, AI1/AI2
- **Encoder (ENC)** → CN3
- **PTO** (CN4) → second ATV340's PTI
- **HMI** display → CN7
- **PTx** probe: **0..10Vdc, x..20mA**

## Torque specification

**0.5 N·m / 4.4 lb·in** (terminal screws)

---

**Note:** This is a wiring diagram only — it does not show live state. To verify whether any circuit is energized or a contact is open/closed, the technician must measure with a meter.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 46.06s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `a3033b7f9607074493da92761904be4e86d9ceb2` · branch: feat/printsense-prod-recall-gate · version: 3.184.0
- judge model: None · run: 2026-07-21T06:31:19Z

## 9. Source URL
https://download.schneider-electric.com/files?p_enDocType=Instruction+sheet&p_File_Name=ATV340_IS_Wiring_Diagrams_S1-S2-S3_NVE97896_02.pdf&p_Doc_Ref=NVE97896