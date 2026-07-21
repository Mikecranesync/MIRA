# MIRA Print Translator Test — banner-esfl-estop-relay

## 1. Source & drawing metadata
- Publisher: Banner Engineering
- Title: ES-FL-2A E-Stop Monitoring Safety Relay (46262)
- Sheet: Wiring diagram & connector pinout
- Equipment: Dual-channel E-stop monitoring safety relay
- Standard: ISO 13850 / EN 418
- Category: safety_relay
- Source URL: https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf
- Access date (UTC): 2026-07-21T07:57:19Z
- Original sha256: `51d7f43177b840657e8ef155ac2d6d6dc5ab554c27b6dd86c05926bc07476587`

## 2. Why selected
Dual-channel E-stop monitoring safety relay (K1/K2, S13-S34/13-24) — a functional-safety loop, the hardest class for an interpreter to read without inventing a Performance Level. Page 4 is the campaign-verified rendered schematic page (corpus_manifest.md first-10, entry #11). Publicly published on info.bannerengineering.com; provenance verified 2026-07-10 (206 application/pdf). Caption chosen to satisfy the production print_translator.is_print_question() gate (an initial 'Explain this safety circuit…' phrasing was gate-rejected — see CAMPAIGN_SUMMARY gate finding).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This circuit is an **Emergency Stop Monitoring Safety Relay** (Figure 2 title: "Hookup of ES-FL-2A Emergency Stop Monitoring Safety Relay").

It monitors an **Emergency Stop Switch** wired to terminals **S13–S14** and **S23–S24** of the **ES-FL-2A** relay. When the E-stop is actuated, the relay's **Internal Redundant Safety Relay Outputs** (K1A/K2A at terminals 13–14 and K1B/K2B at terminals 23–24) drop out, de-energizing the **Master Stop Control Elements (MSC1, MSC2)** connected between L1 and L2. A **Reset Switch** is wired to terminals **S33–S34** (with MSC1 and MSC2 monitor contacts in series) to restart the system after the E-stop is released. Terminals **41–42** provide a **Non-safety Auxiliary Monitor Contact (K3)**.

## Safety and Manufacturer Warnings

- **PRINTED (warning box, Figure 2):** "**WARNING** If arc suppressors are used, they **MUST** be installed as shown across the actuator of the master stop control elements (MSC1 and MSC2). **NEVER** install suppressors directly across the output contacts of the ES-FL-2A safety relay. It is possible for suppressors to fail as a short circuit. If installed directly across the output contacts of the safety relay, a short-circuited suppressor will create an unsafe condition which could result in serious injury or death."

- **PRINTED (warning box, Figure 2):** "**WARNING** (Reference ANSI B11.1 – 1988, Appendix B4) **NEVER** wire an intermediate device (for example, a programmable logic controller - PLC), other than a safety relay, between ES-FL-2A safety relay outputs and the master stop control element it switches. To do so sacrifices the control reliability of the control-to-machine interface, and creates an unsafe condition which could result in serious injury or death. Whenever a safety relay is added as an intermediate switching device, a normally-closed forced-guided monitor contact of that relay must be added to the series feedback loop between safety relay terminals S33 and S34."

- **PRINTED (IMPORTANT box, Figure 3):** "**IMPORTANT** Check ALL emergency stop switches, individually, during each checkout procedure."
```

- classification: **ELECTRICAL_PRINT** (conf 0.9)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 21.16s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **88/100** (B)
- hard failure: **False**
- summary: The response is accurate and well-structured, correctly identifying the ES-FL-2A relay's terminals, the E-stop input channels, the redundant safety outputs, the reset feedback loop, and the auxiliary K3 contact. Both WARNING boxes and the Figure 3 IMPORTANT note are quoted verbatim. The only notable omission is the lack of a terminal-to-terminal map and the contact current ratings (4A / 0.5A) visible on the drawing.

## 5. Verified strengths
- Correctly identifies Figure 2 caption: 'Hookup of ES-FL-2A Emergency Stop Monitoring Safety Relay'
- Accurately maps E-stop switch to terminals S13–S14 and S23–S24 as shown on the drawing
- Correctly identifies K1A/K2A at 13–14 and K1B/K2B at 23–24 as 'Internal Redundant Safety Relay Outputs'
- Correctly identifies K3 at terminals 41–42 as 'Non-safety Auxiliary Monitor Contact'
- Accurately describes reset loop with MSC1 and MSC2 monitor contacts in series between S33 and S34
- Both WARNING boxes are quoted verbatim from the drawing
- IMPORTANT checkout note is correctly attributed to Figure 3

## 6. Suspected errors / hallucinations
- "None of substance — all cited terminals, tags, and quoted text are supported by the drawing." — No fabricated terminals, voltages, or device tags were detected.

## 7. Items requiring technician review
- Confirm L1/L2 supply voltage from project documentation — not labeled on this drawing
- Verify contact ratings (4A max on safety outputs, 0.5A max on K3) against the load before commissioning
- Ensure arc suppressors are installed across MSC1/MSC2 actuators only, never across relay output contacts (per WARNING #1)
- Confirm no intermediate device (e.g., PLC) is wired between ES-FL-2A outputs and MSC1/MSC2 (per WARNING #2)

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: together/MiniMaxAI/MiniMax-M3 · run: 2026-07-21T07:58:57Z

## 9. Source URL
https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf