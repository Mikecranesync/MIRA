# MIRA Print Translator Test — automationdirect-gs20-vfd

## 1. Source & drawing metadata
- Publisher: AutomationDirect
- Title: GS20 AC Drive User Manual — Ch.2 Power & Control Wiring (GS20M)
- Sheet: Ch.2 power wiring & control terminal diagram
- Equipment: Variable frequency drive (VFD)
- Standard: NEMA ICS 6
- Category: vfd
- Source URL: https://cdn.automationdirect.com/static/manuals/gs20m/ch2.pdf
- Access date (UTC): 2026-07-13T14:27:07Z
- Original sha256: `641ed7a5bd5af2680d6a13f5a906ec31b89face22fc9cbe20127c70240854a49`

## 2. Why selected
GS20 VFD: 3-phase motor power input, 24 VDC control-signal wiring, brake and relay outputs — a drive print, directly relevant to MIRA's Drive Commander product. Page 37 is the campaign-verified rendered schematic page (corpus_manifest.md first-10, entry #17). Publicly published OEM chapter PDF; provenance verified 2026-07-10. Caption chosen to satisfy the production print_translator.is_print_question() gate (an initial 'Explain the power and control wiring…' phrasing was gate-rejected — see CAMPAIGN_SUMMARY gate finding).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Full I/O wiring diagram (page 2-38) for the DURApulse GS20 / GS20X variable-frequency drive — the complete power and control terminal hookup.

This drawing shows how to wire an AC drive (VFD) that runs a three-phase motor. Incoming one- or three-phase power passes through a circuit breaker/fuse and a main contactor (MC) into the drive input terminals R/L1, S/L2, T/L3, and the drive puts out variable-frequency three-phase power on U/T1, V/T2, W/T3 to the motor. An internal DC bus (DC-, DC+/+1, +2/B1, B2) can take an optional DC reactor and an optional brake resistor. On the control side the drive supplies +24 V for digital inputs DI1–DI7 (defaults: DI1=Forward/Stop, DI2=Reverse/Stop, DI3–DI6=multi-step speeds, DI7 spare/33 kHz pulse), all returning to the digital common DCM, wired NPN/sink by default. A 5 kΩ potentiometer across +10 V / AI1 / ACM (or a 0-10 V / 4-20 mA signal on AI2) sets the speed reference. Outputs include a form-C multi-function relay (R1O/R1C/R1), transistor/photocoupler outputs DO/DO1/DO2 with common DOC, an analog output AO1 (0-10 V or 0/4-20 mA), a Modbus RS-485 port, and a Safe-Torque-Off (STO1/STO2) circuit driven from a Safety PLC/E-STOP.

🔑 Signals
• Forward run / stop command
• Reverse run / stop command
• Multi-step speed 1
• Multi-step speed 2
• Multi-step speed 3
• Multi-step speed 4
• Spare digital input / 33 kHz pulse input
• Digital signal common (return for DI1–DI7)
• Analog speed reference from potentiometer/voltage
• Analog speed reference (current/voltage)
• +10 V reference supply for pot
• Analog multi-function output (0-10 V / 0-20 mA / 4-20 mA)
• Multi-function pulse/frequency output (30 VDC/30 mA/33 kHz)
• Multi-function transistor output 1 (48 VDC/50 mA)
• Multi-function transistor output 2 (48 VDC/50 mA)
• Multi-function relay output (form-C)
• Safe Torque Off channel 1
• Safe Torque Off channel 2
• Modbus RS-485 comms

🔧 Devices
• AC variable-frequency drive (VFD) (GS20 / GS20X)
• Three-phase motor (Motor 3~)
• Upstream circuit breaker or fuse (Circuit Breaker or Fuse)
• Main magnetic contactor (MC)
• Optional DC link reactor (DC reactor (optional))
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• Whether the left-side R1C/R1 relay and the right-side R1O/R1C/R1 are the same physical relay shown twice.
• Exact NPN vs PNP (sink/source) jumper configuration for the digital inputs (small symbol; diagram states default NPN/SINK and to refer to separate NPN/PNP wiring).
• Detailed shield/PE grounding of the DCM and ACM commons.

⚠️ This is a drive with high-energy circuits. The AC input is one- or three-phase mains and the DC bus retains a lethal charge after power-off — the sheet does not print the exact line/bus voltage, so treat it as unknown-but-dangerous and verify with the drive's rating label. For any continuity/resistance checks on motor leads, DC-bus, or brake resistor, de-energize, lock out, and confirm the DC bus has discharged to a safe level with a meter before touching. Control terminals carry the printed low levels (+24 VDC control, +10 VDC reference, DO 30 VDC, DO1/DO2 48 VDC, relay up to 250 VAC/30 VDC) — the relay contact can carry up to 250 VAC even when the drive appears 'off', so treat R1O/R1C/R1 as potentially live. STO is a safety function; do not defeat the STO wiring or reinsert the factory jumper as a workaround.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 175.72s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **86/100** (B)
- hard failure: **False**
- summary: The response is accurate and well-grounded against the visible terminal labels, voltage/current ratings, and functional blocks on the GS20/GS20X Full I/O Wiring Diagram, with no invented tags or voltages and good uncertainty calibration on ambiguous areas like the duplicated R1C/R1 relay. Minor deductions stem from characterizing the recommended MC protective circuit as a standard main contactor and from repeatedly deferring wire/cable details to a further 'map' reply that was itself truncated, leaving completeness incomplete.

## 5. Verified strengths
- Terminal labels (DI1-DI7, AI1/AI2, AO1/ACM, DO/DO1/DO2/DOC, R1O/R1C/R1, STO1/STO2/SCM, SG+/SG-/SGND) all match the drawing exactly.
- Voltage/current ratings cited (30VDC/30mA, 48VDC/50mA, 250VAC/30VDC relay specs, +24V, +10V) are directly read from the printed spec blocks.
- Correctly flags the R1C/R1 terminal appearing in two places on the sheet as an open question rather than asserting equivalence outright.
- Safety commentary about DC bus residual charge and STO function is well-grounded and appropriately cautious.

## 6. Suspected errors / hallucinations
- ""Incoming one- or three-phase power passes through a circuit breaker/fuse and a main contactor (MC) into the drive input terminals"" — The drawing's gray dashed box and accompanying NOTE describe the MC/R1C-R1 circuit as a recommended optional protective addition ('It is recommended that you install a protective circuit...'), not a standard main contactor always present in the power path.

## 7. Items requiring technician review
- Confirm whether the MC/protective circuit shown in the gray box is installed in the actual field wiring, since the print marks it as a recommendation, not a mandatory component.
- Verify NPN vs PNP jumper position physically, since the diagram shows only a small symbol and the response could not confirm details from the image.
- Complete the wires/cables listing and shielded-cable routing that were deferred in both responses.

## 8. Build & runtime
- commit: `8379b7cb8fc00324590aabd2f054a212dc2a55b5` · branch: feat/internet-print-test-runner · version: 3.137.1
- judge model: claude-sonnet-5 · run: 2026-07-13T14:31:15Z

## 9. Source URL
https://cdn.automationdirect.com/static/manuals/gs20m/ch2.pdf