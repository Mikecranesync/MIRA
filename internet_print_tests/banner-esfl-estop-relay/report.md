# MIRA Print Translator Test — banner-esfl-estop-relay

## 1. Source & drawing metadata
- Publisher: Banner Engineering
- Title: ES-FL-2A E-Stop Monitoring Safety Relay (46262)
- Sheet: Wiring diagram & connector pinout
- Equipment: Dual-channel E-stop monitoring safety relay
- Standard: ISO 13850 / EN 418
- Category: safety_relay
- Source URL: https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf
- Access date (UTC): 2026-07-13T14:23:10Z
- Original sha256: `51d7f43177b840657e8ef155ac2d6d6dc5ab554c27b6dd86c05926bc07476587`

## 2. Why selected
Dual-channel E-stop monitoring safety relay (K1/K2, S13-S34/13-24) — a functional-safety loop, the hardest class for an interpreter to read without inventing a Performance Level. Page 4 is the campaign-verified rendered schematic page (corpus_manifest.md first-10, entry #11). Publicly published on info.bannerengineering.com; provenance verified 2026-07-10 (206 application/pdf). Caption chosen to satisfy the production print_translator.is_print_question() gate (an initial 'Explain this safety circuit…' phrasing was gate-rejected — see CAMPAIGN_SUMMARY gate finding).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
📋 Hookup wiring diagram (page 5) for a Banner ES-FL-2A emergency-stop monitoring safety relay and its two master stop contactors.

This is the field-wiring diagram for a Banner ES-FL-2A E-stop safety relay. The relay is powered by 24V ac/dc at A1/A2 and monitors a dual-channel emergency-stop button wired into inputs S13/S14 and S23/S24. When every E-stop is released (both channels closed) and the reset button is pressed, the relay energizes its two internal redundant, forced-guided safety output contacts — K1A/K2A on channel A (terminals 13/14) and K1B/K2B on channel B (terminals 23/24). Those outputs feed the coils of the two master stop control contactors MSC1 and MSC2 (fed from L1, returning to L2), which are what actually let the machine run. Pressing any E-stop opens both channels, drops out the safety outputs, and de-energizes MSC1 and MSC2 to stop the machine. For fault detection, the normally-closed forced-guided monitor contacts of MSC1 and MSC2 are wired in series with the reset switch in the S33/S34 feedback loop, so the relay will not reset unless both contactors have actually dropped out. K3 (terminals 41/42) is a separate non-safety auxiliary monitor contact.

🔑 Signals
• 24V ac/dc control supply to the relay
• Emergency-stop channel 1 input
• Emergency-stop channel 2 input
• Reset / contactor-monitor feedback loop
• Safety output channel A (drives MSC1)
• Safety output channel B (drives MSC2)
• Non-safety auxiliary monitor contact

🔧 Devices
• Emergency-stop monitoring safety relay (ES-FL-2A)
• Emergency stop pushbutton (dual NC contacts) (Emergency Stop Switch)
• Reset pushbutton (Reset Switch)
• Master stop control element / contactor #1 (MSC1)
• Master stop control element / contactor #2 (MSC2)
• Arc suppressors (optional, across MSC actuators) (* (see WARNING))

🩺 If you're chasing a fault
… (more — reply "map")

❓ Couldn't confirm (verify on the sheet):
• Exact internal contact routing of the dual-channel E-stop to S13/S14 vs S23/S24 (confirm from higher-resolution crop of the top of Figure 2 / Figure 3).
• Which top-rail nodes (S24, 13, 23, 41) are bonded to L1 — verify the top distribution rail.
• No drawing number, cabinet, or sheet-set index is printed (this is manual/datasheet page 5).

⚠️ The printed supply level is 24V ac/dc at A1/A2; the L1/L2 contactor circuit voltage is NOT stated on this sheet, so treat it as unknown and potentially higher line voltage until verified in the field. For continuity/resistance checks of E-stop and feedback loops, de-energize, lock out, and verify absence of voltage first. For live voltage checks on the L1/L2 / MSC contactor branch, follow energized-work procedures with properly rated equipment. Heed the printed WARNINGS: install arc suppressors only across the MSC actuators (never across the relay output contacts, where a shorted suppressor creates an unsafe condition), and never wire a PLC or other intermediate device between the safety relay outputs and the master stop control elements.
🔎 Read from the drawing. Verify field conditions and use the correct procedure for the measurement.

Reply "map" for the full terminal and wire list.
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **True**
- model: claude-opus-4-8 · effort xhigh · latency 125.97s

## 4. Automated grade (PROVISIONAL — not technician approval until Mike calibrates)
- score: **85/100** (B)
- hard failure: **False**
- summary: The response is largely accurate and well-aligned with the printed terminal labels, device tags, and safety warnings in Figure 2/Figure 3, with no invented voltages or device tags and appropriate hedging on genuinely ambiguous areas. Its main weaknesses are the fabricated per-item confidence percentages and a minor mix-up listing S24 among possible L1-rail nodes, both of which slightly overstate precision without corresponding evidence in the drawing.

## 5. Verified strengths
- Correctly identifies K1A/K2A at terminals 13/14 and K1B/K2B at terminals 23/24 as internal redundant safety outputs, matching the printed labels.
- Correctly reproduces the WARNING about arc suppressors only being installed across MSC actuators, never across relay output contacts, matching the printed warning text.
- Correctly notes S33/S34 as the feedback loop containing the Reset Switch and MSC1/MSC2 monitor contacts in series, matching the visual series wiring in Figure 2.
- Correctly flags that L1/L2 voltage is not stated on the sheet, avoiding invention of a voltage value.

## 6. Suspected errors / hallucinations
- "Which top-rail nodes (S24, 13, 23, 41) are bonded to L1 — verify the top distribution rail." — S24 is part of the emergency-stop switch loop (top row left of the relay), not part of the L1 distribution rail shown with dots only above terminals 13 and 23; grouping it with L1-rail nodes is inaccurate.
- "conf 0.95 / conf 0.90 / conf 0.88 (numeric confidence values attached to every signal and device)" — These precise confidence percentages are not derivable from the drawing and appear to be fabricated quantification rather than something read from the print.

## 7. Items requiring technician review
- Confirm actual internal contact routing of the E-stop switch to S13/S14 vs S23/S24 against Figure 3's series-wiring detail.
- Verify with a multimeter (de-energized) which physical nodes are tied to the L1 rail versus the switch loop, since the assistant's list conflates S24 with L1-rail nodes.
- Confirm the actual line voltage present on L1/L2 in the field, since it is not printed on this sheet.

## 8. Build & runtime
- commit: `8379b7cb8fc00324590aabd2f054a212dc2a55b5` · branch: feat/internet-print-test-runner · version: 3.137.1
- judge model: claude-sonnet-5 · run: 2026-07-13T14:27:06Z

## 9. Source URL
https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf