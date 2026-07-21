# MIRA Print Translator Test — boundary-panel-layout

## 1. Source & drawing metadata
- Publisher: HybridPLC
- Title: Chapter 9: Planning the Panel
- Sheet: Fig 9-22 populated back-panel layout
- Equipment: control-panel back-panel arrangement
- Standard: UL 508A / NFPA 79 practice (no single drawing standard)
- Category: panel_layout
- Source URL: https://hybridplc.org/wp-content/uploads/chap9_S.pdf
- Access date (UTC): 2026-07-21T07:51:06Z
- Original sha256: `ba120603ca1e188b68ac910f1c24b7a4c68771dfec70a67dd577867ebd085f7b`

## 2. Why selected
Boundary class 4: mechanical back-panel arrangement (ducts, starters, PLC rack, terminal strips) — not a wiring schematic.

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This is page 31 of a textbook/manual chapter titled **"Ch 9 Planning the Panel"**, not a working electrical print. It illustrates how AutoCAD Electrical software links panel layouts to schematic drawings.

**Figure 9-22 — "Creating a Panel Layout using AutoCADD Electrical"**
A panel layout drawing showing:
- A "24\" FLUORESCENT LIGHT FIXTURE" at the top
- Multiple "2\" x 4\" WIRING DUCT" sections
- A "CROSS WIRE BREAKER"
- A "RACK B" populated with PLC modules tagged PLC1500, PLC1502, PLC1500A, PLC1502A, PLC1500B, PLC1502B
- Terminal block columns labeled TB, TB-1, TS-1A, TS-1B
- An "EDGE OF ENCLOSURE" marker

**Figure 9-23 — "Checking for Missing Components"**
A schematic with a dialog box titled "SURF : CR407 refs" listing MFG / CAT / SH.REF / INST.LOC(TYP) entries (e.g., "P 4 407 MCAB5 K1,K2", "NO 4 411 MCAB5", "NC 4 633 MCAB5"). The schematic shows three safety-relay branches:
- MCAB5 CR406 — "SAFETY RELAY NO.1" — "NO 410 NC"
- MCAB5 CR407 — "SAFETY RELAY NO.2" — "NO 411,633 NC"
- MCAB5 CR408 — "SAFETY RELAY NO.3" — "NO NC"
- OPSTA3 LT409 with terminals X1, X2, labeled "SAFETY OKAY"
- Wire numbers 407A and 408A

**Printed explanatory text (verbatim):**
> "The figure above shows an example of a panel layout. As components are changed in one drawing, they are automatically updated in all associated drawings. This effectively increases drafting productivity. Checking for missing components is eliminated since there is a link between parts on schematic drawings and panel layout drawings."

**Note:** This page is instructional documentation about CAD software behavior — it does not depict a specific machine's wiring, so it cannot answer questions about a real panel's live state, wire routing, or component specifications. For those, refer to the project's actual panel-layout and schematic drawings.
```

- classification: **ELECTRICAL_PRINT** (conf 0.95)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 23.32s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:51:30Z

## 9. Source URL
https://hybridplc.org/wp-content/uploads/chap9_S.pdf