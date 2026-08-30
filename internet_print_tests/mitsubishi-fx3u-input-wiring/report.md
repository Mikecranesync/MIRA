# MIRA Print Translator Test — mitsubishi-fx3u-input-wiring

## 1. Source & drawing metadata
- Publisher: Mitsubishi Electric
- Title: FX3U PLC Input Module Wiring (JY997D19001)
- Sheet: Schematic & terminal table (p. 2-4)
- Equipment: PLC input module
- Standard: Industrial 24VDC
- Category: plc_io
- Source URL: https://dl.mitsubishielectric.com/dl/fa/document/manual/plc_fx/jy997d19001(e)/jy997d19001(e)e.pdf
- Access date (UTC): 2026-07-21T06:27:41Z
- Original sha256: `ed5d909ee1874af1c2b7f88bfc2d0f9a61687135b62b799421a079a420c9930e`

## 2. Why selected
Mitsubishi FX3U modular input card, 24 VDC sensor input with common terminal wiring and group isolation. Page 0 is the campaign-verified rendered page (corpus_manifest.md first-10, entry #16). Publicly published on dl.mitsubishielectric.com; provenance verified 2026-07-10.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
The print does not show specific devices. It is a wiring caution notice ("FX3U Input Wiring Caution") showing generic example wiring configurations for sink and source input methods.

The terminals depicted in the examples are:

**AC power type (Except FX3U-□MR/UA1):**
- Ground: ⊥
- Power: L, N
- S/S
- 0V, 24V
- Inputs: X0, X1, X2 (with "..." indicating additional inputs continue)

**DC power type:**
- Ground: ⊥
- Power: ⊕, ⊖
- S/S
- (0V), (24V)
- Inputs: X0, X1,
```

- classification: **ELECTRICAL_PRINT** (conf 0.8)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 24.75s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `a3033b7f9607074493da92761904be4e86d9ceb2` · branch: feat/printsense-prod-recall-gate · version: 3.184.0
- judge model: None · run: 2026-07-21T06:28:07Z

## 9. Source URL
https://dl.mitsubishielectric.com/dl/fa/document/manual/plc_fx/jy997d19001(e)/jy997d19001(e)e.pdf