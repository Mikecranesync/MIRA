# MIRA Print Translator Test — boundary-hydraulic

## 1. Source & drawing metadata
- Publisher: Toro University Technical Training
- Title: Hydraulic Systems
- Sheet: Complete Hydraulic Schematic
- Equipment: hydraulic circuit
- Standard: ISO 1219 / ANSI / JIC fluid-power symbols
- Category: hydraulic
- Source URL: https://media.toro.com/toroumaterials/pdf/09169sl.pdf
- Access date (UTC): 2026-07-21T07:52:34Z
- Original sha256: `05e459841212f091e168faae3c4defe883d78c4801009a2b141b0a5268197cf7`

## 2. Why selected
Boundary class 7: complete hydraulic circuit (pump, filter, DCV, relief valve, cylinder).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This is page **16** of a **Toro University Technical Training** document titled **"Hydraulic Systems"**, showing a **"Complete Hydraulic Schematic"**.

**Printed description on the sheet:**
> "Here we have a simple hydraulic schematic using the symbols that we discussed and how they are used in a complete schematic. You can see that we have a hydraulic pump which gets it's fluid from the reservoir, pulls the fluid through the filter than sends it to the valve. The valve directs the oil to the hydraulic cylinder."

**Components shown in the schematic (per the printed text):**
- **Reservoir** — fluid source (tank symbol at bottom)
- **Filter** — fluid passes through it after the reservoir (diamond symbol)
- **Hydraulic pump** —
```

- classification: **ELECTRICAL_PRINT** (conf 0.85)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 56.64s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:53:32Z

## 9. Source URL
https://media.toro.com/toroumaterials/pdf/09169sl.pdf