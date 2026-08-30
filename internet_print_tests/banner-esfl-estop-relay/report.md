# MIRA Print Translator Test — banner-esfl-estop-relay

## 1. Source & drawing metadata
- Publisher: Banner Engineering
- Title: ES-FL-2A E-Stop Monitoring Safety Relay (46262)
- Sheet: Wiring diagram & connector pinout
- Equipment: Dual-channel E-stop monitoring safety relay
- Standard: ISO 13850 / EN 418
- Category: safety_relay
- Source URL: https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf
- Access date (UTC): 2026-07-21T06:30:09Z
- Original sha256: `51d7f43177b840657e8ef155ac2d6d6dc5ab554c27b6dd86c05926bc07476587`

## 2. Why selected
Dual-channel E-stop monitoring safety relay (K1/K2, S13-S34/13-24) — a functional-safety loop, the hardest class for an interpreter to read without inventing a Performance Level. Page 4 is the campaign-verified rendered schematic page (corpus_manifest.md first-10, entry #11). Publicly published on info.bannerengineering.com; provenance verified 2026-07-10 (206 application/pdf). Caption chosen to satisfy the production print_translator.is_print_question() gate (an initial 'Explain this safety circuit…' phrasing was gate-rejected — see CAMPAIGN_SUMMARY gate finding).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This circuit is an **Emergency Stop Monitoring Safety Relay** (Banner ES-FL-2A), shown in Figure 2: "Hookup of ES-FL-2A Emergency Stop Monitoring Safety Relay."

It functions as follows:

- **Input:** An Emergency Stop Switch wired to terminals S13–S14 (and S23–S24) of the ES-FL-2A, powered by 24V ac/dc at A1/A2.
- **Logic:** The relay monitors the E-stop switch state and, when the switch is in its safe (run) position, energizes its internal redundant safety outputs (K1A/K2A and K1B/K2B).
- **Outputs:** Terminals 13–14 and 23–24 switch the **Master Stop Control Elements (MSC1 and MSC2)** between L1 and L2. Terminals 41–42 provide a non-safety auxiliary monitor contact (K3, 0.5A max).
- **Feedback/Reset:** Terminals S33–S34 form the series feedback loop with the MSC1 and MSC2 monitor contacts and the Reset Switch, allowing the relay to verify the master stop elements have dropped out before allowing a reset.

In short: pressing the E-stop opens the safety loop, de-energizing the redundant outputs, which drops out MSC1 and MSC2 to stop the machine. The relay cannot be reset until the E-stop is released and the feedback loop through S33–S34 confirms the master stop elements are in the safe state.
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 20.06s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `a3033b7f9607074493da92761904be4e86d9ceb2` · branch: feat/printsense-prod-recall-gate · version: 3.184.0
- judge model: None · run: 2026-07-21T06:30:30Z

## 9. Source URL
https://info.bannerengineering.com/cs/groups/public/documents/literature/46262.pdf