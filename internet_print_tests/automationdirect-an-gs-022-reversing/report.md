# MIRA Print Translator Test — automationdirect-an-gs-022-reversing

## 1. Source & drawing metadata
- Publisher: AutomationDirect
- Title: AN-GS-022: VFD Reversing & Dynamic Braking (Application Note)
- Sheet: Reversing contactor + braking circuit (p. 1-6)
- Equipment: VFD reversing + dynamic-braking control circuit
- Standard: NEMA ICS 2
- Category: reversing_braking
- Source URL: https://support.automationdirect.com/docs/an-gs-022.pdf
- Access date (UTC): 2026-07-13T21:01:32Z
- Original sha256: `acc80cff067a461907c2f80b044170d8684a929102a711190d13ac1f77b8c73e`

## 2. Why selected
GS10 VFD reversing scheme with mechanical interlock, dynamic-braking relay and motor-coast timeout — an interlock/braking control circuit, the category most likely to expose interlock-logic misreads. Application-note PDF (short document; page 1 carries the circuit). Publicly published on support.automationdirect.com; provenance verified 2026-07-10.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Page 2 of an Automation Direct application note showing how to wire the digital-input control terminals of a GS20/GS20X variable-frequency drive for Start/Stop and Forward/Reverse, for the three values of parameter P02.00.

This sheet explains three ways to command run/direction from external switches or pushbuttons wired to the drive's digital inputs. First you set P00.21=1 so the drive takes its run command from the digital input terminals instead of the keypad. Then P02.00 selects the terminal behavior. Setting 1 is two-wire FWD/STOP and REV/STOP: closing FWD/DI1 runs forward, closing REV/DI2 runs reverse, opening either stops. Setting 2 is two-wire RUN/STOP with a separate direction bit: FWD/DI1 closed = run, and REV/DI2 chooses forward (open) or reverse (closed). Setting 3 is three-wire momentary control: a normally-open RUN button and a normally-closed STOP button (STOP on DI3) start and stop the drive, with REV/DI2 as an optional direction select. All input circuits shown return to the DCM common because the drive switch is assumed set to NPN (sink); for PNP/source mode you feed 24VDC to each DI and tie the supply 0V to DCM.

🔑 Signals
• Run Forward / Start command
• Run Reverse / direction-select command
• Stop command (3-wire mode, normally-closed)
• Digital-input common / 0V return

🔧 Devices
• AC variable-frequency drive (control-terminal block) (GS20(X))
• Two-wire selector/relay contacts for FWD-STOP and REV-STOP (Setting 1) (FWD/STOP, REV/STOP)
• Two-wire RUN-STOP contact plus FWD-REV direction contact (Setting 2) (RUN/STOP, FWD/REV)
• Momentary NO Start pushbutton, momentary NC Stop pushbutton, and REV/FWD direction select (Setting 3) (RUN, STOP, REV/FWD)

🩺 If you're chasing a fault
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• Exact junction between the NC STOP button, NO RUN button, and DI3 in the three-wire (Setting value 3) diagram is small and should be confirmed from a higher-resolution crop.
• The DI voltage level is not printed on this sheet — confirm against the GS20/GS20X manual before metering live.
• Whether each switch common lands directly on DCM or on a shared common bus is inferred from the note text, not explicitly drawn.

⚠️ These are low-voltage digital-input control circuits, but no voltage value is printed on this sheet, so the drawing does not establish the DI voltage (the drive's DI/DCM system is typically a low-voltage 24VDC control circuit, but confirm on the drive nameplate/manual — do not assume). For continuity checks of the switches and DI-to-DCM paths, de-energize the drive, lock out, and verify absence of voltage first. Also remember the drive power terminals and motor output are lethal-voltage even though only the control section is drawn here; keep clear of them during any live check.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 84.29s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **79/100** (B)
- hard failure: **False**
- summary: The response accurately paraphrases the visible P02.00 table (Settings 1-3), the P00.21 enable bit, and the NPN/PNP DCM wiring note without inventing voltages, tags, or terminal destinations, and it appropriately hedges the one genuinely cramped diagram area. It loses points for an unsupported, unexplained '3 PLC I/O' fragment in the off-page-reference line and for dense, emoji-heavy formatting that hurts scannability, but no hard-failure-level fabrication is present.

## 5. Verified strengths
- Correctly reads P02.00 Setting 1/2/3 open-close logic exactly as printed (e.g., Setting 2: FWD/DI1 'CLOSE': RUN, REV/DI2 'CLOSE': REV).
- Accurately reflects the printed NPN/PNP note about wiring back to DCM vs. supplying 24VDC and tying 0V to DCM.
- Does not invent a voltage value; explicitly states none is printed on the sheet.
- Uses only the device tag 'GS20(X)' that is actually printed in the diagram boxes.

## 6. Suspected errors / hallucinations
- "🧩 1 off-page ref(s): GS20/GS20X User Manual — Control Circuit Wiring Diagrams (Ch.2) · 3 PLC I/O" — The trailing '3 PLC I/O' fragment has no corresponding text, symbol, or reference in the image and is not explained; appears to be an unsupported/garbled artifact.

## 7. Items requiring technician review
- Exact contact arrangement of STOP (NC) and RUN (NO) buttons relative to DI3 in the Setting-3 (three-wire) diagram — the junction is small in the source image.
- Actual DI/DCM voltage level should be confirmed from the GS20/GS20X manual before any live measurement, since it is not printed on this page.

## 8. Build & runtime
- commit: `451b61cca09c17f75f8fde8319bf2438752b5e78` · branch: feat/internet-print-test-runner · version: 3.137.2
- judge model: claude-sonnet-5 · run: 2026-07-13T21:04:37Z

## 9. Source URL
https://support.automationdirect.com/docs/an-gs-022.pdf