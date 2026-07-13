# MIRA Print Translator Test — schneider-atv340-vfd

## 1. Source & drawing metadata
- Publisher: Schneider Electric
- Title: Altivar Machine ATV340 Wiring Diagrams (NVE97896)
- Sheet: Wiring diagram section (p. 3-5)
- Equipment: Variable frequency drive (VFD)
- Standard: IEC 61800-5-1
- Category: vfd
- Source URL: https://download.schneider-electric.com/files?p_enDocType=Instruction+sheet&p_File_Name=ATV340_IS_Wiring_Diagrams_S1-S2-S3_NVE97896_02.pdf&p_Doc_Ref=NVE97896
- Access date (UTC): 2026-07-13T20:51:54Z
- Original sha256: `5d8d99b51ecee2eb5e8f085552c3e4b72f0b63295497b88aa7978135ee204785`

## 2. Why selected
Schneider ATV340 VFD: mains input (S1/S2/S3 variants), motor output, STO_A/STO_B safety, DI1-DI5, AI1-AI3/AQ1 analog, R1/R2 relays, DQ1/DQ2, encoder, Modbus/Sercos — a dense IEC drive to cross-check against the NEMA GS20. Page 0 verified by render 2026-07-13 as the wiring sheet (1/2). Caption chosen to satisfy the production is_print_question() gate (an initial 'Explain the power and control wiring…' phrasing is gate-rejected). Publicly published instruction sheet on download.schneider-electric.com; provenance verified 2026-07-10.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Sheet 1/2 of Schneider Electric's ATV340 variable-speed drive wiring reference — the power terminals (for frame sizes S1, S2 and S3) and the shared control terminals.

This is a factory connection diagram for the Altivar ATV340 AC drive. The upper 'Power' half shows how to land three-phase incoming mains on connector CN1 (L1/L2/L3, or L1-R/L2-S/L3-T on the S3 frame), the motor output U/V/W (U/T1,V/T2,W/T3) on CN10 to the motor, the internal DC bus at PA/+ and PC/- (CN9), and an optional dynamic braking resistor on the PB/PBe terminals. An earth (PE) plate and ground terminals bond the chassis. The lower 'Control' half shows the low-voltage terminals: the Safe Torque Off safety inputs (STO_A/STO_B, 24V, 0V) on CN2, programmable relay outputs R1 (A/B/C) and R2 (A/C), analog I/O on CN6 (AI1 0..10V/20mA, AI2 ±10V, AQ1 output 0..10V/20mA), five digital inputs (DI1–DI5), two transistor outputs (DO1, DO2), a +10V pot reference, plus expansion/communication ports: HMI/Modbus on CN7, optional Ethernet or Sercos III (ETH1,2), an encoder interface (ENC, 1Vpp A/B/I) and pulse train ports PTI/PTO (CN3/CN4/CN5) and an RS422 link. A logic-type selector (SW1: SRC/SK/EXT) sets sink/source for the digital inputs. Screw torque is 0.5 N·m / 4.4 lb·in.

🔑 Signals
• Three-phase line input
• Motor output to motor
• DC bus terminals
• Dynamic braking resistor
• Safe Torque Off channel A
• Safe Torque Off channel B
• 24V / 0V control supply
• Relay output 1 (form-C)
• Relay output 2
• Analog input 1 (0..10V / x..20mA), pot reference
• Analog input 2 bipolar ±10Vdc (differential)
• Analog output 1 (0..10V / x..20mA)
• +10V potentiometer reference supply
• Digital inputs 1–5
• Transistor output 1
• Transistor output 2
• Digital output common
• Digital input supply
• HMI / Modbus serial port
• Ethernet / Sercos III option ports
• Encoder interface (1Vpp, A/B/I) / RS422
• Pulse train output
• Pulse train input

🔧 Devices
• Altivar ATV340 variable-speed drive (frames S1/S2/S3) (ATV340)
• Three-phase AC motor (M)
• Dynamic braking resistor (optional, 'if used') (Braking resistor)
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• S3 power block CN8/CN9 grouping (PB, PA/+, PC/-) is cramped and overlapping — verify exact terminal-to-connector assignment from a clean crop.
• The repeated 'DISUP' terminal(s) at CN6 and their count are low-confidence.
• CN7 Modbus marking 'VP12S' is uncertain.
• No absolute supply/motor voltage is printed on this sheet — get it from the ATV340 rating plate/catalog.

⚠️ The power terminals (CN1 line, CN10 motor, CN9 PA/+/PC/- DC bus) are lethal live parts; the DC-bus capacitors can hold a dangerous charge AFTER the mains disconnect, so treat PA/+/PC/- and the braking terminals as energized until proven discharged. This sheet does NOT print the actual line/motor voltage — determine it from the drive rating plate before working. For continuity/resistance checks (e.g. motor leads, resistor), de-energize, lock out, and verify absence of voltage including the DC bus. The only voltage values actually printed here are the control-side references: ±10Vdc and 0..10Vdc analog, 24V/0V, 5V, 10V and the 1Vpp encoder signal — for live checks on those use appropriately rated meters and energized-work procedures. Terminal screw torque printed as 0.5 N·m / 4.4 lb·in.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 180.4s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **81/100** (B)
- hard failure: **False**
- summary: The response is a reasonably careful, well-hedged reading of the ATV340 S1/S2/S3 wiring sheet, correctly identifying the Power/Control layout, key connectors (CN1, CN9, CN10, CN2, CN6, CN7), and control voltages actually printed, while appropriately flagging ambiguous areas (S3 CN8/CN9 grouping, DISUP count, VP12S label) instead of asserting them as fact. Minor issues include a slightly invented AI2 terminal suffix and under-detailed wire/cable itemization, but no hard hallucinations of voltage levels, device tags, or hazardous terminal facts were found.

## 5. Verified strengths
- Correctly distinguishes S1&S2 CN1 (L1/L2/L3) from S3 CN1 (L1-R/L2-S/L3-T) as shown in the drawing.
- Correctly notes the drawing does not print an absolute mains/motor voltage value, matching the absence of such text on the sheet.
- Flags the cramped CN8/CN9/PB/PA+/PC- grouping on the S3 block as low-confidence rather than asserting a definite terminal assignment.

## 6. Suspected errors / hallucinations
- "Analog input 2 bipolar ±10Vdc (differential) — AI2+ / AI2-  @ CN6:AI2+/AI2-" — The drawing labels the terminals 'AI2' and '+AI2', not 'AI2+/AI2-'; this is a paraphrase rather than the printed terminal designation.

## 7. Items requiring technician review
- S3 power block CN8/CN9 grouping (PA/+, PB, PC/-) terminal-to-connector assignment, as flagged by the assistant itself.
- Exact count/location of DISUP terminals on CN6.
- Whether CN7's 'VP12S' marking is a Modbus port designation as claimed.

## 8. Build & runtime
- commit: `33ee01082734f372d0f6d568d0731d868405d613` · branch: feat/internet-print-test-runner · version: 3.137.2
- judge model: claude-sonnet-5 · run: 2026-07-13T20:56:37Z

## 9. Source URL
https://download.schneider-electric.com/files?p_enDocType=Instruction+sheet&p_File_Name=ATV340_IS_Wiring_Diagrams_S1-S2-S3_NVE97896_02.pdf&p_Doc_Ref=NVE97896