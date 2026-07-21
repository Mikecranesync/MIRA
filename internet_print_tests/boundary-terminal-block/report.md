# MIRA Print Translator Test — boundary-terminal-block

## 1. Source & drawing metadata
- Publisher: AUCOTEC AG
- Title: Engineering Base: Configuration of Terminal Block Diagram
- Sheet: Standard Terminal Block Diagram
- Equipment: terminal-strip interconnection
- Standard: IEC 61082 / IEC 60445
- Category: terminal_block
- Source URL: https://productguides.aucotec.com/Documentation/EBWebhelp/jkprrv-ezk_1WH-ttrupkgatznnq/using_eb/english_pdf/configuration_terminal_block_diagram.pdf
- Access date (UTC): 2026-07-21T07:47:17Z
- Original sha256: `d10eef1ecb97ec6f09ee30d3d4c292e016c7b52c9b75028cee6e38db095c97d6`

## 2. Why selected
Boundary class 3: terminal-strip interconnection (numbered terminals, field/panel wire designations).

## 3. Exact Telegram bot response (verbatim, unmodified)

```
This page is not a wiring diagram of a specific machine — it is documentation (page 13, Section 5.1 "Standard Terminal Block Diagram") explaining how terminal block diagrams are generated in Engineering Base software.

**Key points printed on the sheet:**

- The standard terminal block diagram is created in **DIN A3 landscape format**.
- The **left-hand area** maps the **external side** of the terminal; the **right-hand area** maps the **internal side**.
- Limits: **maximally 8 cables externally**, **maximally 5 cables internally**; **external bridges are not shown**.
- Cables are arranged in **columns and lines**.

**Two figures shown:**

1. **Cable definition template** — a red box labeled **"CableWidth"** sits to the left of two attributes: **"HeaderCablePos"** and **"CableAttr=10347"**. Below is the entry **"1.CableE F"**.
2. **Example: cable representation in a standard terminal block diagram** — shows columns headed **"-W2"** and **"-W1"**, cable designations **"NYSLYö-J 4G1,5"** and **"NYSLYö-J 3G1,5"**, and terminal numbers **1, 3, 2**.

**Rules printed on the sheet:**

- The size of the red **CableWidth** box controls how the two attributes are displayed.
- Position of the red box **to the left** of the text attributes = cables entered **right to left**; position **to the right** = cables entered **left to right**.
- The attributes **HeaderCablePos** and **CableAttr=10347** correspond to the entries **1.CableE** and **1.CableI**; the individual cores of the cable are listed under the cable.

No DANGER / WARNING / CAUTION boxes, prohibitions, or reset/isolation/bypass instructions are printed on this page, so no safety section is required.
```

- classification: **ELECTRICAL_PRINT** (conf 0.8)
- interpreter used (Anthropic PrintSynth): **False**
- model: together/MiniMaxAI/MiniMax-M3 · effort medium · latency 18.81s

## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)
- score: **None/100** (None)
- hard failure: **None**
- summary: None

## 5. Verified strengths

## 6. Suspected errors / hallucinations

## 7. Items requiring technician review

## 8. Build & runtime
- commit: `003f53820a5ccf1ea9c7b5bc0d24dc2e517e2fb0` · branch: feat/printsense-generalization · version: 3.186.0
- judge model: None · run: 2026-07-21T07:47:37Z

## 9. Source URL
https://productguides.aucotec.com/Documentation/EBWebhelp/jkprrv-ezk_1WH-ttrupkgatznnq/using_eb/english_pdf/configuration_terminal_block_diagram.pdf